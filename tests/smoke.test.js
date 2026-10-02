/* ==========================================================================
   Functional smoke test — runs the REAL index.html + js/tracks.js +
   js/audio-engine.js + js/app.js inside jsdom and drives the UI the way a
   user would: clicking cards, chips, opening the full player, seeking,
   ending a track, using the keyboard.

   Usage:  node tests/smoke.test.js
   ========================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8")
  // jsdom must not try to fetch the Google Fonts stylesheet
  .replace(/<link[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>/g, "");

const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (e) => errors.push("jsdomError: " + e.message));
virtualConsole.on("error", (...a) => errors.push("console.error: " + a.join(" ")));

const dom = new JSDOM(html, {
  url: "http://localhost:8080/",
  runScripts: "outside-only",
  pretendToBeVisual: true,
  virtualConsole,
});

const { window } = dom;
const { document } = window;

/* ---- minimal media element stand-in (jsdom has no audio engine) ---- */
window.HTMLMediaElement.prototype.play = function () {
  this.__paused = false;
  this.dispatchEvent(new window.Event("play"));
  return Promise.resolve();
};
window.HTMLMediaElement.prototype.pause = function () {
  this.__paused = true;
  this.dispatchEvent(new window.Event("pause"));
};
Object.defineProperty(window.HTMLMediaElement.prototype, "paused", {
  get() { return this.__paused !== false; },
  configurable: true,
});
Object.defineProperty(window.HTMLMediaElement.prototype, "duration", {
  get() { return Number.isFinite(this.__duration) ? this.__duration : NaN; },
  configurable: true,
});
Object.defineProperty(window.HTMLMediaElement.prototype, "currentTime", {
  get() { return this.__time || 0; },
  set(v) { this.__time = v; },
  configurable: true,
});

/* ---- fetch stand-in: serve library.json + accept HEAD probes ---- */
window.fetch = function (url) {
  const u = String(url);
  if (u.indexOf("library.json") > -1) {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, "library.json"), "utf8"));
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
  }
  return Promise.resolve({ ok: true, status: 200 });
};

/* ---- load the real project scripts, in page order ---- */
for (const file of ["js/audio-engine.js", "js/app.js"]) {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  try {
    window.eval(src, { filename: file });
  } catch (e) {
    console.error("SCRIPT FAILED:", file, e);
    process.exit(1);
  }
}

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

let passed = 0;
function assert(cond, label) {
  if (cond) { passed++; console.log("  ok  " + label); }
  else { console.error("  FAIL " + label); process.exitCode = 1; }
}

function click(elm) {
  elm.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
}

