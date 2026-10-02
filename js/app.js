/* ==========================================================================
   app.js — UI layer: list rendering, filters, search, players, download.
   Depends on: js/tracks.js (window.TRACKS), js/audio-engine.js (AudioEngine)
   ========================================================================== */
(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------------------------------------------------------- i18n (en/fa) */

  var I18N = {
    en: {
      heroTitle: "MY MUSIC",
      heroLead: "Listen. Download. Keep the sound.",
      filterAll: "ALL", filterSingle: "SINGLES", filterAlbum: "ALBUMS",
      searchPh: "Search title or artist",
      empty: "No results. Try another title or artist.",
      emptyLib: "The library is empty. Open Studio to publish your first track.",
      loadErr: "Library could not be loaded (library.json missing?).",
      archive: "Personal archive",
      nowPlaying: "NOW PLAYING", nowSingle: "SINGLE", nowAlbum: "ALBUM TRACK",
      download: "DOWNLOAD",
      langBtn: "FA",
      tracksOne: "1 track", tracksMany: "%d tracks"
    },
    fa: {
      heroTitle: "موسیقی من",
      heroLead: "گوش کن، دانلود کن، صدا را نگه دار.",
      filterAll: "همه", filterSingle: "تک‌آهنگ‌ها", filterAlbum: "آلبوم‌ها",
      searchPh: "جست‌وجوی عنوان یا هنرمند",
      empty: "نتیجه‌ای پیدا نشد؛ عنوان یا هنرمند دیگری را جست‌وجو کنید.",
      emptyLib: "کتاب‌خانه خالی است؛ از Studio اولین آهنگ خود را منتشر کنید.",
      loadErr: "کتاب‌خانه بارگذاری نشد (library.json در دسترس نیست؟).",
      archive: "آرشیو شخصی",
      nowPlaying: "در حال پخش", nowSingle: "تک‌آهنگ", nowAlbum: "قطعهٔ آلبوم",
      download: "دانلود",
      langBtn: "EN",
      tracksOne: "۱ آهنگ", tracksMany: "%d آهنگ"
    }
  };

  var lang = "en";
  try { lang = localStorage.getItem("lang") === "fa" ? "fa" : "en"; } catch (e) {}

  function tr(key) { return (I18N[lang] || I18N.en)[key] || (I18N.en[key] || key); }

  function applyLang(next) {
    lang = next === "fa" ? "fa" : "en";
    try { localStorage.setItem("lang", lang); } catch (e) {}
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "fa" ? "rtl" : "ltr";

    var dict = I18N[lang];
    $$("[data-i18n]").forEach(function (node) {
      var key = node.getAttribute("data-i18n");
      if (dict[key]) node.textContent = dict[key];
    });
    $$("[data-i18n-ph]").forEach(function (node) {
      var key = node.getAttribute("data-i18n-ph");
      if (dict[key]) node.setAttribute("placeholder", dict[key]);
    });
    var btn = $("#langToggle");
    if (btn) btn.textContent = dict.langBtn;

    renderCounts();
    if (state.ready) renderList();   // refresh translated empty-state copy
    var current = engine.track ? engine.track() : null;
    if (current) setFpLabel(current);
  }

  /* ---------------------------------------------------------------- data */

  /** "3:42" | "03:42" | "1:02:10" | 222 -> "MM:SS" style string. */
  function formatTime(input) {
    var sec;
    if (typeof input === "number" && isFinite(input)) {
      sec = Math.max(0, Math.floor(input));
    } else if (typeof input === "string" && input.indexOf(":") > -1) {
      return input.trim();
    } else {
      sec = parseInt(input, 10);
      if (!isFinite(sec)) return "0:00";
    }
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    var mm = h > 0 && m < 10 ? "0" + m : String(m);
    return (h > 0 ? h + ":" : "") + mm + ":" + (s < 10 ? "0" + s : s);
  }

  function slugify(text) {
    return String(text || "")
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "");
  }

  /** Normalise a track object: fill defaults, add an id, validate audio. */
  function normalise(track, i) {
    var t = {
      id: track.id || (slugify(track.title) || "track") + "-" + (i + 1),
      title: track.title || "Untitled",
      artist: track.artist || "Unknown artist",
      cover: track.cover || "",
      audio: track.audio || "",
      download: track.download === undefined ? track.audio : (track.download || ""),
      duration: track.duration || "",
      category: (track.category || "single").toLowerCase(),
      meta: track.meta || "",
      note: track.note || "",
      index: i
    };
    return t;
  }

  var ALL = [];   // filled by bootstrap() after library.json loads

  /* --------------------------------------------------------------- state */

  var state = {
    filter: "all",
    query: "",
    visible: ALL.slice(),
    currentId: null,
    playing: false,
    open: false,
    durationCache: {}   // id -> seconds (learned from metadata)
  };

  /* --------------------------------------------------------------- dom */

  var el = {
    list: $("#trackList"),
    empty: $("#emptyState"),
    filters: $("#filters"),
    counts: {
      all: $('[data-count="all"]'),
      single: $('[data-count="single"]'),
      album: $('[data-count="album"]')
    },
    libraryCount: $("#libraryCount"),
    searchToggle: $("#searchToggle"),
    searchBar: $("#searchBar"),
    searchInput: $("#searchInput"),
    searchClear: $("#searchClear"),
    mini: $("#miniPlayer"),
    miniOpen: $("#miniOpen"),
    miniCover: $("#miniCover"),
    miniTitle: $("#miniTitle"),
    miniArtist: $("#miniArtist"),
    miniPlay: $("#miniPlay"),
    miniDownload: $("#miniDownload"),
    miniProgress: $("#miniProgress"),
    miniFill: $("#miniProgressFill"),
    fp: $("#fullPlayer"),
    fpClose: $("#fpClose"),
    fpCover: $("#fpCover"),
    fpTitle: $("#fpTitle"),
    fpArtist: $("#fpArtist"),
    fpNote: $("#fpNote"),
    fpBar: $("#fpBar"),
    fpFill: $("#fpFill"),
    fpCurrent: $("#fpCurrent"),
    fpDuration: $("#fpDuration"),
    fpPlay: $("#fpPlay"),
    fpPrev: $("#fpPrev"),
    fpNext: $("#fpNext"),
    fpDownload: $("#fpDownload"),
    fpLabel: $("#fpLabel"),
    audio: $("#audio")
  };

  var FALLBACK_COVER = "data:image/svg+xml;utf8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<rect width="100" height="100" fill="#30302D"/>' +
    '<circle cx="50" cy="50" r="18" fill="#C95A3D" opacity="0.9"/>' +
    '<circle cx="50" cy="50" r="5" fill="#20201D"/></svg>'
  );

  var engine = new AudioEngine(el.audio);

  /* ------------------------------------------------------- small helpers */

  function byId(id) {
    for (var i = 0; i < ALL.length; i++) if (ALL[i].id === id) return ALL[i];
    return null;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /** Case/diacritic-insensitive compare used by search. */
  function normaliseText(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[\u064B-\u0652\u0670\u0640]/g, "")   // arabic diacritics + tatweel
      .replace(/ي/g, "ی").replace(/ك/g, "ک")
      .replace(/ة/g, "ه").replace(/[‌‏‎]/g, "")
      .trim();
  }

  function matches(track, query) {
    var q = normaliseText(query);
    if (!q) return true;
    return normaliseText(track.title).indexOf(q) > -1 ||
           normaliseText(track.artist).indexOf(q) > -1;
  }

  function labelFor(track) {
    if (track.category === "album") return "ALBUM";
    return "SINGLE";
  }

  /** Display duration: declared value first, metadata value as fallback. */
  function durationText(track) {
    if (track.duration) return track.duration;
    var cached = state.durationCache[track.id];
    return cached ? formatTime(cached) : "";
  }

  /* ------------------------------------------------------------- rendering */

  function cardMarkup(track) {
    var sub = [];
    if (track.meta) sub.push(escapeHtml(track.meta));
    var dur = durationText(track);
    if (dur) sub.push(escapeHtml(dur));

    return '' +
      '<span class="track__cover">' +
        '<img src="' + escapeHtml(track.cover || FALLBACK_COVER) + '" alt="" loading="lazy" ' +
             'onerror="this.onerror=null;this.src=\'' + FALLBACK_COVER + '\'">' +
        '<span class="track__badge">' + labelFor(track) + '</span>' +
      '</span>' +
      '<span class="track__info">' +
        '<span class="track__title">' + escapeHtml(track.title) + '</span>' +
        '<span class="track__artist">' + escapeHtml(track.artist) + '</span>' +
        (sub.length ? '<span class="track__sub">' + sub.join('<span class="sep">/</span>') + '</span>' : '') +
      '</span>' +
      '<span class="track__actions">' +
        (track.download
          ? '<a class="track__dl" href="' + escapeHtml(track.download) + '" download ' +
              'aria-label="Download ' + escapeHtml(track.title) + '" data-action="download">' +
              '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v10.5"/><path d="M7.5 11 12 15.5 16.5 11"/><path d="M5 19.5h14"/></svg>' +
            '</a>'
          : '') +
        '<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>' +
        '<button class="track__play" type="button" data-action="play" ' +
                'aria-label="Play ' + escapeHtml(track.title) + '">' +
          '<svg class="ico-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5 20 12 8 19z"/></svg>' +
          '<svg class="ico-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h3.4v14H8zM13.6 5H17v14h-3.4z"/></svg>' +
        '</button>' +
      '</span>' +
      '<span class="track__line" aria-hidden="true"><span></span></span>';
  }

  function renderList() {
    var frag = document.createDocumentFragment();

    state.visible.forEach(function (track) {
      var li = document.createElement("li");
      li.className = "track";
      li.dataset.id = track.id;
      li.setAttribute("role", "button");
      li.setAttribute("tabindex", "0");
      li.setAttribute("aria-label", track.title + " by " + track.artist);
      li.innerHTML = cardMarkup(track);
      frag.appendChild(li);
    });

    el.list.innerHTML = "";
    el.list.appendChild(frag);

    if (ALL.length === 0) {
      el.empty.hidden = false;
      el.empty.textContent = tr("emptyLib");
    } else {
      el.empty.hidden = state.visible.length !== 0;
      if (!el.empty.hidden) el.empty.textContent = tr("empty");
    }
    syncActiveCard();
  }

  function renderCounts() {
    var single = 0, album = 0;
    ALL.forEach(function (t) { if (t.category === "album") album++; else single++; });
    el.counts.all.textContent = ALL.length;
    el.counts.single.textContent = single;
    el.counts.album.textContent = album;
    el.libraryCount.textContent = ALL.length === 1
      ? tr("tracksOne")
      : tr("tracksMany").replace("%d", String(ALL.length));
  }

  function applyFilters() {
    state.visible = ALL.filter(function (t) {
      var inCategory = state.filter === "all" || t.category === state.filter;
      return inCategory && matches(t, state.query);
    });
    renderList();
  }

  function setFilter(filter) {
    state.filter = filter;
    $$(".chip", el.filters).forEach(function (chip) {
      chip.classList.toggle("is-active", chip.dataset.filter === filter);
      chip.setAttribute("aria-pressed", chip.dataset.filter === filter ? "true" : "false");
    });
    applyFilters();
  }

  /* -------------------------------------------------------- active states */

  function syncActiveCard() {
    $$(".track", el.list).forEach(function (card) {
      var isCurrent = card.dataset.id === state.currentId;
      card.classList.toggle("is-active", isCurrent);
      card.classList.toggle("is-playing", isCurrent && state.playing);
      var btn = $(".track__play", card);
      if (btn) {
        btn.setAttribute("aria-label",
          (isCurrent && state.playing ? "Pause " : "Play ") + (byId(card.dataset.id) || {}).title);
      }
      if (!isCurrent) {
        var line = $(".track__line span", card);
        if (line) line.style.width = "0%";
      }
    });
  }

  function updateProgress(ratio, current, duration) {
    var pct = (ratio * 100).toFixed(2) + "%";

    if (el.miniFill) el.miniFill.style.width = pct;
    if (el.miniProgress) el.miniProgress.setAttribute("aria-valuenow", Math.round(ratio * 100));
    if (el.fpFill) el.fpFill.style.width = pct;
    if (el.fpBar) el.fpBar.setAttribute("aria-valuenow", Math.round(ratio * 100));

    if (el.fpCurrent) el.fpCurrent.textContent = formatTime(current);

    var track = engine.track();
    var total = duration || (track ? state.durationCache[track.id] : 0);
    if (el.fpDuration) el.fpDuration.textContent = total ? formatTime(total) : "0:00";

    // thin progress line on the active card
    var active = $(".track.is-active .track__line span", el.list);
    if (active) active.style.width = pct;
  }

  /* ------------------------------------------------------------ playback */

  function openFullPlayer(open) {
    state.open = open;
    el.fp.hidden = !open;
    document.body.classList.toggle("is-player-open", open);
    if (open) {
      el.fpClose.focus({ preventScroll: true });
    } else {
      var card = $(".track.is-active", el.list);
      if (card) card.focus({ preventScroll: true });
    }
  }

  function playId(id, openPlayer) {
    var track = byId(id);
    if (!track) return;

    state.currentId = id;
    engine.load(track.index, true);

    el.mini.hidden = false;
    el.miniCover.src = track.cover || FALLBACK_COVER;
    el.miniCover.alt = "";
    el.miniTitle.textContent = track.title;
    el.miniArtist.textContent = track.artist;

    el.fpCover.src = track.cover || FALLBACK_COVER;
    el.fpCover.alt = "Cover art for " + track.title;
    el.fpTitle.textContent = track.title;
    el.fpArtist.textContent = track.artist;
    el.fpNote.textContent = track.note || "";
    el.fpNote.hidden = !track.note;
    setFpLabel(track);
    el.fpDuration.textContent = durationText(track) || "0:00";

    setDownload(el.miniDownload, track);
    setDownload(el.fpDownload, track);

    updateProgress(0, 0, state.durationCache[id] || 0);
    syncActiveCard();

    if (history.replaceState) {
      history.replaceState(null, "", "#" + track.id);
    }
    if (navigator.mediaSession && "metadata" in navigator.mediaSession) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: track.title,
          artist: track.artist,
          artwork: track.cover ? [{ src: track.cover, sizes: "1000x1000", type: "image/jpeg" }] : []
        });
      } catch (e) { /* metadata is a nice-to-have */ }
    }
    if (openPlayer) openFullPlayer(true);
  }

  function setFpLabel(track) {
    if (!el.fpLabel || !track) return;
    el.fpLabel.textContent = track.category === "album" ? tr("nowAlbum") : tr("nowSingle");
  }

  function setPlaying(playing) {
    state.playing = playing;
    [el.miniPlay, el.fpPlay].forEach(function (btn) {
      if (!btn) return;
      btn.classList.toggle("is-playing", playing);
      btn.setAttribute("aria-label", playing ? "Pause" : "Play");
    });
    syncActiveCard();
  }

  function setDownload(anchor, track) {
    if (!anchor) return;
    if (track && track.download) {
      anchor.href = track.download;
      anchor.setAttribute("download", "");
      anchor.hidden = false;
      anchor.setAttribute("aria-label", "Download " + track.title);
      checkDownloadable(anchor, track.download);
    } else {
      anchor.hidden = true;
      anchor.removeAttribute("href");
    }
  }

  /** Hide the download control when the file is missing (404) on the host. */
  function checkDownloadable(anchor, url) {
    if (!url || anchor.dataset.checked === url) return;
    if (typeof fetch !== "function") return;
    anchor.dataset.checked = url;
    fetch(url, { method: "HEAD" }).then(function (res) {
      if (!res.ok) anchor.hidden = true;
    }).catch(function () { /* offline / CORS: keep the button */ });
  }

  /* --------------------------------------------------------- interactions */

  el.list.addEventListener("click", function (ev) {
    var action = ev.target.closest("[data-action]");
    var card = ev.target.closest(".track");
    if (!card) return;
    var id = card.dataset.id;

    if (action && action.dataset.action === "download") return;   // let the browser download

    if (action && action.dataset.action === "play") {
      if (state.currentId === id) { engine.toggle(); }
      else { playId(id, false); }
      return;
    }
    // clicking anywhere else on the card opens the full player
    if (state.currentId === id && state.open) { engine.toggle(); return; }
    playId(id, true);
  });

  el.list.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    var card = ev.target.closest(".track");
    if (!card) return;
    ev.preventDefault();
    if (state.currentId === card.dataset.id) engine.toggle();
    else playId(card.dataset.id, true);
  });

  el.filters.addEventListener("click", function (ev) {
    var chip = ev.target.closest(".chip");
    if (chip) setFilter(chip.dataset.filter);
  });

  /* search */
  function setSearchOpen(open) {
    el.searchBar.hidden = !open;
    el.searchToggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) el.searchInput.focus();
    else { el.searchInput.value = ""; state.query = ""; el.searchClear.hidden = true; applyFilters(); }
  }

  el.searchToggle.addEventListener("click", function () {
    setSearchOpen(el.searchBar.hidden);
  });

  var searchTimer = null;
  el.searchInput.addEventListener("input", function () {
    var value = el.searchInput.value;
    el.searchClear.hidden = !value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      state.query = value;
      applyFilters();
    }, 120);
  });

  el.searchClear.addEventListener("click", function () {
    el.searchInput.value = "";
    el.searchClear.hidden = true;
    state.query = "";
    applyFilters();
    el.searchInput.focus();
  });

  el.searchInput.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") setSearchOpen(false);
  });

  /* mini player */
  el.miniOpen.addEventListener("click", function () { openFullPlayer(true); });
  el.miniPlay.addEventListener("click", function () { engine.toggle(); });

  /* full player */
  el.fpClose.addEventListener("click", function () { openFullPlayer(false); });
  el.fpPlay.addEventListener("click", function () { engine.toggle(); });
  el.fpNext.addEventListener("click", function () { engine.next(); });
  el.fpPrev.addEventListener("click", function () {
    // restart the current track if we are more than 3 seconds in
    if (engine.time() > 3) engine.seek(0); else engine.prev();
  });

  /* ------------------------------------------------------------ scrubbing */

  function makeScrubber(barEl, onScrub) {
    if (!barEl) return;
    var scrubbing = false;

    function ratioFromEvent(ev) {
      var rect = barEl.getBoundingClientRect();
      return Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
    }

    barEl.addEventListener("pointerdown", function (ev) {
      if (ev.button !== undefined && ev.button !== 0) return;
      scrubbing = true;
      engine.isSeeking = true;
      barEl.classList.add("is-scrubbing");
      if (barEl.setPointerCapture) { try { barEl.setPointerCapture(ev.pointerId); } catch (e) {} }
      onScrub(ratioFromEvent(ev), true);
      ev.preventDefault();
    });

    barEl.addEventListener("pointermove", function (ev) {
      if (!scrubbing) return;
      onScrub(ratioFromEvent(ev), true);
    });

    var end = function (ev) {
      if (!scrubbing) return;
      scrubbing = false;
      engine.isSeeking = false;
      barEl.classList.remove("is-scrubbing");
      onScrub(ratioFromEvent(ev), false);
    };
    barEl.addEventListener("pointerup", end);
    barEl.addEventListener("pointercancel", end);

    barEl.addEventListener("keydown", function (ev) {
      var step = 0;
      if (ev.key === "ArrowRight") step = 0.05;
      else if (ev.key === "ArrowLeft") step = -0.05;
      else return;
      ev.preventDefault();
      onScrub(engine.ratio() + step, false);
    });
  }

  function scrubTo(ratio, preview) {
    var track = engine.track();
    var total = track ? (engine.duration() || state.durationCache[track.id] || 0) : 0;
    if (preview) {
      updateProgress(ratio, ratio * total, total);
    } else {
      engine.seekRatio(ratio);
    }
  }

  makeScrubber(el.fpBar, scrubTo);
  makeScrubber(el.miniProgress, scrubTo);

  /* ----------------------------------------------------------- shortcuts */

  document.addEventListener("keydown", function (ev) {
    var tag = (ev.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || ev.metaKey || ev.ctrlKey || ev.altKey) return;

    if (ev.key === "Escape" && state.open) { openFullPlayer(false); return; }

    switch (ev.key) {
      case " ":
      case "k":
        if (!state.currentId) return;
        ev.preventDefault();
        engine.toggle();
        break;
      case "ArrowRight":
        if (state.currentId) { ev.preventDefault(); engine.seek(engine.time() + 5); }
        break;
      case "ArrowLeft":
        if (state.currentId) { ev.preventDefault(); engine.seek(engine.time() - 5); }
        break;
      case "j":
        if (state.currentId) { ev.preventDefault(); engine.next(); }
        break;
      case "l":
        if (state.currentId) { ev.preventDefault(); engine.prev(); }
        break;
    }
  });

  /* ------------------------------------------------------- engine wiring */

  engine.on("state", function (data) { setPlaying(data.playing); });

  engine.on("progress", function (data) {
    var track = engine.track();
    if (track && data.duration && !state.durationCache[track.id]) {
      state.durationCache[track.id] = Math.round(data.duration);
    }
    updateProgress(data.ratio, data.current, data.duration);
  });

  engine.on("metadata", function (data) {
    var track = engine.track();
    if (!track || !data.duration) return;
    state.durationCache[track.id] = Math.round(data.duration);
    el.fpDuration.textContent = formatTime(data.duration);
    syncActiveCard();     // refresh "MM:SS" inside the card if it had no duration
  });

  engine.on("change", function (data) {
    var track = data.track;
    state.currentId = track.id;
    el.mini.hidden = false;
    el.miniCover.src = track.cover || FALLBACK_COVER;
    el.miniTitle.textContent = track.title;
    el.miniArtist.textContent = track.artist;
    el.fpCover.src = track.cover || FALLBACK_COVER;
    el.fpTitle.textContent = track.title;
    el.fpArtist.textContent = track.artist;
    el.fpNote.textContent = track.note || "";
    el.fpNote.hidden = !track.note;
    setFpLabel(track);
    setDownload(el.miniDownload, track);
    setDownload(el.fpDownload, track);
    if (history.replaceState) history.replaceState(null, "", "#" + track.id);
    syncActiveCard();
  });

  engine.on("ended", function () { engine.next(); });

  engine.on("error", function (data) {
    if (!data || !data.src) return;
    var track = byId(state.currentId);
    if (!track) return;
    el.fpNote.textContent = "Audio file could not be loaded (" + track.audio + ").";
    el.fpNote.hidden = false;
    setPlaying(false);
  });

  /* ---------------------------------------------------------- deep links */

  function openFromHash() {
    var hash = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (!hash) return;
    var track = byId(hash);
    if (!track) {
      var idx = parseInt(hash, 10);
      if (!isNaN(idx)) track = ALL[idx - 1] || ALL[idx];
    }
    if (track) {
      state.currentId = track.id;
      engine.load(track.index, false);
      el.mini.hidden = false;
      el.miniCover.src = track.cover || FALLBACK_COVER;
      el.miniTitle.textContent = track.title;
      el.miniArtist.textContent = track.artist;
      el.fpCover.src = track.cover || FALLBACK_COVER;
      el.fpTitle.textContent = track.title;
      el.fpArtist.textContent = track.artist;
      el.fpNote.textContent = track.note || "";
      el.fpNote.hidden = !track.note;
      setFpLabel(track);
      el.fpDuration.textContent = durationText(track) || "0:00";
      setDownload(el.miniDownload, track);
      setDownload(el.fpDownload, track);
      syncActiveCard();
    }
  }

  window.addEventListener("hashchange", openFromHash);

  /* --------------------------------------------------------------- init */

  function bootstrap(list) {
    ALL = (Array.isArray(list) ? list : [])
      .map(normalise)
      .filter(function (t) { return !!t.audio; });
    engine.setPlaylist(ALL);
    renderCounts();
    setFilter(state.filter || "all");
    openFromHash();
    state.ready = true;
  }

  function loadLibrary() {
    if (typeof fetch !== "function") { bootstrap(window.TRACKS || []); return; }
    fetch("library.json", { cache: "no-cache" })
      .then(function (res) {
        if (!res.ok) throw new Error("library.json -> " + res.status);
        return res.json();
      })
      .then(bootstrap)
      .catch(function () {
        el.list.innerHTML = "";
        el.empty.hidden = false;
        el.empty.textContent = tr("loadErr");
      });
  }

  $("#langToggle").addEventListener("click", function () {
    applyLang(lang === "en" ? "fa" : "en");
  });

  applyLang(lang);
  loadLibrary();

  if (navigator.mediaSession) {
    navigator.mediaSession.setActionHandler("play", function () { engine.play(); });
    navigator.mediaSession.setActionHandler("pause", function () { engine.pause(); });
    navigator.mediaSession.setActionHandler("previoustrack", function () { engine.prev(); });
    navigator.mediaSession.setActionHandler("nexttrack", function () { engine.next(); });
  }

  // expose a tiny handle for debugging / future extensions
  window.MusicLibrary = {
    get tracks() { return ALL; },
    state: state,
    engine: engine,
    play: function (id, open) { playId(id, open); },
    setFilter: setFilter,
    search: function (q) { state.query = q || ""; applyFilters(); },
    formatTime: formatTime
  };
})();
