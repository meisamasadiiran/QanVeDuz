#!/usr/bin/env python3
"""
Generate the DEMO content shipped with the project:

  * assets/audio/*.wav  — short, calm synthesised tracks (placeholders)
  * assets/covers/*.jpg — minimal editorial cover art

and write js/tracks.js from them, so the site is playable straight away.

Replace the generated files with your own mp3 / wav / flac (same folder, same
file names — or edit the DEMO list below) and re-run:

    python3 scripts/build-tracks.py            # only fills in what is missing
    python3 scripts/build-tracks.py --force    # re-render everything

Optional deps: Pillow (covers) and lameenc (mp3 encoding). Everything else is
standard library. Flags: --force, --no-mp3, --keep-wav
"""

from __future__ import annotations

import math
import os
import random
import struct
import sys
import wave
from dataclasses import dataclass, field, asdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO_DIR = os.path.join(ROOT, "assets", "audio")
COVER_DIR = os.path.join(ROOT, "assets", "covers")
JS_DIR = os.path.join(ROOT, "js")

SAMPLE_RATE = 44100
ACCENT = (201, 90, 61)      # #C95A3D
BG = (32, 32, 29)           # #20201D
SURFACE = (48, 48, 45)      # #30302D
SOFT = (184, 181, 175)      # #B8B5AF
MUTED = (119, 117, 112)     # #777570
OFFWHITE = (242, 240, 235)  # #F2F0EB


@dataclass
class Track:
    slug: str
    title: str
    artist: str
    category: str
    meta: str
    note: str
    seconds: float
    bpm: float
    root: float
    progression: list
    pattern: str
    waveform: str = "triangle"
    cover: str = "circle"
    durations: dict = field(default_factory=dict)


DEMO: list[Track] = [
    Track("slow-light", "Slow Light", "Aria Mehr", "single", "Single · 2026",
          "Warm keys recorded late at night, no overdubs.",
          36, 74, 220.00, [0, 5, 3, 7], "chords", "triangle", "circle"),
    Track("concrete-bloom", "Concrete Bloom", "Aria Mehr", "album", "Concrete Bloom LP",
          "Track one from the Concrete Bloom LP.",
          34, 92, 174.61, [0, -4, -2, 3], "arpeggio", "sine", "bars"),
    Track("tehran-4am", "Tehran, 4AM", "Aria Mehr", "single", "Single · 2025",
          "A loop built from a single field recording.",
          40, 68, 146.83, [0, 7, 5, 3], "pad", "sine", "horizon"),
    Track("paper-walls", "Paper Walls", "Aria Mehr", "album", "Concrete Bloom LP", "",
          38, 84, 196.00, [0, 3, 7, 10], "arpeggio", "triangle", "diagonal"),
    Track("north-window", "North Window", "Aria Mehr", "single", "Single · 2025", "",
          35, 80, 261.63, [0, 4, 2, 5], "chords", "triangle", "arcs"),
    Track("quiet-hours", "Quiet Hours", "Aria Mehr", "album", "Concrete Bloom LP",
          "Closing track. Recorded in one take.",
          42, 64, 130.81, [0, 5, 8, 3], "pad", "sine", "grid"),
]

SEMITONE = 2 ** (1 / 12)
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def freq(base: float, semitones: float) -> float:
    return base * SEMITONE ** semitones


def hz_to_name(hz: float) -> str:
    if hz <= 0:
        return "-"
    midi = 69 + 12 * math.log2(hz / 440.0)
    return NOTE_NAMES[int(round(midi)) % 12]


# --------------------------------------------------------------------------
# audio synthesis
# --------------------------------------------------------------------------

def osc(kind: str, phase: float) -> float:
    p = phase - math.floor(phase)
    if kind == "sine":
        return math.sin(2 * math.pi * p)
    if kind == "triangle":
        return 4 * abs(p - 0.5) - 1
    if kind == "saw":
        return 2 * p - 1
    if kind == "square":
        return 1.0 if p < 0.5 else -1.0
    raise ValueError(kind)


