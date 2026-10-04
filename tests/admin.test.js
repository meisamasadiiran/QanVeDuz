/* ==========================================================================
   Studio (admin.html) functional test.
   Loads the real admin page in jsdom and replays a full publish cycle
   against a mocked GitHub Git-Data API:
     connect -> read refs -> blobs -> tree -> commit -> patch ref
   Usage: node tests/admin.test.js
   ========================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "admin.html"), "utf8")
  .replace(/<link[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>/g, "");

const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (e) => { if (!/Not implemented/.test(e.message)) console.error("jsdomError:", e.message); });

const dom = new JSDOM(html, { url: "https://meisamasadiiran.github.io/QanVeDuz/admin.html", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
const { window } = dom;
const { document } = window;

/* ---------------- environment stubs ---------------- */

if (!window.TextEncoder) { window.TextEncoder = require("util").TextEncoder; }
if (!window.TextDecoder) { window.TextDecoder = require("util").TextDecoder; }
window.confirm = () => true;
window.URL.createObjectURL = () => "blob:fake";
window.URL.revokeObjectURL = () => {};

class FakeAudio {
  constructor() { this._h = {}; }
  addEventListener(t, f) { (this._h[t] = this._h[t] || []).push(f); }
  set src(v) { setTimeout(() => (this._h.error || []).forEach((f) => f()), 0); }
  get src() { return ""; }
}
window.Audio = FakeAudio;

/* ---------------- mocked GitHub API ---------------- */

const calls = [];
const blobs = {};           // sha -> base64 content
let blobN = 0;
let lastLibB64 = null;      // what main's library.json currently holds

function res(body) { return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) }); }

window.fetch = function (url, opts) {
  opts = opts || {};
  const u = String(url);
  const method = (opts.method || "GET").toUpperCase();
  const body = opts.body ? JSON.parse(opts.body) : null;
  calls.push({ method, u, body });

  const R = "https://api.github.com/repos/meisamasadiiran/QanVeDuz";

  if (u === "https://api.github.com/user") return res({ login: "meisamasadiiran" });
  if (u === R) return res({ permissions: { push: true, admin: true } });
  if (u === R + "/contents/library.json") {
    return res({ content: lastLibB64 || Buffer.from("[]").toString("base64"), sha: "LIBSHA" });
  }
  if (u === R + "/git/refs/heads/main") {
    if (method === "PATCH") return res({});
    return res({ object: { sha: "HEADSHA" } });
  }
  if (u === R + "/git/commits/HEADSHA") return res({ tree: { sha: "BASETREE" } });
  if (u === R + "/git/blobs") {
    const sha = "BLOB" + (++blobN);
    blobs[sha] = body.content;
    return res({ sha });
  }
  if (u === R + "/git/trees") {
    const lib = (body.tree || []).find((e) => e.path === "library.json" && e.sha);
    if (lib) lastLibB64 = blobs[lib.sha];   // simulate the commit landing on main
    return res({ sha: "NEWTREE" });
  }
  if (u === R + "/git/commits") return res({ sha: "NEWCOMMIT" });

  return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ message: "unexpected " + u }) });
};

/* ---------------- run the real inline script ---------------- */

const inline = Array.from(document.querySelectorAll("script"))
  .map((s) => s.textContent).join("\n");
try { window.eval(inline, { filename: "admin-inline.js" }); }
catch (e) { console.error("SCRIPT FAILED", e); process.exit(1); }

const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
function assert(cond, label) {
  if (cond) { passed++; console.log("  ok  " + label); }
  else { console.error("  FAIL " + label); process.exitCode = 1; }
}
function click(el) { el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true })); }

