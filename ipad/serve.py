"""Static server for the spike: /path -> path.html like the app's asset resolver, .wasm with its MIME type, no cache."""
import http.server, os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'web', 'dist')

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.wasm': 'application/wasm', '.mjs': 'text/javascript', '.gz': 'application/gzip', '.txt': 'text/plain; charset=utf-8'}
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def guess_type(self, path):
        if path.endswith('.tar.gz'): return 'application/gzip'
        return super().guess_type(path)
    def send_head(self):
        path = self.path.split('?', 1)[0].split('#', 1)[0]
        local = os.path.join(ROOT, path.lstrip('/'))
        if path != '/' and not os.path.isfile(local) and os.path.exists(local.rstrip('/') + '.html'):
            self.path = path.rstrip('/') + '.html'
        return super().send_head()
    def do_POST(self):
        # the ?auto scenario posts its results here (Safari, the simulator): appended to .build/results.txt
        if self.path != '/__report':
            self.send_error(404); return
        body = self.rfile.read(int(self.headers.get('Content-Length', 0))).decode('utf-8', 'replace')
        os.makedirs(os.path.join(os.path.dirname(ROOT), '..', '.build'), exist_ok=True)
        with open(os.path.join(os.path.dirname(ROOT), '..', '.build', 'results.txt'), 'a', encoding='utf-8') as f:
            f.write(body + '\n---\n')
        self.send_response(204); self.end_headers()
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 3801), Handler).serve_forever()
