# MUSIC — Personal Library

A minimal, mobile-first static site for publishing your own music.
Listen online, play/pause with a live progress line, download the original
file, open the full player — nothing more. No accounts, no ads, no backend.

- **Visual language:** matte charcoal `#20201D`, dark-gray cards, off-white type,
  tomato orange `#C95A3D` reserved for play / active / progress / download.
- **Tech:** plain HTML + CSS + Vanilla JS. Any free static host can serve it.

```
/
├── index.html
├── admin.html           ← "Studio": publish/delete songs from the phone browser
├── library.json         ← the track list (Studio edits it; site reads it)
├── style.css
├── js/
│   ├── audio-engine.js  ← playback logic
│   └── app.js           ← UI logic
├── assets/
│   ├── audio/           ← mp3 / wav / flac files
│   └── covers/          ← square jpg / png / webp artwork
├── scripts/
│   ├── build-tracks.py  ← demo content + library.json generator
│   └── serve.py         ← local dev server with Range support
└── tests/
    ├── smoke.test.js    ← functional UI test (jsdom)
    └── admin.test.js    ← Studio publish/delete flow vs mocked GitHub API
```

## Run it locally

```bash
python3 scripts/serve.py          # → http://localhost:8080
```

(any static server works; `serve.py` adds HTTP Range support so audio
seeking behaves the same as on Cloudflare/GitHub Pages)

## Add a song — Studio (no computer needed)

Open `https://<your-pages-url>/admin.html` on the phone:

1. Paste a personal access token once (fine-grained, **Contents: Read and
   write** on this repo only). It is stored only in that browser's
   localStorage.
2. Pick the audio file (+ optional cover), write title/artist, press
   **انتشار در سایت**.
3. Studio commits the file(s) and updates `library.json` through the GitHub
   API; the site shows the new track ~1 minute later.

The same page lists published tracks and deletes them (transparent commits,
visible in the repo history).

## Add a song — manually

Edit `library.json` (array of objects) and commit:

```json
{
  "title": "Track Name",
  "artist": "Artist Name",
  "cover": "assets/covers/track-01.jpg",
  "audio": "assets/audio/track-01.mp3",
  "download": "assets/audio/track-01.mp3",
  "duration": "03:42",
  "category": "single",
  "meta": "Single · 2026",
  "note": "One line about the track."
}
```

That's it — the card, the player, the filters and the search pick it up
automatically. If a `download` file doesn't exist on the host, its download
button hides itself at runtime.

### Optional demo content

The repository ships with an **empty library** — your archive starts clean and
you publish real tracks from Studio. If you want a playable demo first,
generate placeholder tracks + covers locally (not meant for your public site):

```bash
pip install pillow lameenc        # optional: covers + small mp3s
python3 scripts/build-tracks.py           # fills in missing assets only
python3 scripts/build-tracks.py --force   # re-render everything
```

## Test

```bash
cd tests && npm install && node smoke.test.js
```

Drives the real page in jsdom: rendering, filters, search, play/pause,
progress, full player, next/prev, autoplay, keyboard, download links.

## Deploy (free)

### Cloudflare Pages → `your-project.pages.dev`

1. Push this folder to a Git repository.
2. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   connect the repo.
3. Build settings: *Framework preset* = **None**,
   *Build command* = *(leave empty)*,
   *Build output directory* = `/`
4. Deploy. Your site is live at `https://<project>.pages.dev`.

### GitHub Pages → `username.github.io/repo`

1. Push this folder to a repository.
2. Repository **Settings → Pages → Branch: `main` / folder `/ (root)`**.
3. `.nojekyll` is already included so `assets/` paths are served as-is.

Both hosts serve Range requests, so streaming + seeking work exactly like
the local server.

## UX details baked in

- Cards are the navigation: tap the card → full player; tap the round button
  → play/pause in place.
- The active card gets a lighter surface, an orange play button and a thin
  orange progress line.
- Mini player stays pinned to the bottom; tap it to expand, tap progress
  anywhere to seek.
- Search matches title *and* artist (Persian/Arabic tolerant, diacritic-free).
- Keyboard: `Space` play/pause · `←/→` seek 5s · `j/l` next/prev · `Esc` close.
- Media Session hooks: lock-screen controls on mobile.
- Deep links: `#track-id` in the URL restores the selected track.
- Reduced-motion respected; safe-area insets respected on notched phones.
