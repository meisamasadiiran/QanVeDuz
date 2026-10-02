/* Empty-library state: the repo ships with library.json = [] until the owner
   publishes real tracks from Studio. The site must say so, in both languages.
   Usage: node tests/empty.test.js */
"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8")
  .replace(/<link[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>/g, "");

const dom = new JSDOM(html, { url: "http://localhost:8080/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
const { window } = dom;
const { document } = window;

window.HTMLMediaElement.prototype.play = function () { this.dispatchEvent(new window.Event("play")); return Promise.resolve(); };
window.HTMLMediaElement.prototype.pause = function () { this.dispatchEvent(new window.Event("pause")); };

window.fetch = function (url) {
  if (String(url).indexOf("library.json") > -1) {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
  }
  return Promise.resolve({ ok: true, status: 200 });
};

for (const file of ["js/audio-engine.js", "js/app.js"]) {
  window.eval(fs.readFileSync(path.join(ROOT, file), "utf8"), { filename: file });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (s) => document.querySelector(s);
let passed = 0;
const assert = (c, l) => { if (c) { passed++; console.log("  ok  " + l); } else { console.error("  FAIL " + l); process.exitCode = 1; } };

(async () => {
  for (let i = 0; i < 100 && !(window.MusicLibrary && window.MusicLibrary.state.ready); i++) await sleep(20);
  assert(window.MusicLibrary.state.ready, "booted with empty library");
  assert(document.querySelectorAll(".track").length === 0, "no cards");
  assert(!$("#emptyState").hidden, "empty state visible");
  assert($("#emptyState").textContent.includes("Studio"), "en message points to Studio");
  assert($("#libraryCount").textContent === "0 tracks", "footer count = 0 tracks");

  $("#langToggle").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(0);
  assert($("#emptyState").textContent.includes("Studio") && $("#emptyState").textContent.includes("خالی"), "fa message for empty library");

  console.log(process.exitCode ? "EMPTY TEST FAILED" : "ALL " + passed + " ASSERTIONS PASSED");
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error("CRASH", e); process.exit(1); });
