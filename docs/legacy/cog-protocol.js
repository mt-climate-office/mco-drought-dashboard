// cog-protocol.js — forked MapLibre COG raster tile protocol
//
// Forked from: https://mt-climate-office.github.io/mco-snodas/cog-protocol.js
// Changes: Added DEFLATE support via browser-native DecompressionStream,
//          reads compression type (tag 259) and predictor (tag 317) from IFD,
//          configurable nodata, optional fzstd for ZSTD COGs.
//
// Supports: WGS84 COGs with DEFLATE or ZSTD compression, optional horizontal-differencing predictor (Int16).
//
// Usage:
//   CogProtocol.registerColormap('ptile', CogProtocol.makeStepColormap({ breaks, colors }));
//   CogProtocol.initCogProtocol(maplibregl);
//
//   map.addSource('my-layer', {
//     type: 'raster',
//     tiles: ['cog://ptile/https://bucket.s3.../path/file.tif/{z}/{x}/{y}'],
//     tileSize: 256
//   });

(function (global) {
  'use strict';

  const _ifdCache   = new Map(); // cogUrl → meta
  const _blockCache = new Map(); // "cogUrl:ifdIdx:blockIdx" → Int16Array
  const _colormaps  = new Map(); // name → (value: number) => [r,g,b,a] | null
  const MAX_BLOCKS  = 512;

  // ── Decompression helpers ──────────────────────────────────────────────────

  /**
   * Decompress DEFLATE data using browser-native DecompressionStream.
   * TIFF compression tag 8 uses zlib-wrapped deflate.
   */
  async function decompressDeflate(compressed) {
    const ds = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    writer.write(compressed);
    writer.close();
    const reader = ds.readable.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const result = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { result.set(c, off); off += c.length; }
    return result;
  }

  /**
   * Decompress ZSTD data using fzstd (must be loaded globally).
   */
  function decompressZstd(compressed) {
    if (typeof fzstd === 'undefined') {
      throw new Error('[cog-protocol] ZSTD COG requires fzstd library to be loaded globally');
    }
    return fzstd.decompress(compressed);
  }

  // ── Colormap registry ──────────────────────────────────────────────────────

  function registerColormap(name, fn) {
    _colormaps.set(name, fn);
  }

  function makeStepColormap({ breaks, colors, alpha = 210, domain = [0, 100], nodata = -32768 }) {
    const [lo, hi] = domain;
    const size = hi - lo + 1;
    const lut = new Uint8Array(size * 3);
    for (let v = lo; v <= hi; v++) {
      let ci = 0;
      for (let i = breaks.length - 1; i >= 0; i--) {
        if (v >= breaks[i]) { ci = i; break; }
      }
      lut[(v - lo) * 3]     = colors[ci][0];
      lut[(v - lo) * 3 + 1] = colors[ci][1];
      lut[(v - lo) * 3 + 2] = colors[ci][2];
    }
    return function colorize(value) {
      if (value === nodata || value < lo || value > hi) return null;
      const i = (value - lo) * 3;
      return [lut[i], lut[i + 1], lut[i + 2], alpha];
    };
  }

  // ── TIFF header / IFD parser ───────────────────────────────────────────────

  async function loadMeta(cogUrl) {
    if (_ifdCache.has(cogUrl)) return _ifdCache.get(cogUrl);

    const HDR    = 65536;
    const hdrBuf = new Uint8Array(
      await (await fetch(cogUrl, { headers: { Range: `bytes=0-${HDR - 1}` } })).arrayBuffer()
    );

    const u16 = (o) => hdrBuf[o] | (hdrBuf[o + 1] << 8);
    const u32 = (o) => (hdrBuf[o] | (hdrBuf[o+1]<<8) | (hdrBuf[o+2]<<16) | (hdrBuf[o+3]<<24)) >>> 0;
    const dbl = (o) => new DataView(hdrBuf.buffer).getFloat64(o, true);

    function parseTag(type, cnt, raw) {
      if (type === 3)  return cnt === 1 ? u16(raw) : Array.from({length:cnt}, (_,j) => u16(raw + j*2));
      if (type === 4)  return cnt === 1 ? u32(raw) : Array.from({length:cnt}, (_,j) => u32(raw + j*4));
      if (type === 12) return Array.from({length:cnt}, (_,j) => dbl(raw + j*8));
      if (type === 2) {
        // ASCII string (for GDAL_NODATA etc.)
        const bytes = new Uint8Array(hdrBuf.buffer, raw, cnt);
        return new TextDecoder('ascii').decode(bytes).replace(/\0/g, '').trim();
      }
      return null;
    }

    function readIFD(off) {
      const n = u16(off); off += 2;
      const tags = {};
      for (let i = 0; i < n; i++, off += 12) {
        const tag = u16(off), type = u16(off+2), cnt = u32(off+4);
        const tb  = [0,1,1,2,4,8,1,1,2,4,8,4,8][type] || 1;
        const raw = cnt * tb <= 4 ? off + 8 : u32(off + 8);
        tags[tag] = parseTag(type, cnt, raw);
      }
      return { tags, next: u32(off) };
    }

    const ifds = [];
    let ifdOff = u32(4);
    while (ifdOff) { const { tags, next } = readIFD(ifdOff); ifds.push(tags); ifdOff = next; }

    const tp      = ifds[0][33922]; // ModelTiepoint  [I,J,K,X,Y,Z]
    const ps      = ifds[0][33550]; // ModelPixelScale [sx,sy,sz]
    const [,,,BW, BN] = tp;
    const BE      = BW + ifds[0][256] * ps[0];
    const BS      = BN - ifds[0][257] * ps[1];
    const lonSpan = BE - BW;
    const latSpan = BN - BS;
    const ifdRes  = ifds.map(t => lonSpan / t[256]);

    // Read GDAL_NODATA from tag 42113 if available
    let nodata = -32768;
    if (ifds[0][42113] != null) {
      const parsed = parseFloat(ifds[0][42113]);
      if (!isNaN(parsed)) nodata = parsed;
    }

    const meta = { ifds, BW, BN, BE, BS, lonSpan, latSpan, ifdRes, nodata };
    _ifdCache.set(cogUrl, meta);
    return meta;
  }

  // ── Block fetcher with LRU cache ───────────────────────────────────────────

  async function getBlock(cogUrl, ifdIdx, blockIdx, ifd) {
    const key = `${cogUrl}:${ifdIdx}:${blockIdx}`;
    if (_blockCache.has(key)) {
      const v = _blockCache.get(key); _blockCache.delete(key); _blockCache.set(key, v); return v;
    }
    const tw   = ifd[322], th = ifd[323];
    const offs = [].concat(ifd[324]);
    const lens = [].concat(ifd[325]);

    if (blockIdx >= offs.length) return new Int16Array(tw * th).fill(-9999);

    const compressed = new Uint8Array(
      await (await fetch(cogUrl, { headers: { Range: `bytes=${offs[blockIdx]}-${offs[blockIdx] + lens[blockIdx] - 1}` } })).arrayBuffer()
    );

    // Detect compression from IFD tag 259
    const compression = ifd[259] || 8; // default DEFLATE
    let raw;
    if (compression === 8 || compression === 32946) {
      // DEFLATE (tag 8) or zlib (tag 32946)
      raw = await decompressDeflate(compressed);
    } else if (compression === 50000) {
      // ZSTD
      raw = decompressZstd(compressed);
    } else if (compression === 1) {
      // No compression
      raw = compressed;
    } else {
      console.error(`[cog] unsupported compression type: ${compression}`);
      return new Int16Array(tw * th).fill(-9999);
    }

    // Undo horizontal-differencing predictor (tag 317 = 2) with uint16 modular arithmetic
    const predictor = ifd[317] || 1;
    const u16a = new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
    if (predictor === 2) {
      for (let r = 0; r < th; r++) {
        const b = r * tw;
        for (let c = 1; c < tw; c++) u16a[b + c] = (u16a[b + c] + u16a[b + c - 1]) & 0xFFFF;
      }
    }

    const tile = new Int16Array(u16a.buffer, u16a.byteOffset, u16a.length);
    if (_blockCache.size >= MAX_BLOCKS) _blockCache.delete(_blockCache.keys().next().value);
    _blockCache.set(key, tile);
    return tile;
  }

  // ── Window reader ──────────────────────────────────────────────────────────

  async function readWindow(cogUrl, meta, ifdIdx, geoW, geoS, geoE, geoN, outW, outH) {
    const { ifds, BW, BN, lonSpan, latSpan, nodata } = meta;
    const ifd  = ifds[ifdIdx];
    const imgW = ifd[256], imgH = ifd[257], tw = ifd[322], th = ifd[323];
    const nTX  = Math.ceil(imgW / tw);

    const fPx1 = (geoW - BW) / lonSpan * imgW, fPx2 = (geoE - BW) / lonSpan * imgW;
    const fPy1 = (BN - geoN) / latSpan * imgH, fPy2 = (BN - geoS) / latSpan * imgH;

    const px1 = Math.max(0, Math.floor(fPx1)), px2 = Math.min(imgW, Math.ceil(fPx2));
    const py1 = Math.max(0, Math.floor(fPy1)), py2 = Math.min(imgH, Math.ceil(fPy2));
    if (px2 <= px1 || py2 <= py1) return null;

    const winW = px2 - px1, winH = py2 - py1;
    const ndVal = (typeof nodata === 'number') ? nodata : -9999;
    const win  = new Int16Array(winW * winH).fill(ndVal);

    const jobs = [];
    for (let ty = Math.floor(py1/th); ty < Math.ceil(py2/th); ty++)
      for (let tx = Math.floor(px1/tw); tx < Math.ceil(px2/tw); tx++)
        jobs.push(getBlock(cogUrl, ifdIdx, ty*nTX + tx, ifd).then(t => ({ tx, ty, t })));
    for (const { tx, ty, t } of await Promise.all(jobs)) {
      const cx1 = Math.max(px1, tx*tw),  cx2 = Math.min(px2, (tx+1)*tw);
      const cy1 = Math.max(py1, ty*th),  cy2 = Math.min(py2, (ty+1)*th);
      for (let r = cy1; r < cy2; r++)
        for (let c = cx1; c < cx2; c++)
          win[(r - py1)*winW + (c - px1)] = t[(r - ty*th)*tw + (c - tx*tw)];
    }

    const out    = new Int16Array(outW * outH).fill(ndVal);
    const fWinW  = fPx2 - fPx1, fWinH = fPy2 - fPy1;
    for (let oy = 0; oy < outH; oy++) {
      const wy = Math.floor(fPy1 + oy/outH * fWinH) - py1;
      if (wy < 0 || wy >= winH) continue;
      for (let ox = 0; ox < outW; ox++) {
        const wx = Math.floor(fPx1 + ox/outW * fWinW) - px1;
        if (wx < 0 || wx >= winW) continue;
        out[oy*outW + ox] = win[wy*winW + wx];
      }
    }
    return out;
  }

  // ── Protocol registration ──────────────────────────────────────────────────

  let _emptyTile = null;
  async function emptyTile() {
    if (!_emptyTile) {
      const c = new OffscreenCanvas(256, 256);
      c.getContext('2d'); // must acquire context before convertToBlob
      _emptyTile = await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer();
    }
    return _emptyTile;
  }

  function initCogProtocol(maplibregl, protocolName = 'cog') {
    maplibregl.addProtocol(protocolName, async (params, abort) => {
      const withoutScheme = params.url.slice(protocolName.length + 3);
      const sep           = withoutScheme.indexOf('/');
      const colormapName  = withoutScheme.slice(0, sep);
      const rest          = withoutScheme.slice(sep + 1);

      const parts  = rest.split('/');
      const tY     = +parts[parts.length - 1];
      const tX     = +parts[parts.length - 2];
      const tZ     = +parts[parts.length - 3];
      const cogUrl = parts.slice(0, -3).join('/');

      const colorize = _colormaps.get(colormapName);
      if (!colorize) {
        console.error(`[cog] unknown colormap: "${colormapName}". Register it with CogProtocol.registerColormap().`);
        return { data: await emptyTile() };
      }

      const n  = 2 ** tZ;
      const gW = tX / n * 360 - 180,       gE = (tX + 1) / n * 360 - 180;
      const gN = Math.atan(Math.sinh(Math.PI * (1 - 2 *  tY      / n))) * 180 / Math.PI;
      const gS = Math.atan(Math.sinh(Math.PI * (1 - 2 * (tY + 1) / n))) * 180 / Math.PI;

      try {
        const meta = await loadMeta(cogUrl);
        const { BE, BW, BN, BS, ifdRes, ifds } = meta;
        if (gW >= BE || gE <= BW || gS >= BN || gN <= BS) return { data: await emptyTile() };

        const targetRes = (gE - gW) / 256;
        let best = ifds.length - 1;
        for (let i = 0; i < ifds.length; i++) { if (ifdRes[i] >= targetRes) { best = i; break; } }

        const data = await readWindow(cogUrl, meta, best, gW, gS, gE, gN, 256, 256);
        if (!data || abort.signal.aborted) return { data: await emptyTile() };

        const canvas = new OffscreenCanvas(256, 256);
        const ctx    = canvas.getContext('2d');
        const px     = ctx.createImageData(256, 256);

        for (let py = 0; py < 256; py++) {
          const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (tY + (py + 0.5) / 256) / n))) * 180 / Math.PI;
          if (lat <= gS || lat >= gN) continue;
          const srcY = Math.floor((gN - lat) / (gN - gS) * 256);
          if (srcY < 0 || srcY >= 256) continue;
          const rowOff = srcY * 256;
          for (let pxc = 0; pxc < 256; pxc++) {
            const rgba = colorize(data[rowOff + pxc]);
            if (!rgba) continue;
            const ci = (py * 256 + pxc) * 4;
            px.data[ci] = rgba[0]; px.data[ci+1] = rgba[1]; px.data[ci+2] = rgba[2]; px.data[ci+3] = rgba[3];
          }
        }

        if (abort.signal.aborted) return { data: await emptyTile() };
        ctx.putImageData(px, 0, 0);
        return { data: await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer() };
      } catch (e) {
        if (!abort.signal.aborted) console.error('[cog]', e);
        return { data: await emptyTile() };
      }
    });
  }

  // ── Point query ───────────────────────────────────────────────────────────

  async function queryValue(cogUrl, lng, lat) {
    const meta = await loadMeta(cogUrl);
    const { ifds, BW, BN, BE, BS, lonSpan, latSpan, nodata } = meta;
    if (lng < BW || lng > BE || lat < BS || lat > BN) return null;

    const ifd  = ifds[0];
    const imgW = ifd[256], imgH = ifd[257];
    const tw   = ifd[322], th   = ifd[323];
    const nTX  = Math.ceil(imgW / tw);

    const px = Math.floor((lng - BW) / lonSpan * imgW);
    const py = Math.floor((BN  - lat) / latSpan * imgH);
    if (px < 0 || px >= imgW || py < 0 || py >= imgH) return null;

    const blockIdx = Math.floor(py / th) * nTX + Math.floor(px / tw);
    const tile     = await getBlock(cogUrl, 0, blockIdx, ifd);
    const value    = tile[(py % th) * tw + (px % tw)];
    return value === nodata ? null : value;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function preload(cogUrl) { return loadMeta(cogUrl); }

  global.CogProtocol = { initCogProtocol, registerColormap, makeStepColormap, queryValue, preload };

})(typeof globalThis !== 'undefined' ? globalThis : window);
