// ORCUS Station — 资源生成脚本（可复现）
// 运行: node tools/generate.mjs  （在 arg-orcus 目录下）
import { deflateSync } from "node:zlib";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

/* ============ PNG 编码器（纯手写） ============ */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePNG(width, height, rgb) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: None
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ============ 画布 ============ */
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

function canvas(w, h) {
  return { w, h, data: Buffer.alloc(w * h * 3) };
}
function set(c, x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = (y * c.w + x) * 3;
  c.data[i] = r; c.data[i + 1] = g; c.data[i + 2] = b;
}
function vGrad(c, y0, y1, c0, c1) {
  for (let y = y0; y <= y1; y++) {
    const t = y1 === y0 ? 0 : (y - y0) / (y1 - y0);
    const r = clamp(c0[0] + (c1[0] - c0[0]) * t);
    const g = clamp(c0[1] + (c1[1] - c0[1]) * t);
    const b = clamp(c0[2] + (c1[2] - c0[2]) * t);
    for (let x = 0; x < c.w; x++) set(c, x, y, r, g, b);
  }
}
function rect(c, x0, y0, x1, y1, col) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(c, x, y, col[0], col[1], col[2]);
}
function line(c, x0, y0, x1, y1, col, w = 1) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let s = 0; s <= steps; s++) {
    const t = steps === 0 ? 0 : s / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    for (let i = 0; i < w; i++) for (let j = 0; j < w; j++) set(c, x + i, y + j, col[0], col[1], col[2]);
  }
}
function circle(c, cx, cy, rad, col, falloff = 1) {
  for (let y = Math.floor(cy - rad); y <= cy + rad; y++) {
    for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= rad) {
        const a = falloff === 1 ? 1 : Math.max(0, 1 - d / rad) ** falloff;
        const i = (y * c.w + x) * 3;
        if (i < 0 || i + 2 >= c.data.length) continue;
        c.data[i] = clamp(c.data[i] * (1 - a) + col[0] * a);
        c.data[i + 1] = clamp(c.data[i + 1] * (1 - a) + col[1] * a);
        c.data[i + 2] = clamp(c.data[i + 2] * (1 - a) + col[2] * a);
      }
    }
  }
}
function noise(c, amt) {
  for (let i = 0; i < c.data.length; i += 3) {
    const n = (Math.random() * 2 - 1) * amt;
    c.data[i] = clamp(c.data[i] + n);
    c.data[i + 1] = clamp(c.data[i + 1] + n);
    c.data[i + 2] = clamp(c.data[i + 2] + n);
  }
}
function scanlines(c) {
  for (let y = 0; y < c.h; y += 3) {
    for (let x = 0; x < c.w; x++) {
      const i = (y * c.w + x) * 3;
      c.data[i] = clamp(c.data[i] * 0.86);
      c.data[i + 1] = clamp(c.data[i + 1] * 0.86);
      c.data[i + 2] = clamp(c.data[i + 2] * 0.86);
    }
  }
}