(async function main() {
  const audio = $("#audio");
  audio.__duration = 36;

  // library.json loads asynchronously — wait for bootstrap
  for (let i = 0; i < 100 && !(window.MusicLibrary && window.MusicLibrary.state.ready); i++) {
    await sleep(20);
  }
  assert(window.MusicLibrary && window.MusicLibrary.state.ready, "library.json loaded (async bootstrap)");

  const tracks = window.MusicLibrary.tracks;

  console.log("init");
  assert(tracks.length === 6, "6 tracks loaded from library.json");
  assert($$(".track").length === 6, "6 cards rendered");
  assert($('[data-count="all"]').textContent === "6", "ALL count = 6");
  assert($('[data-count="single"]').textContent === "3", "SINGLES count = 3");
  assert($('[data-count="album"]').textContent === "3", "ALBUMS count = 3");
  assert($("#libraryCount").textContent === "6 tracks", "footer says '6 tracks'");
  assert($$(".track").every((c) => c.querySelector(".track__cover img")), "every card has a cover");
  assert($$(".track").every((c) => c.querySelector("a.track__dl[href$='.mp3']")), "every card has a download link");
  assert($("#miniPlayer").hidden, "mini player hidden before first play");
  assert($("#fullPlayer").hidden, "full player hidden before first play");

  console.log("filters");
  click($('[data-filter="single"]'));
  assert($$(".track").length === 3, "SINGLES filter shows 3 cards");
  assert($('[data-filter="single"]').classList.contains("is-active"), "chip becomes active");
  click($('[data-filter="album"]'));
  assert($$(".track").length === 3, "ALBUMS filter shows 3 cards");
  click($('[data-filter="all"]'));
  assert($$(".track").length === 6, "ALL restores 6 cards");

  console.log("search");
  click($("#searchToggle"));
  assert(!$("#searchBar").hidden, "search bar opens");
  const input = $("#searchInput");
  input.value = "tehran";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  await sleep(200);
  assert($$(".track").length === 1, "search 'tehran' -> 1 card");
  assert($(".track .track__title").textContent === "Tehran, 4AM", "matched title is correct");
  input.value = "aria";                       // artist search
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  await sleep(200);
  assert($$(".track").length === 6, "artist search matches all 6");
  input.value = "zzz-no-match";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  await sleep(200);
  assert($$(".track").length === 0 && !$("#emptyState").hidden, "empty state visible on no match");
  click($("#searchClear"));
  await sleep(200);
  assert($$(".track").length === 6, "clearing search restores list");

  console.log("playback");
  const firstCard = $$(".track")[0];
  click($(".track__play", firstCard));
  await sleep(0);
  assert(!$("#miniPlayer").hidden, "mini player appears on play");
  assert($("#miniTitle").textContent === "Slow Light", "mini title = first track");
  assert(firstCard.classList.contains("is-active"), "card marked active");
  assert(firstCard.classList.contains("is-playing"), "card marked playing (icon swap)");
  assert(audio.src.endsWith("slow-light.mp3"), "audio element points at the mp3");
  assert(window.location.hash === "#slow-light-1", "deep link hash updated");

  console.log("progress");
  audio.__time = 18;
  audio.dispatchEvent(new window.Event("timeupdate"));
  await sleep(0);
  const w = parseFloat($("#miniProgressFill").style.width);
  assert(w === 50, "mini progress at 50% at t=18/36 (got " + $("#miniProgressFill").style.width + ")");
  assert($("#fpCurrent").textContent === "0:18", "full player current time formatted");
  const line = parseFloat($(".track.is-active .track__line span").style.width);
  assert(line === 50, "card progress line synced (got " + $(".track.is-active .track__line span").style.width + ")");

  console.log("full player");
  const secondCard = $$(".track")[1];
  click($(".track__info", secondCard));         // body click (not the button)
  await sleep(0);
  assert(!$("#fullPlayer").hidden, "body click opens full player");
  assert($("#fpTitle").textContent === "Concrete Bloom", "full player shows clicked track");
  assert(document.body.classList.contains("is-player-open"), "body scroll locked while full player open");
  // and unlocked again after closing
  click($("#fpClose"));
  assert($("#fullPlayer").hidden, "close button hides full player");
  assert(!document.body.classList.contains("is-player-open"), "scroll unlocked after close");

  console.log("controls");
  const lib = window.MusicLibrary;
  lib.engine.pause();
  await sleep(0);
  assert(!secondCard.classList.contains("is-playing"), "pause reflects on card");
  lib.engine.play();
  await sleep(0);
  // next / prev
  click($("#fpNext"));
  await sleep(0);
  assert(lib.state.currentId === tracks[2].id, "next advances to third track");
  click($("#fpPrev"));   // time>3? no (time is 18 on the element... element __time still 18)
  await sleep(0);
  // engine.time() = 18 > 3 so prev restarts instead of going back
  assert(lib.state.currentId === tracks[2].id, "prev restarts when > 3s in");
  audio.__time = 0;
  click($("#fpPrev"));
  await sleep(0);
  assert(lib.state.currentId === tracks[1].id, "prev goes back at track start");

  console.log("seek");
  $("#fpBar").dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, clientX: 0, button: 0 }));
  // bar width unknown in jsdom; getBoundingClientRect returns zeros -> ratio 0 -> seek(0)
  await sleep(0);
  assert(audio.__time === 0, "seek clamped & applied");

  console.log("ended -> autoplay next");
  audio.dispatchEvent(new window.Event("ended"));
  await sleep(0);
  assert(lib.state.currentId === tracks[2].id, "ended auto-advances");

  console.log("keyboard");
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: " ", bubbles: true }));
  await sleep(0);
  assert(lib.state.playing === false, "space toggles pause");
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert($("#fullPlayer").hidden, "escape keeps player closed");

  console.log("download links");
  const dl = $("#fpDownload");
  assert(!dl.hidden && dl.getAttribute("href").endsWith(".mp3"), "full player download points at mp3");
  const miniDl = $("#miniDownload");
  assert(!miniDl.hidden, "mini download visible");

  console.log("language toggle (en/fa)");
  click($("#langToggle"));
  await sleep(0);
  assert(document.documentElement.lang === "fa" && document.documentElement.dir === "rtl", "fa mode sets lang=fa dir=rtl");
  assert($(".hero__title").textContent === "موسیقی من", "hero title translated");
  assert($('[data-filter="single"] [data-i18n]').textContent === "تک‌آهنگ‌ها", "filter labels translated");
  assert($("#searchInput").getAttribute("placeholder").includes("جست‌وجو"), "search placeholder translated");
  assert($("#libraryCount").textContent.includes("آهنگ"), "footer count translated");
  assert($(".credit__fa").textContent.includes("میثم اسدی"), "credit names Meisam Asadi (fa)");
  assert($(".credit__en").textContent.includes("Meisam Asadi"), "credit names Meisam Asadi (en)");
  click($("#langToggle"));
  await sleep(0);
  assert($(".hero__title").textContent === "MY MUSIC" && document.documentElement.dir === "ltr", "back to en/ltr");

  console.log("");
  if (errors.length) {
    console.error("page errors:", errors);
    process.exitCode = 1;
  }
  if (process.exitCode) {
    console.error("SMOKE TEST FAILED");
  } else {
    console.log("ALL " + passed + " ASSERTIONS PASSED");
  }
  window.close();
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error("TEST CRASH", e); process.exit(1); });
