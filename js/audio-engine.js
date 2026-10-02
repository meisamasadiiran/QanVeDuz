/* ==========================================================================
   AudioEngine — a tiny wrapper around a single <audio> element.
   No DOM opinions, no UI: it plays, pauses, seeks and reports progress.
   The UI layer (app.js) subscribes to its events and renders.
   ========================================================================== */
(function (global) {
  "use strict";

  function AudioEngine(audioEl) {
    this.el = audioEl;
    this.current = null;          // index in the playlist
    this.playlist = [];
    this.listeners = {};

    var self = this;

    var on = function (type, fn) { self.el.addEventListener(type, fn); };

    on("timeupdate", function () {
      if (self.isSeeking) return;
      self.emit("progress", {
        current: self.time(),
        duration: self.duration(),
        ratio: self.ratio()
      });
    });

    on("loadedmetadata", function () {
      self.emit("metadata", { duration: self.duration() });
    });

    on("play", function () { self.emit("state", { playing: true }); });
    on("pause", function () { self.emit("state", { playing: false }); });
    on("ended", function () {
      self.emit("state", { playing: false });
      self.emit("ended", { index: self.current });
    });

    on("error", function () {
      self.emit("error", {
        index: self.current,
        src: self.playlist[self.current] ? self.playlist[self.current].audio : null
      });
    });
  }

  AudioEngine.prototype.on = function (type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
    return this;
  };

  AudioEngine.prototype.emit = function (type, payload) {
    var fns = this.listeners[type];
    if (!fns) return;
    for (var i = 0; i < fns.length; i++) fns[i](payload);
  };

  AudioEngine.prototype.setPlaylist = function (tracks) {
    this.playlist = tracks || [];
    return this;
  };

  AudioEngine.prototype.track = function (index) {
    var i = index === undefined ? this.current : index;
    return this.playlist[i] || null;
  };

  /** Load a track by playlist index. `autoplay` starts playback immediately. */
  AudioEngine.prototype.load = function (index, autoplay) {
    var track = this.playlist[index];
    if (!track) return false;

    if (this.current !== index || this.el.getAttribute("src") !== track.audio) {
      this.current = index;
      // assigning src starts the load automatically (preload="metadata")
      this.el.src = track.audio;
    }
    this.emit("change", { index: index, track: track });

    if (autoplay) this.play();
    return true;
  };

  AudioEngine.prototype.play = function () {
    if (!this.el.src) return Promise.resolve();
    var p = this.el.play();
    // Older browsers / rejected autoplay return undefined.
    return p && typeof p.catch === "function"
      ? p.catch(function (err) { return err; })
      : Promise.resolve();
  };

  AudioEngine.prototype.pause = function () { this.el.pause(); };

  AudioEngine.prototype.toggle = function () {
    if (this.el.paused) this.play(); else this.pause();
  };

  AudioEngine.prototype.time = function () {
    var t = this.el.currentTime;
    return isFinite(t) && t > 0 ? t : 0;
  };

  AudioEngine.prototype.duration = function () {
    var d = this.el.duration;
    // Firefox reports Infinity for some streaming/ogg sources.
    return isFinite(d) && d > 0 ? d : 0;
  };

  AudioEngine.prototype.ratio = function () {
    var d = this.duration();
    return d > 0 ? Math.min(1, Math.max(0, this.time() / d)) : 0;
  };

  /** Seek to an absolute number of seconds (clamped to the track length). */
  AudioEngine.prototype.seek = function (seconds) {
    var d = this.duration();
    if (d <= 0) return;
    this.el.currentTime = Math.min(Math.max(0, seconds), d - 0.05);
    this.emit("progress", { current: this.time(), duration: d, ratio: this.ratio() });
  };

  /** Seek by a fraction 0..1 of the track. */
  AudioEngine.prototype.seekRatio = function (ratio) {
    this.seek(this.duration() * Math.min(1, Math.max(0, ratio)));
  };

  AudioEngine.prototype.step = function (delta) {
    var n = this.playlist.length;
    if (!n) return false;
    var next = ((this.current === null ? 0 : this.current) + delta + n) % n;
    this.load(next, true);
    return true;
  };

  AudioEngine.prototype.next = function () { return this.step(1); };
  AudioEngine.prototype.prev = function () { return this.step(-1); };

  global.AudioEngine = AudioEngine;
})(typeof window !== "undefined" ? window : globalThis);