/* ============ 5x7 点阵字体 ============ */
const FONT = {
  "A": ["01110","10001","10001","11111","10001","10001","10001"],
  "B": ["11110","10001","10001","11110","10001","10001","11110"],
  "C": ["01110","10001","10000","10000","10000","10001","01110"],
  "D": ["11110","10001","10001","10001","10001","10001","11110"],
  "E": ["11111","10000","10000","11110","10000","10000","11111"],
  "F": ["11111","10000","10000","11110","10000","10000","10000"],
  "G": ["01110","10001","10000","10111","10001","10001","01111"],
  "H": ["10001","10001","10001","11111","10001","10001","10001"],
  "I": ["01110","00100","00100","00100","00100","00100","01110"],
  "J": ["00111","00010","00010","00010","00010","10010","01100"],
  "K": ["10001","10010","10100","11000","10100","10010","10001"],
  "L": ["10000","10000","10000","10000","10000","10000","11111"],
  "M": ["10001","11011","10101","10101","10001","10001","10001"],
  "N": ["10001","11001","10101","10011","10001","10001","10001"],
  "O": ["01110","10001","10001","10001","10001","10001","01110"],
  "P": ["11110","10001","10001","11110","10000","10000","10000"],
  "Q": ["01110","10001","10001","10001","10101","10010","01101"],
  "R": ["11110","10001","10001","11110","10100","10010","10001"],
  "S": ["01111","10000","10000","01110","00001","00001","11110"],
  "T": ["11111","00100","00100","00100","00100","00100","00100"],
  "U": ["10001","10001","10001","10001","10001","10001","01110"],
  "V": ["10001","10001","10001","10001","10001","01010","00100"],
  "W": ["10001","10001","10001","10101","10101","10101","01010"],
  "X": ["10001","10001","01010","00100","01010","10001","10001"],
  "Y": ["10001","10001","01010","00100","00100","00100","00100"],
  "Z": ["11111","00001","00010","00100","01000","10000","11111"],
  "0": ["01110","10001","10011","10101","11001","10001","01110"],
  "1": ["00100","01100","00100","00100","00100","00100","01110"],
  "2": ["01110","10001","00001","00010","00100","01000","11111"],
  "3": ["11111","00010","00100","00010","00001","10001","01110"],
  "4": ["00010","00110","01010","10010","11111","00010","00010"],
  "5": ["11111","10000","11110","00001","00001","10001","01110"],
  "6": ["00110","01000","10000","11110","10001","10001","01110"],
  "7": ["11111","00001","00010","00100","01000","01000","01000"],
  "8": ["01110","10001","10001","01110","10001","10001","01110"],
  "9": ["01110","10001","10001","01111","00001","00010","01100"],
  ":": ["00000","00100","00100","00000","00100","00100","00000"],
  "-": ["00000","00000","00000","01110","00000","00000","00000"],
  ".": ["00000","00000","00000","00000","00000","01100","01100"],
  "/": ["00001","00010","00100","01000","10000","00000","00000"],
  " ": ["00000","00000","00000","00000","00000","00000","00000"],
  "?": ["01110","10001","00001","00010","00100","00000","00100"],
};

function drawText(c, text, x0, y0, scale, col) {
  let ci = 0;
  for (const ch of text.toUpperCase()) {
    const g = FONT[ch] || FONT["?"];
    for (let row = 0; row < 7; row++) {
      for (let cx = 0; cx < 5; cx++) {
        if (g[row][cx] === "1") {
          const px = x0 + (ci * 6 + cx) * scale;
          const py = y0 + row * scale;
          for (let sy = 0; sy < scale; sy++)
            for (let sx = 0; sx < scale; sx++)
              set(c, px + sx, py + sy, col[0], col[1], col[2]);
        }
      }
    }
    ci++;
  }
}

/* ============ OSD（监控叠加层） ============ */
function osd(c, camId, clock, extra) {
  const GREEN = [70, 190, 120];
  const RED = [220, 60, 50];
  drawText(c, "REC", 14, 12, 2, RED);
  circle(c, 14 + 12, 12 + 12, 4, RED, 1);
  drawText(c, camId, 70, 12, 2, GREEN);
  drawText(c, clock, c.w - 14 - 14 * 6 * 1 - (clock.length * 6) * 2, 12, 2, GREEN);
  drawText(c, extra, 14, c.h - 22, 1, GREEN);
}

/* ============ 场景渲染 ============ */
function renderCam1() {
  const c = canvas(800, 450);
  vGrad(c, 0, 270, [4, 6, 16], [14, 18, 38]);
  for (let i = 0; i < 140; i++) set(c, (Math.random() * 800) | 0, (Math.random() * 200) | 0, 200, 220, 255);
  circle(c, 690, 70, 26, [210, 225, 255], 2);
  // 远山
  line(c, 0, 300, 260, 250, [20, 26, 40], 1);
  line(c, 260, 250, 520, 300, [20, 26, 40], 1);
  line(c, 520, 300, 800, 255, [16, 20, 34], 1);
  for (let y = 250; y <= 300; y++) for (let x = 0; x < 800; x++) {
    const i = (y * 800 + x) * 3;
    if (c.data[i] < 40) set(c, x, y, 18, 24, 38);
  }
  // 雪地
  vGrad(c, 300, 449, [152, 160, 176], [116, 124, 142]);
  // 天线杆
  rect(c, 548, 80, 552, 300, [30, 34, 44]);
  line(c, 536, 120, 564, 120, [30, 34, 44], 2);
  line(c, 530, 180, 570, 180, [30, 34, 44], 2);
  circle(c, 550, 78, 5, [255, 60, 40], 1);
  rect(c, 500, 300, 600, 308, [36, 40, 50]);
  noise(c, 14);
  scanlines(c);
  osd(c, "CAM-01", "23:59:58", "EXT-SNOWFIELD");
  return c;
}