def note_buffer(f: float, seconds: float, waveform: str, attack: float = 0.03,
                release_ratio: float = 0.55, detune: float = 3.0) -> list[float]:
    """A soft additive note: fundamental + a couple of quiet harmonics."""
    n = int(SAMPLE_RATE * seconds)
    buf = [0.0] * n
    partials = {"sine": [(1, 1.0)],
                  "triangle": [(1, 1.0), (3, 0.22), (5, 0.08)],
                  "saw": [(1, 1.0), (2, 0.35), (3, 0.2), (4, 0.1)],
                  "square": [(1, 1.0), (3, 0.3), (5, 0.15)]}[waveform]

    ph = 0.0
    ph2 = 0.0
    step = f / SAMPLE_RATE
    step2 = (f * (1 + detune / 100)) / SAMPLE_RATE
    release_at = max(0.0, 1.0 - release_ratio)

    for i in range(n):
        t = i / n
        if t < attack:
            env = t / attack
        elif t > release_at:
            env = max(0.0, (1.0 - t) / (1.0 - release_at))
        else:
            env = 1.0
        env *= 0.9 + 0.1 * math.sin(2 * math.pi * 4.3 * t)  # slow tremolo

        sample = 0.0
        for mult, amp in partials:
            sample += osc(waveform, ph * mult) * amp
        sample += osc(waveform, ph2 * 1.0) * 0.35           # detuned layer
        buf[i] = sample * env * 0.32

        ph += step
        ph2 += step2
        if ph > 1e6:
            ph -= math.floor(ph)
            ph2 -= math.floor(ph2)
    return buf


def kick(seconds: float = 0.22) -> list[float]:
    n = int(SAMPLE_RATE * seconds)
    buf = [0.0] * n
    ph = 0.0
    for i in range(n):
        t = i / SAMPLE_RATE
        f = 120 * math.exp(-t * 26) + 42
        ph += f / SAMPLE_RATE
        env = math.exp(-t * 17)
        buf[i] = math.sin(2 * math.pi * ph) * env * 0.5
    return buf


def hat(seconds: float = 0.06, level: float = 0.05) -> list[float]:
    rng = random.Random(7)
    n = int(SAMPLE_RATE * seconds)
    buf = []
    for i in range(n):
        t = i / SAMPLE_RATE
        env = math.exp(-t * 95)
        buf.append((rng.random() * 2 - 1) * env * level)
    return buf


def mix_into(dst: list[float], src: list[float], offset: int) -> None:
    start = max(0, offset)
    end = min(len(dst), offset + len(src))
    if end <= start:
        return
    s0 = start - offset
    for i in range(start, end):
        dst[i] += src[i - start + s0]


def one_pole_lowpass(buf: list[float], cutoff_hz: float) -> list[float]:
    rc = 1.0 / (2 * math.pi * cutoff_hz)
    dt = 1.0 / SAMPLE_RATE
    a = dt / (rc + dt)
    out = [0.0] * len(buf)
    prev = 0.0
    for i, x in enumerate(buf):
        prev = prev + a * (x - prev)
        out[i] = prev
    return out


