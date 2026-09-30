// 依存なしでPNGアイコンを生成する: node tools/make-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
};

// マイク形状(0..1座標)の内側か
function inMic(u, v) {
  const capsule = (() => {
    const r = 0.12, x = 0.5;
    if (v >= 0.30 && v <= 0.50) return Math.abs(u - x) <= r;
    const cy = v < 0.30 ? 0.30 : 0.50;
    return Math.hypot(u - x, v - cy) <= r;
  })();
  const d = Math.hypot(u - 0.5, v - 0.50);
  const arc = v >= 0.50 && d <= 0.245 && d >= 0.215;
  const stem = Math.abs(u - 0.5) <= 0.012 && v >= 0.72 && v <= 0.82;
  const base = Math.abs(u - 0.5) <= 0.12 && v >= 0.82 && v <= 0.845;
  return capsule || arc || stem || base;
}

function makePng(size, file) {
  const bg = [0x4f, 0x46, 0xe5], fg = [255, 255, 255], SS = 3;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        if (inMic((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size)) hit++;
      }
      const a = hit / (SS * SS);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(bg[i] * (1 - a) + fg[i] * a);
      raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  writeFileSync(file, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]));
}

makePng(192, "icons/icon-192.png");
makePng(512, "icons/icon-512.png");
makePng(512, "icons/icon-maskable-512.png");
console.log("icons generated");