function renderCam2() {
  const c = canvas(800, 450);
  vGrad(c, 0, 449, [10, 12, 18], [6, 7, 11]);
  // 走廊透视墙线
  for (let i = 0; i < 12; i++) {
    const t = i / 11;
    const top = 40 + t * 200;
    const bot = 420 - t * 260;
    line(c, 0, top, 400, 200, [34, 38, 48], 1);
    line(c, 800, top, 400, 200, [34, 38, 48], 1);
    line(c, 0, bot, 400, 240, [24, 27, 35], 1);
    line(c, 800, bot, 400, 240, [24, 27, 35], 1);
  }
  // 顶灯
  circle(c, 400, 90, 40, [200, 200, 190], 3);
  circle(c, 400, 90, 8, [240, 240, 230], 1);
  // 门
  rect(c, 360, 260, 440, 450, [16, 18, 24]);
  rect(c, 372, 268, 428, 450, [20, 22, 28]);
  circle(c, 420, 340, 4, [150, 150, 140], 1);
  noise(c, 16);
  scanlines(c);
  osd(c, "CAM-02", "23:59:59", "CORRIDOR-B");
  return c;
}

function renderCam3() {
  const c = canvas(800, 450);
  vGrad(c, 0, 200, [2, 3, 7], [6, 8, 14]);
  // 冰面（深色）
  vGrad(c, 200, 449, [7, 9, 12], [4, 5, 8]);
  // 冰面裂缝
  line(c, 60, 430, 740, 210, [120, 160, 180], 2);
  line(c, 160, 420, 700, 220, [70, 100, 120], 1);
  line(c, 300, 250, 560, 420, [50, 75, 95], 1);
  // 远处微弱蓝光
  circle(c, 640, 160, 60, [40, 70, 120], 4);
  // 视觉隐写：左下角暗色文字 ORCUS（调高对比度可见）
  drawText(c, "RADIO", 26, 388, 3, [52, 60, 74]);
  noise(c, 3);
  scanlines(c);
  osd(c, "CAM-03", "03:33:33", "ICE-SURFACE // ANOMALY");
  return c;
}

function renderCam4() {
  const c = canvas(800, 450);
  vGrad(c, 0, 449, [16, 20, 30], [8, 10, 16]);
  rect(c, 80, 260, 720, 440, [26, 30, 40]);
  rect(c, 120, 300, 300, 400, [40, 46, 58]);
  rect(c, 330, 300, 560, 400, [36, 42, 54]);
  circle(c, 560, 200, 12, [200, 60, 40], 2);
  // 屏幕亮光
  rect(c, 180, 120, 460, 260, [30, 70, 90]);
  rect(c, 190, 130, 450, 250, [40, 120, 150]);
  circle(c, 320, 190, 90, [60, 160, 190], 2);
  noise(c, 12);
  scanlines(c);
  osd(c, "CAM-04", "23:59:57", "LAB-2");
  return c;
}

function renderCam5() {
  const c = canvas(800, 450);
  vGrad(c, 0, 449, [8, 9, 14], [5, 6, 9]);
  // 窗户（雪光）
  rect(c, 300, 60, 500, 200, [110, 140, 175]);
  rect(c, 308, 68, 492, 192, [150, 180, 215]);
  line(c, 400, 60, 400, 200, [8, 9, 14], 3);
  line(c, 300, 130, 500, 130, [8, 9, 14], 3);
  // 床
  rect(c, 90, 300, 700, 330, [40, 44, 54]);
  rect(c, 100, 320, 690, 440, [30, 33, 41]);
  rect(c, 110, 280, 230, 320, [46, 50, 62]);
  // 挂钟
  circle(c, 120, 100, 24, [50, 54, 66], 1);
  line(c, 120, 100, 120, 84, [180, 180, 190], 2);
  line(c, 120, 100, 134, 108, [180, 180, 190], 2);
  noise(c, 12);
  scanlines(c);
  osd(c, "CAM-05", "23:59:59", "QUARTERS");
  return c;
}

function renderCam6() {
  const c = canvas(800, 450);
  vGrad(c, 0, 449, [10, 11, 15], [4, 5, 8]);
  rect(c, 100, 220, 700, 440, [28, 30, 38]);
  rect(c, 140, 160, 300, 220, [34, 36, 44]);
  rect(c, 360, 140, 640, 220, [32, 34, 42]);
  // 红灯
  circle(c, 220, 150, 10, [220, 40, 30], 2);
  // 电缆
  line(c, 300, 220, 400, 320, [60, 64, 76], 3);
  line(c, 400, 320, 520, 250, [60, 64, 76], 3);
  // 金属反光
  line(c, 150, 300, 300, 440, [60, 66, 80], 2);
  noise(c, 14);
  scanlines(c);
  osd(c, "CAM-06", "23:59:56", "GENERATOR");
  return c;
}

