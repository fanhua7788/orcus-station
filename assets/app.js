/* ============ ORCUS STATION — 共享逻辑 ============ */
"use strict";

/* --- 密码哈希（防翻源码：源码里只有哈希，没有明文） --- */
const ORCUS_HASH = "8fdd5065c4a797c9a558f29dd81129b0cf7f0ab1caba424323b1df38f0ced972";

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* --- 摩尔斯码 --- */
const MORSE = {
  "A": ".-", "B": "-...", "C": "-.-.", "D": "-..", "E": ".", "F": "..-.",
  "G": "--.", "H": "....", "I": "..", "J": ".---", "K": "-.-", "L": ".-..",
  "M": "--", "N": "-.", "O": "---", "P": ".--.", "Q": "--.-", "R": ".-.",
  "S": "...", "T": "-", "U": "..-", "V": "...-", "W": ".--", "X": "-..-",
  "Y": "-.--", "Z": "--..",
  "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-",
  "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----."
};

function charToMorse(ch) {
  return MORSE[ch.toUpperCase()] || null;
}
function textToMorse(text) {
  return text.toUpperCase().split("").map((c) => (c === " " ? "/" : charToMorse(c) || "?")).join(" ");
}

/* --- Web Audio：合成"冰下敲击声" --- */
let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    _audioCtx = new AC();
  }
  return _audioCtx;
}

function scheduleKnock(ctx, time, dur) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = 168;
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(0.75, time + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(time);
  osc.stop(time + dur + 0.02);
}

/* 把一段摩尔斯文本调度成敲击声，返回总时长(秒) */
function scheduleMorseKnocks(text) {
  const ctx = getAudioCtx();
  if (!ctx) return 0;
  const DOT = 0.08, DASH = 0.24, GAP = 0.08, CGAP = 0.26, WGAP = 0.5;
  let t = ctx.currentTime + 0.08;
  const words = text.toUpperCase().split(" ");
  for (let wi = 0; wi < words.length; wi++) {
    const word = words[wi];
    for (let ci = 0; ci < word.length; ci++) {
      const code = MORSE[word[ci]];
      if (!code) continue;
      for (let si = 0; si < code.length; si++) {
        const dur = code[si] === "-" ? DASH : DOT;
        scheduleKnock(ctx, t, dur);
        t += dur + GAP;
      }
      if (ci < word.length - 1) t += CGAP - GAP;
    }
    if (wi < words.length - 1) t += WGAP - CGAP;
  }
  return t - ctx.currentTime;
}

/* 播放一个摩尔斯文本，完成后回调 */
async function playMorse(text) {
  const ctx = getAudioCtx();
  if (!ctx) throw new Error("no audio");
  if (ctx.state === "suspended") await ctx.resume();
  const dur = scheduleMorseKnocks(text);
  return dur;
}

/* --- 控制台彩蛋（F12 的人才能看到） --- */
function consoleEgg(msg) {
  const lines = [
    "%cORCUS STATION %c// INTERNAL TERMINAL 07",
    "color:#46d0e0;font-weight:bold;font-size:14px",
    "color:#64788a;font-size:12px"
  ];
  console.log(lines[0], lines[1], lines[2]);
  console.log("%c" + msg, "color:#4fd67a;font-size:13px");
}

/* --- 三级提示系统：页面里放 .hint-box，点按钮逐级解锁 --- */
function initHints() {
  document.querySelectorAll(".hint-box").forEach(function (box) {
    box.querySelectorAll(".hint-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var level = +btn.dataset.level;
        box.querySelectorAll(".hint-text").forEach(function (t) {
          if (+t.dataset.level <= level) t.classList.add("show");
        });
        box.querySelectorAll(".hint-btn").forEach(function (b) {
          if (+b.dataset.level <= level) b.classList.add("used");
        });
      });
    });
  });
}
initHints();

/* --- 残片进度追踪（localStorage） --- */
const ORCUS_SHARDS = ["O", "R", "C", "U", "S"];
const ORCUS_SHARD_KEY = "orcus.shards.v1";