def synthesise(track: Track) -> bytes:
    total = int(SAMPLE_RATE * track.seconds)
    left = [0.0] * total
    right = [0.0] * total
    beat = 60.0 / track.bpm
    bar = beat * 4
    rng = random.Random(track.slug.__hash__() & 0xFFFF)

    third = 3 if track.pattern == "pad" else 4
    chords = [(freq(track.root, semi),
               freq(track.root, semi + third),
               freq(track.root, semi + 7)) for semi in track.progression]

    kick_buf = kick()
    hat_buf = hat()

    b = 0
    while b * bar < track.seconds:
        chord = chords[b % len(chords)]
        t0 = b * bar

        if track.pattern == "chords":
            for k, f in enumerate(chord):
                nb = note_buffer(f, bar * 0.98, track.waveform, attack=0.06, release_ratio=0.4)
                pan = 0.14 * (k - 1)
                mix_into(left, [v * (0.5 - pan) for v in nb], int(t0 * SAMPLE_RATE))
                mix_into(right, [v * (0.5 + pan) for v in nb], int(t0 * SAMPLE_RATE))

        elif track.pattern == "arpeggio":
            order = [0, 1, 2, 1]
            for step in range(8):
                f = chord[order[step % 4]] * (2 if step >= 4 else 1)
                st = t0 + step * (bar / 8)
                nb = note_buffer(f, bar / 8 * 1.7, track.waveform, attack=0.008, release_ratio=0.6)
                pan = 0.2 * math.sin(step)
                mix_into(left, [v * (0.5 - pan) for v in nb], int(st * SAMPLE_RATE))
                mix_into(right, [v * (0.5 + pan) for v in nb], int(st * SAMPLE_RATE))
            # low root
            nb = note_buffer(chord[0] / 2, bar * 0.95, "sine", attack=0.02, release_ratio=0.3)
            mix_into(left, [v * 0.7 for v in nb], int(t0 * SAMPLE_RATE))
            mix_into(right, [v * 0.7 for v in nb], int(t0 * SAMPLE_RATE))

        elif track.pattern == "pad":
            for k, f in enumerate(chord):
                nb = note_buffer(f / 2 if k == 0 else f, bar * 1.6, "sine",
                                 attack=0.5, release_ratio=0.7)
                gain = 0.85 if k == 0 else 0.55
                pan = 0.18 * (k - 1)
                mix_into(left, [v * gain * (0.5 - pan) for v in nb], int(t0 * SAMPLE_RATE))
                mix_into(right, [v * gain * (0.5 + pan) for v in nb], int(t0 * SAMPLE_RATE))
            # sparse high note
            f = chord[2] * 2
            st = t0 + bar * (0.25 + 0.5 * rng.random())
            nb = note_buffer(f, bar * 0.5, "sine", attack=0.05, release_ratio=0.7)
            mix_into(left, [v * 0.28 for v in nb], int(st * SAMPLE_RATE))
            mix_into(right, [v * 0.34 for v in nb], int(st * SAMPLE_RATE))

        # rhythm
        if track.pattern == "arpeggio":
            for beat_i in range(4):
                mix_into(left, kick_buf, int((t0 + beat_i * beat) * SAMPLE_RATE))
                mix_into(right, kick_buf, int((t0 + beat_i * beat) * SAMPLE_RATE))
            for step in range(8):
                if step % 2 == 1:
                    mix_into(left, hat_buf, int((t0 + step * bar / 8) * SAMPLE_RATE))
                    mix_into(right, hat_buf, int((t0 + step * bar / 8) * SAMPLE_RATE))
        elif track.pattern == "chords":
            for beat_i in (0, 2):
                mix_into(left, [v * 0.7 for v in kick_buf], int((t0 + beat_i * beat) * SAMPLE_RATE))
                mix_into(right, [v * 0.7 for v in kick_buf], int((t0 + beat_i * beat) * SAMPLE_RATE))
        b += 1

    # song-level fade in / fade out
    fade_in = int(SAMPLE_RATE * 0.4)
    fade_out = int(SAMPLE_RATE * 1.2)
    for i in range(min(fade_in, total)):
        g = i / fade_in
        left[i] *= g
        right[i] *= g
    for i in range(min(fade_out, total)):
        idx = total - 1 - i
        g = i / fade_out
        left[idx] *= g
        right[idx] *= g

    left = one_pole_lowpass(left, 5200)
    right = one_pole_lowpass(right, 5200)

    peak = max([abs(v) for v in left] + [abs(v) for v in right]) or 1.0
    gain = 0.72 / peak

    frames = bytearray()
    for i in range(total):
        l = max(-1.0, min(1.0, left[i] * gain))
        r = max(-1.0, min(1.0, right[i] * gain))
        frames += struct.pack("<hh", int(l * 32767), int(r * 32767))
    return bytes(frames)


def wav_duration(path: str) -> float:
    with wave.open(path, "rb") as w:
        return w.getnframes() / float(w.getframerate())


def encode_mp3(wav_path: str, mp3_path: str, bitrate: int = 192) -> bool:
    """Encode the demo WAV to MP3 so the repo stays small (needs `lameenc`)."""
    try:
        import lameenc
    except ImportError:
        print("  ! lameenc not installed — keeping WAV only (pip install lameenc)")
        return False

    with wave.open(wav_path, "rb") as w:
        pcm = w.readframes(w.getnframes())
        channels = w.getnchannels()
        rate = w.getframerate()

    enc = lameenc.Encoder()
    enc.set_bit_rate(bitrate)
    enc.set_in_sample_rate(rate)
    enc.set_channels(channels)
    enc.set_quality(2)
    data = enc.encode(pcm) + enc.flush()
    with open(mp3_path, "wb") as fh:
        fh.write(data)
    return True


