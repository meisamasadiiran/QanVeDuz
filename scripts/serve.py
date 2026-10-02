#!/usr/bin/env python3
"""
Tiny static file server with HTTP Range support (needed for smooth audio
seeking during local development).

    python3 scripts/serve.py            # http://0.0.0.0:8080
    python3 scripts/serve.py 3000       # custom port

Production hosting (Cloudflare Pages / GitHub Pages) serves Range requests
natively; this server only matters for local previews.
"""
import os
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        return MIME.get(ext, super().guess_type(path))

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def do_GET(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            path = os.path.join(path, "index.html")
        if not os.path.isfile(path):
            self.send_error(404, "Not Found")
            return

        size = os.path.getsize(path)
        start, end = 0, size - 1
        range_header = self.headers.get("Range")
        if range_header and range_header.startswith("bytes="):
            try:
                spec = range_header[6:]
                if spec.startswith("-"):          # suffix range: last N bytes
                    start = size - int(spec[1:])
                else:
                    parts = spec.split("-")
                    start = int(parts[0])
                    if parts[1]:
                        end = int(parts[1])
                end = min(end, size - 1)
                if start > end or start >= size:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.end_headers()
                    return
                self.send_response(206)
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            except ValueError:
                self.send_response(200)
        else:
            self.send_response(200)

        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()

        with open(path, "rb") as fh:
            fh.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                chunk = fh.read(min(64 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def do_HEAD(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            path = os.path.join(path, "index.html")
        if not os.path.isfile(path):
            self.send_error(404, "Not Found")
            return
        self.send_response(200)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Length", str(os.path.getsize(path)))
        self.end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Serving {ROOT} on http://0.0.0.0:{port}")
    server.serve_forever()