(async function main() {
  console.log("connect");
  $("#tokenInput").value = "ghp_test_token";
  click($("#connectBtn"));
  await sleep(30);
  assert($("#connectCard").hidden, "connect card hides after verify");
  assert(!$("#publishCard").hidden && !$("#manageCard").hidden, "studio cards shown");
  assert(window.localStorage.getItem("gh_token") === "ghp_test_token", "token persisted on device");

  console.log("publish");
  $("#fTitle").value = "My Song";
  $("#fArtist").value = "Meisam";
  $("#fCategory").value = "single";
  $("#fNote").value = "";
  const file = new window.File([new Uint8Array(96).fill(7)], "my-song.mp3", { type: "audio/mpeg" });
  Object.defineProperty($("#fAudio"), "files", { value: [file], configurable: true });

  click($("#publishBtn"));

  // wait until the ref PATCH lands
  for (let i = 0; i < 100 && !calls.some((c) => c.method === "PATCH"); i++) await sleep(20);

  const patch = calls.find((c) => c.method === "PATCH");
  const trees = calls.find((c) => c.u.endsWith("/git/trees"));
  const commit = calls.find((c) => c.u.endsWith("/git/commits") && c.method === "POST");
  assert(!!trees, "tree created");
  assert(trees.body.base_tree === "BASETREE", "tree based on current main tree");
  const paths = trees.body.tree.map((e) => e.path);
  assert(paths.some((p) => /^assets\/audio\/my-song.*\.mp3$/.test(p)), "audio blob path: " + paths.find((p) => p.startsWith("assets/audio")));
  assert(paths.includes("library.json"), "library.json updated in same commit");

  const libEntry = trees.body.tree.find((e) => e.path === "library.json");
  const libJson = Buffer.from(blobs[libEntry.sha], "base64").toString("utf8");
  const lib = JSON.parse(libJson);
  assert(lib.length === 1 && lib[0].title === "My Song" && lib[0].artist === "Meisam", "library blob contains the new track");
  assert(lib[0].audio.startsWith("assets/audio/"), "entry points into assets/audio");
  assert(lib[0].download === lib[0].audio, "download mirrors audio path");

  assert(commit.body.parents.length === 1 && commit.body.parents[0] === "HEADSHA", "commit parents = current head");
  assert(/^add: My Song/.test(commit.body.message), "commit message describes the change");
  assert(!!patch && patch.body.sha === "NEWCOMMIT", "main ref moved to the new commit");
  assert($("#publishLog").textContent.includes("منتشر شد"), "success shown in log");

  console.log("manage list");
  await sleep(100);
  assert($("#manageList").children.length === 1, "manage list shows published track");

  console.log("edit (rename + keep files)");
  click($("#manageList").querySelector(".btn--edit"));
  await sleep(10);
  assert($("#fTitle").value === "My Song", "edit form prefilled with current title");
  assert(!$("#cancelEditBtn").hidden && $("#publishBtn").textContent.includes("ذخیره"), "edit-mode UI active");
  $("#fTitle").value = "My Song v2";
  click($("#publishBtn"));
  for (let i = 0; i < 100 && calls.filter((c) => c.method === "PATCH").length < 2; i++) await sleep(20);
  const editTrees = calls.filter((c) => c.u.endsWith("/git/trees")).pop();
  const editLib = editTrees.body.tree.find((e) => e.path === "library.json");
  const editJson = JSON.parse(Buffer.from(blobs[editLib.sha], "base64").toString("utf8"));
  assert(editJson.length === 1 && editJson[0].title === "My Song v2", "rename lands in library.json");
  assert(editJson[0].audio.endsWith("my-song.mp3"), "audio path preserved when no new file picked");
  assert(!editTrees.body.tree.some((e) => e.sha === null), "metadata-only edit deletes nothing");
  await sleep(80);
  assert($("#manageList").textContent.includes("My Song v2"), "manage list shows edited title");
  assert($("#cancelEditBtn").hidden, "returns to publish mode after save");

  console.log("delete");
  click($("#manageList").querySelector(".btn--danger"));
  for (let i = 0; i < 100 && calls.filter((c) => c.method === "PATCH").length < 3; i++) await sleep(20);
  const delTrees = calls.filter((c) => c.u.endsWith("/git/trees")).pop();
  const audioDel = delTrees.body.tree.find((e) => e.path.startsWith("assets/audio"));
  assert(audioDel && audioDel.sha === null, "delete commits a null-sha entry (removes file)");
  const delLib = delTrees.body.tree.find((e) => e.path === "library.json");
  assert(JSON.parse(Buffer.from(blobs[delLib.sha], "base64").toString("utf8")).length === 0, "library.json emptied after delete");

  console.log("");
  if (process.exitCode) console.error("ADMIN TEST FAILED");
  else console.log("ALL " + passed + " ASSERTIONS PASSED");
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error("TEST CRASH", e); process.exit(1); });