# --------------------------------------------------------------------------
# cover art
# --------------------------------------------------------------------------

def build_covers(tracks: list[Track]) -> None:
    try:
        from PIL import Image, ImageDraw, ImageFilter, ImageFont
    except ImportError:
        print("Pillow not installed — skipping cover generation.", file=sys.stderr)
        return

    os.makedirs(COVER_DIR, exist_ok=True)
    size = 1000
    font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    font_reg = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    try:
        f_index = ImageFont.truetype(font_path, 26)
        f_meta = ImageFont.truetype(font_reg, 22)
    except OSError:
        f_index = f_meta = ImageFont.load_default()

    for i, track in enumerate(tracks, start=1):
        rng = random.Random(track.slug)
        img = Image.new("RGB", (size, size), BG)
        d = ImageDraw.Draw(img)

        # subtle vertical tone shift (flat, no gradient glow)
        for y in range(size):
            v = int(BG[0] + (SURFACE[0] - BG[0]) * (y / size) * 0.5)
            d.line([(0, y), (size, y)], fill=(v, v, v - 2))

        kind = track.cover
        pad = 150

        if kind == "circle":
            r = 250
            c = (size // 2, size // 2 - 40)
            d.ellipse([c[0] - r, c[1] - r, c[0] + r, c[1] + r], fill=ACCENT)
            d.ellipse([c[0] - 52, c[1] - 52, c[0] + 52, c[1] + 52], fill=BG)

        elif kind == "bars":
            widths = [26, 26, 26, 26]
            heights = [300, 460, 210, 380]
            x = pad + 40
            for w, h in zip(widths, heights):
                top = size - pad - h
                d.rounded_rectangle([x, top, x + w, size - pad], radius=13,
                                    fill=ACCENT if heights.index(h) == max(range(len(heights)), key=heights.__getitem__) else SOFT)
                x += w + 34

        elif kind == "horizon":
            d.line([(pad - 40, size // 2), (size - pad + 40, size // 2)], fill=SOFT, width=3)
            d.ellipse([size // 2 - 190, size // 2 - 190, size // 2 + 190, size // 2 + 190],
                      outline=ACCENT, width=6)
            d.line([(size // 2, size // 2), (size // 2 + 130, size // 2 - 130)], fill=ACCENT, width=6)

        elif kind == "diagonal":
            for k in range(5):
                off = 90 + k * 110
                d.line([(pad - 60 + off, size - pad + 60), (size - pad + 60, pad - 60 + off)],
                       fill=ACCENT if k == 2 else MUTED, width=8 if k == 2 else 3)

        elif kind == "arcs":
            for k in range(4):
                r = 130 + k * 78
                box = [size // 2 - r, size // 2 - r, size // 2 + r, size // 2 + r]
                d.arc(box, start=200, end=340, fill=ACCENT if k == 1 else SOFT, width=7)

        elif kind == "grid":
            step = 118
            for gx in range(pad, size - pad, step):
                d.line([(gx, pad), (gx, size - pad)], fill=SURFACE, width=2)
            for gy in range(pad, size - pad, step):
                d.line([(pad, gy), (size - pad, gy)], fill=SURFACE, width=2)
            d.rectangle([pad + step * 2, pad + step, pad + step * 4, pad + step * 4], fill=ACCENT)

        # grain
        grain = Image.effect_noise((size, size), 9).convert("L")
        img = Image.blend(img, Image.merge("RGB", (grain, grain, grain)), 0.06)
        img = img.filter(ImageFilter.GaussianBlur(0.35))
        d = ImageDraw.Draw(img)

        # type
        d.text((pad - 40, size - 96), f"{i:02d}", font=f_index, fill=OFFWHITE)
        d.text((pad + 26, size - 92), track.title.upper(), font=f_meta, fill=MUTED)
        d.text((size - pad + 40, size - 92), hz_to_name(track.root), font=f_meta,
               fill=ACCENT, anchor="ra")

        img.save(os.path.join(COVER_DIR, track.slug + ".jpg"), quality=88, optimize=True)


# --------------------------------------------------------------------------
# js/tracks.js
# --------------------------------------------------------------------------

def js_string(value: str) -> str:
    return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"') + '"'


def mmss(seconds: float) -> str:
    total = int(round(seconds))
    return f"{total // 60:02d}:{total % 60:02d}"


def write_tracks_js(tracks: list[Track]) -> None:
    os.makedirs(JS_DIR, exist_ok=True)
    lines = [
        "/* ==========================================================================",
        "   TRACK DATA — generated by scripts/build-tracks.py",
        "   --------------------------------------------------------------------------",
        "   Add one object per track:",
        "",
        "   {",
        '     title:    "Track Name",                    // required',
        '     artist:   "Artist Name",                   // required',
        '     cover:    "assets/covers/track-01.jpg",    // jpg / png / webp',
        '     audio:    "assets/audio/track-01.mp3",     // mp3 / wav / flac',
        '     download: "assets/audio/track-01.mp3",     // optional ("" hides the button)',
        '     duration: "03:42",                         // optional: read from file if empty',
        '     category: "single",                        // "single" | "album"',
        '     meta:     "Single · 2026",                 // optional small label',
        '     note:     "One line about the track."      // optional, full player only',
        "   }",
        "",
        "   Re-run `python3 scripts/build-tracks.py` after changing the assets folder.",
        "   ========================================================================== */",
        "",
        "window.TRACKS = [",
    ]

    for t in tracks:
        duration = t.durations.get(t.slug)
        audio_rel = ""
        for ext in ("mp3", "flac", "wav", "ogg", "m4a"):
            candidate = f"assets/audio/{t.slug}.{ext}"
            if os.path.exists(os.path.join(ROOT, candidate)):
                audio_rel = candidate
                break
        if not audio_rel:
            audio_rel = f"assets/audio/{t.slug}.mp3"
        cover_rel = f"assets/covers/{t.slug}.jpg"
        if not os.path.exists(os.path.join(ROOT, cover_rel)):
            cover_rel = ""

        lines += [
            "  {",
            f"    title: {js_string(t.title)},",
            f"    artist: {js_string(t.artist)},",
            f"    cover: {js_string(cover_rel)},",
            f"    audio: {js_string(audio_rel)},",
            f"    download: {js_string(audio_rel)},",
            f"    duration: {js_string(mmss(duration if duration is not None else t.seconds))},",
            f"    category: {js_string(t.category)},",
            f"    meta: {js_string(t.meta)},",
            f"    note: {js_string(t.note)}",
            "  },",
        ]
    if lines[-1].endswith(","):
        lines[-1] = lines[-1][:-1]
    lines += ["];", ""]

    with open(os.path.join(JS_DIR, "tracks.js"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))


# --------------------------------------------------------------------------

def main() -> None:
    os.makedirs(AUDIO_DIR, exist_ok=True)
    os.makedirs(COVER_DIR, exist_ok=True)

    only_missing = "--force" not in sys.argv
    want_mp3 = "--no-mp3" not in sys.argv

    for t in DEMO:
        path = os.path.join(AUDIO_DIR, t.slug + ".wav")
        mp3_path = os.path.join(AUDIO_DIR, t.slug + ".mp3")

        if only_missing and os.path.exists(path):
            print(f"  = audio exists  {t.slug}.wav")
        else:
            print(f"  + rendering     {t.slug}.wav ({t.seconds:.0f}s, {hz_to_name(t.root)} {t.pattern})")
            data = synthesise(t)
            with wave.open(path, "wb") as w:
                w.setnchannels(2)
                w.setsampwidth(2)
                w.setframerate(SAMPLE_RATE)
                w.writeframes(data)

        t.durations[t.slug] = wav_duration(path)

        if want_mp3 and not (only_missing and os.path.exists(mp3_path)):
            if encode_mp3(path, mp3_path):
                print(f"  + encoded       {t.slug}.mp3 "
                      f"({os.path.getsize(mp3_path) / 1024:.0f} KB)")

        if want_mp3 and "--keep-wav" not in sys.argv and os.path.exists(mp3_path):
            os.remove(path)   # mp3 keeps the repo small; --keep-wav to keep both

    build_covers(DEMO)
    write_tracks_js(DEMO)

    total = sum(os.path.getsize(os.path.join(AUDIO_DIR, f)) for f in os.listdir(AUDIO_DIR))
    print(f"\nDone. {len(DEMO)} tracks, assets/audio = {total / 1024 / 1024:.1f} MB")
    print("js/tracks.js rewritten.")


if __name__ == "__main__":
    main()