function getShards() {
  try {
    const v = localStorage.getItem(ORCUS_SHARD_KEY);
    const arr = v ? JSON.parse(v) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function collectShard(letter) {
  const s = getShards();
  if (ORCUS_SHARDS.indexOf(letter) !== -1 && s.indexOf(letter) === -1) {
    s.push(letter);
    try { localStorage.setItem(ORCUS_SHARD_KEY, JSON.stringify(s)); } catch (e) {}
  }
  renderProgress();
}
function resetProgress() {
  try { localStorage.removeItem(ORCUS_SHARD_KEY); } catch (e) {}
  renderProgress();
}
function renderProgress() {
  const collected = getShards();
  document.querySelectorAll("[data-progress]").forEach(function (el) {
    let html = "";
    ORCUS_SHARDS.forEach(function (l) {
      const has = collected.indexOf(l) !== -1;
      html += '<span class="shard' + (has ? " got" : "") + '">' + (has ? l : "·") + "</span>";
    });
    el.innerHTML = html;
  });
  document.querySelectorAll("[data-progress-count]").forEach(function (el) {
    el.textContent = collected.length + " / " + ORCUS_SHARDS.length;
  });
}
renderProgress();

/* --- 氛围过渡页组件：隐藏页各自调用 initBoot({...}) --- */
function initBoot(config) {
  var cfg = config || {};
  var skipKey = cfg.key || "orcus.boot.default";
  var bootEl = document.getElementById("boot");
  if (!bootEl) return;

  // 同一会话已接入过 → 直接跳过
  if (sessionStorage.getItem(skipKey) === "1") {
    bootEl.style.display = "none";
    document.body.classList.remove("locked");
    return;
  }

  var lines = cfg.lines || [];
  var logo = cfg.logo || "ORCUS<span class='boot-dot'>●</span>STATION";
  var buttonText = cfg.button || "▶ 接入";
  var hintText = cfg.hint || "PROCEED?";
  var tone = cfg.tone || 55;
  var effect = cfg.effect || "snow";

  var logoEl = document.getElementById("bootLogo");
  var termEl = document.getElementById("bootTerm");
  var enterEl = document.getElementById("bootEnter");
  var hintEl = document.getElementById("bootHint");
  var cv = document.getElementById("bootCanvas");
  if (logoEl) logoEl.innerHTML = logo;
  if (enterEl) enterEl.textContent = buttonText;
  if (hintEl) hintEl.textContent = hintText;

  // 打字机
  var li = 0;
  function typeLine() {
    if (li >= lines.length) {
      if (enterEl) enterEl.style.display = "";
      if (hintEl) hintEl.style.display = "";
      return;
    }
    var text = lines[li];
    var div = document.createElement("div");
    if (termEl) termEl.appendChild(div);
    var i = 0;
    (function typeChar() {
      if (i < text.length) {
        div.textContent = text.slice(0, i + 1);
        i++;
        setTimeout(typeChar, li === 0 ? 45 : 14);
      } else {
        li++;
        setTimeout(typeLine, 240);
      }
    })();
  }

  // canvas 效果
  var ctx = cv ? cv.getContext("2d") : null;
  function sizeCanvas() { if (cv) { cv.width = innerWidth; cv.height = innerHeight; } }
  sizeCanvas();
  addEventListener("resize", sizeCanvas);

  var state = null;
  if (effect === "snow") {
    state = { flakes: [] };
    for (var f = 0; f < 90; f++) state.flakes.push({ x: Math.random()*innerWidth, y: Math.random()*innerHeight, r: Math.random()*2+0.6, s: Math.random()*0.6+0.25, d: Math.random()*0.5-0.25 });
  } else if (effect === "data") {
    state = { cols: Math.max(1, Math.floor(innerWidth / 14)), drops: [] };
    for (var c = 0; c < state.cols; c++) state.drops.push(Math.random() * -40);
  } else if (effect === "crack") {
    state = { pts: [] };
    for (var p = 0; p < 42; p++) state.pts.push({ x: Math.random()*innerWidth, y: Math.random()*innerHeight, vx: (Math.random()*2-1)*0.4, vy: (Math.random()*2-1)*0.4 });
  } else {
    state = { t: 0 }; // static / glitch
  }

  function frame() {
    if (!ctx) return;
    var w = cv.width, h = cv.height;
    if (effect === "snow") {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(205,225,245,0.75)";
      for (var i = 0; i < state.flakes.length; i++) {
        var fl = state.flakes[i];
        fl.y += fl.s; fl.x += fl.d;
        if (fl.y > h) { fl.y = -3; fl.x = Math.random()*w; }
        if (fl.x > w) fl.x = 0; if (fl.x < 0) fl.x = w;
        ctx.beginPath(); ctx.arc(fl.x, fl.y, fl.r, 0, Math.PI*2); ctx.fill();
      }
    } else if (effect === "static") {
      ctx.fillStyle = "rgba(0,0,0,0.09)";
      ctx.fillRect(0, 0, w, h);
      for (var s = 0; s < 260; s++) {
        var grey = Math.floor(110 + Math.random()*130);
        ctx.fillStyle = "rgba(" + grey + "," + grey + "," + Math.min(255, grey+18) + "," + (Math.random()*0.3).toFixed(2) + ")";
        ctx.fillRect(Math.random()*w, Math.random()*h, Math.random()*3+1, Math.random()*3+1);
      }
    } else if (effect === "data") {
      ctx.fillStyle = "rgba(0,0,0,0.09)";
      ctx.fillRect(0, 0, w, h);
      ctx.font = "14px monospace";
      ctx.fillStyle = "#2a6a3a";
      for (var d = 0; d < state.cols; d++) {
        var ch = String.fromCharCode(0x30A0 + Math.floor(Math.random()*96));
        ctx.fillText(ch, d*14, state.drops[d]*14);
        if (state.drops[d]*14 > h && Math.random() > 0.975) state.drops[d] = 0;
        state.drops[d]++;
      }
    } else if (effect === "crack") {
      ctx.fillStyle = "rgba(0,0,0,0.05)";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(224,164,74,0.55)";
      for (var pt = 0; pt < state.pts.length; pt++) {
        var P = state.pts[pt];
        P.x += P.vx; P.y += P.vy;
        if (P.x < 0 || P.x > w) P.vx *= -1;
        if (P.y < 0 || P.y > h) P.vy *= -1;
        ctx.fillRect(P.x, P.y, 2, 2);
      }
    } else if (effect === "glitch") {
      ctx.fillStyle = "rgba(0,0,0,0.07)";
      ctx.fillRect(0, 0, w, h);
      for (var g = 0; g < 7; g++) {
        var gy = Math.random()*h, gh = Math.random()*7+1;
        ctx.fillStyle = "rgba(70,208,224," + (Math.random()*0.18).toFixed(2) + ")";
        ctx.fillRect(0, gy, w, gh);
        ctx.fillStyle = "rgba(224,82,74,0.12)";
        ctx.fillRect(Math.random()*w, gy, Math.random()*120+24, gh);
      }
    }
    requestAnimationFrame(frame);
  }
  if (ctx) frame();

  // 接入
  if (enterEl) {
    enterEl.addEventListener("click", function () {
      try {
        var ac = getAudioCtx();
        if (ac) {
          if (ac.state === "suspended") ac.resume();
          var osc = ac.createOscillator();
          var g = ac.createGain();
          osc.type = "sine";
          osc.frequency.value = tone;
          g.gain.setValueAtTime(0.0001, ac.currentTime);
          g.gain.exponentialRampToValueAtTime(0.3, ac.currentTime + 0.5);
          g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 2.2);
          osc.connect(g).connect(ac.destination);
          osc.start(); osc.stop(ac.currentTime + 2.3);
        }
      } catch (e) {}
      sessionStorage.setItem(skipKey, "1");
      bootEl.classList.add("fade");
      document.body.classList.remove("locked");
      setTimeout(function () { bootEl.style.display = "none"; }, 1100);
    });
  }

  typeLine();
}
