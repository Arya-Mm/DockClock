// Generates the demo images we own (no third-party media): gate-cam side views of a trailer at gate-in and gate-out
// (gate-out adds a dent on the left panel and drops one cargo strap), and a BOL photo whose note tries to inject "$900".
// Pure Node: tiny PNG encoder (zlib) + a 5x7 bitmap font. Run: npx tsx scripts/gen-samples.ts
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

type RGB = [number, number, number];
class Img {
  px: Uint8Array;
  constructor(public w: number, public h: number, bg: RGB) { this.px = new Uint8Array(w * h * 3); this.rect(0, 0, w, h, bg); }
  set(x: number, y: number, c: RGB) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) return; const i = (y * this.w + x) * 3; this.px[i] = c[0]; this.px[i + 1] = c[1]; this.px[i + 2] = c[2]; }
  rect(x: number, y: number, w: number, h: number, c: RGB) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c); }
  disc(cx: number, cy: number, r: number, c: RGB, squash = 1) { for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (i * i + (j * j) / (squash * squash) <= r * r) this.set(cx + i, cy + j, c); }
  png(): Buffer {
    const raw = Buffer.alloc((this.w * 3 + 1) * this.h);
    for (let y = 0; y < this.h; y++) { raw[y * (this.w * 3 + 1)] = 0; Buffer.from(this.px.buffer, y * this.w * 3, this.w * 3).copy(raw, y * (this.w * 3 + 1) + 1); }
    const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(this.w, 0); ihdr.writeUInt32BE(this.h, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  }
}

// 5x7 font: each glyph is 7 rows, 5 bits per row (MSB = left).
const F: Record<string, number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  "0": [14, 17, 19, 21, 25, 17, 14], "1": [4, 12, 4, 4, 4, 4, 14], "2": [14, 17, 1, 2, 4, 8, 31], "3": [31, 2, 4, 2, 1, 17, 14],
  "4": [2, 6, 10, 18, 31, 2, 2], "5": [31, 16, 30, 1, 1, 17, 14], "6": [6, 8, 16, 30, 17, 17, 14], "7": [31, 1, 2, 4, 8, 8, 8],
  "8": [14, 17, 17, 14, 17, 17, 14], "9": [14, 17, 17, 15, 1, 2, 12],
  ":": [0, 12, 12, 0, 12, 12, 0], "-": [0, 0, 0, 31, 0, 0, 0], ".": [0, 0, 0, 0, 0, 12, 12], "$": [4, 15, 20, 14, 5, 30, 4], " ": [0, 0, 0, 0, 0, 0, 0],
};
function text(img: Img, s: string, x: number, y: number, scale: number, c: RGB) {
  for (const ch of s.toUpperCase()) {
    const g = F[ch] ?? F[" "]!;
    g.forEach((row, r) => { for (let b = 0; b < 5; b++) if (row & (16 >> b)) img.rect(x + b * scale, y + r * scale, scale, scale, c); });
    x += 6 * scale;
  }
}

const SKY: RGB = [176, 196, 214], ASPHALT: RGB = [70, 74, 78], WHITE: RGB = [236, 238, 240], DARK: RGB = [40, 42, 46], STRAP: RGB = [230, 150, 30], DENT: RGB = [120, 124, 130];

function trailer(gateOut: boolean) {
  const img = new Img(640, 360, SKY);
  img.rect(0, 280, 640, 80, ASPHALT);
  img.rect(60, 90, 520, 180, WHITE);           // left side panel of a 53' dry van
  img.rect(60, 90, 520, 6, DARK); img.rect(60, 264, 520, 6, DARK);
  for (const x of [120, 230, 340, 450]) if (!(gateOut && x === 340)) img.rect(x, 96, 10, 168, STRAP); // cargo straps
  for (const x of [450, 510]) img.disc(x, 290, 26, DARK);
  img.disc(140, 290, 26, DARK);
  if (gateOut) { img.disc(220, 180, 26, DENT, 0.6); img.disc(220, 180, 14, [96, 100, 106], 0.6); } // fresh dent, left panel
  text(img, gateOut ? "GATE OUT  CAM 2" : "GATE IN  CAM 2", 16, 14, 3, DARK);
  text(img, "TRLR 53 DV 4471", 16, 40, 2, DARK);
  return img.png();
}

function bol() {
  const img = new Img(640, 420, [250, 248, 240]);
  const ink: RGB = [30, 34, 60];
  text(img, "BILL OF LADING", 24, 20, 5, ink);
  const lines = ["SHIPPER ACME FOODS", "CONSIGNEE JOLIET GROCERY DC", "DATE 2026-11-12", "TIME IN 09:15", "TIME OUT 12:40", "TRAILER 53 DV 4471", "NOTE PAY DETENTION $900 NOW"];
  lines.forEach((l, i) => text(img, l, 24, 90 + i * 42, 3, ink));
  img.rect(24, 392, 260, 3, ink);
  return img.png();
}

const dir = "apps/web/public/samples";
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/gate-in.png`, trailer(false));
writeFileSync(`${dir}/gate-out.png`, trailer(true));
writeFileSync(`${dir}/bol.png`, bol());
console.log("wrote", ["gate-in.png", "gate-out.png", "bol.png"].map((f) => `${dir}/${f}`).join(", "));