/* ============ LSB 隐写 ============ */
function lsbHide(c, message) {
  const payload = Buffer.concat([
    Buffer.from("STEGO1", "ascii"),
    Buffer.from([message.length]),
    Buffer.from(message, "ascii"),
  ]);
  const bits = [];
  for (const b of payload) for (let k = 7; k >= 0; k--) bits.push((b >> k) & 1);
  const y = c.h - 2; // 隐写在倒数第二行，R 通道最低位
  let bi = 0;
  for (let x = 0; x < c.w && bi < bits.length; x++) {
    const i = (y * c.w + x) * 3;
    c.data[i] = (c.data[i] & 0xfe) | bits[bi++];
  }
  if (bi < bits.length) throw new Error("message too long for LSB row");
}

/* ============ WAV 摩尔斯音频 ============ */
const MORSE = {
  "A": ".-","B": "-...","C": "-.-.","D": "-..","E": ".","F": "..-.","G": "--.",
  "H": "....","I": "..","J": ".---","K": "-.-","L": ".-..","M": "--","N": "-.",
  "O": "---","P": ".--.","Q": "--.-","R": ".-.","S": "...","T": "-","U": "..-",
  "V": "...-","W": ".--","X": "-..-","Y": "-.--","Z": "--..",
  "0": "-----","1": ".----","2": "..---","3": "...--","4": "....-","5": ".....",
  "6": "-....","7": "--...","8": "---..","9": "----.",
};

function knock(duration, sampleRate) {
  const n = Math.floor(duration * sampleRate);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t * 10); // 慢衰减，让长音(划)与短音(点)能量包络可区分
    const s = Math.sin(2 * Math.PI * 168 * t) + 0.35 * (Math.random() * 2 - 1);
    out[i] = s * env * 0.75;
  }
  return out;
}
function silence(duration, sampleRate) {
  return new Float64Array(Math.floor(duration * sampleRate));
}
function morseSamples(text, sampleRate) {
  const chunks = [];
  const words = text.toUpperCase().split(" ");
  for (let wi = 0; wi < words.length; wi++) {
    for (let ci = 0; ci < words[wi].length; ci++) {
      const code = MORSE[words[wi][ci]];
      if (!code) continue;
      for (let si = 0; si < code.length; si++) {
        chunks.push(knock(code[si] === "-" ? 0.24 : 0.08, sampleRate));
        if (si < code.length - 1) chunks.push(silence(0.08, sampleRate));
      }
      if (ci < words[wi].length - 1) chunks.push(silence(0.26, sampleRate));
    }
    if (wi < words.length - 1) chunks.push(silence(0.5, sampleRate));
  }
  const total = chunks.reduce((s, a) => s + a.length, 0);
  const out = new Float64Array(total);
  let o = 0;
  for (const a of chunks) { out.set(a, o); o += a.length; }
  return out;
}
function encodeWav(samples, sampleRate) {
  const n = samples.length;
  const dataSize = n * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

/* ============ 主流程 ============ */
export async function generateAll(rootDir) {
  await mkdir(path.join(rootDir, "assets/img"), { recursive: true });
  await mkdir(path.join(rootDir, "assets/audio"), { recursive: true });

  const cams = [renderCam1, renderCam2, renderCam3, renderCam4, renderCam5, renderCam6];
  const files = [];
  for (let i = 0; i < cams.length; i++) {
    const c = cams[i]();
    if (i === 2) lsbHide(c, "O"); // CAM-03 LSB 藏密码碎片 1
    const png = encodePNG(c.w, c.h, c.data);
    const name = `cam${i + 1}.png`;
    await writeFile(path.join(rootDir, "assets/img", name), png);
    files.push(name + " (" + png.length + " bytes)");
  }

  const sr = 44100;
  const wav = encodeWav(morseSamples("CAM 3", sr), sr);
  await writeFile(path.join(rootDir, "assets/audio/signal.wav"), wav);
  files.push("signal.wav (" + wav.length + " bytes, " + (wav.length - 44) / 2 / sr + "s)");

  return files;
}

// 直接运行入口
const isMain = process.argv[1] && import.meta.url === "file://" + process.argv[1].replace(/\\/g, "/");
if (isMain) {
  const root = process.cwd();
  const out = await generateAll(root);
  console.log("generated:", out.join(", "));
}
