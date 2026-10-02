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
├── style.css
├── js/
│   ├── tracks.js        ← your library (edit this to add songs)
│   ├── audio-engine.js  ← playback logic
│   └── app.js           ← UI logic
├── assets/
│   ├── audio/           ← mp3 / wav / flac files
│   └── covers/          ← square jpg / png / webp artwork
├── scripts/
│   ├── build-tracks.py  ← demo content + tracks.js generator
│   └── serve.py         ← local dev server with Range support
└── tests/
    └── smoke.test.js    ← functional UI test (jsdom)
```

## Run it locally

```bash
python3 scripts/serve.py          # → http://localhost:8080
```

(any static server works; `serve.py` adds HTTP Range support so audio
seeking behaves the same as on Cloudflare/GitHub Pages)

## Add a song

Open `js/tracks.js` and push one object:

```js
{
  title:    "Track Name",
  artist:   "Artist Name",
  cover:    "assets/covers/track-01.jpg",
  audio:    "assets/audio/track-01.mp3",     // mp3 / wav / flac
  download: "assets/audio/track-01.mp3",     // "" hides the download button
  duration: "03:42",                         // optional, read from file if omitted
  category: "single",                        // "single" | "album"
  meta:     "Single · 2026",                 // optional small label
  note:     "One line about the track."      // optional, full player only
}
```

That's it — the card, the player, the filters and the search pick it up
automatically. If a `download` file doesn't exist on the host, its download
button hides itself at runtime.

### Demo content

The six tracks and covers shipped in `assets/` are generated placeholders so
the site is playable out of the box. Replace them with your own recordings
(same file names) or re-render the demo:

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
