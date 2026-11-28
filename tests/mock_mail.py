"""Stand-in for the Cloudflare Email Sending REST API, for local tests only.
POST /send          -> records the email (or returns 500 when in 'fail' mode)
GET  /log           -> everything received so far
POST /mode/ok|fail  -> switch behaviour
"""
import json, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOG, MODE = [], {"m": "ok"}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header("content-type", "application/json"); self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        self._send(200, LOG if self.path == "/log" else {})
    def do_POST(self):
        if self.path.startswith("/mode/"):
            MODE["m"] = self.path.split("/")[-1]; return self._send(200, {"ok": True})
        n = int(self.headers.get("content-length") or 0)
        body = json.loads(self.rfile.read(n) or b"{}")
        if MODE["m"] == "fail":
            return self._send(500, {"success": False, "errors": [{"code": 10000, "message": "simulated outage"}]})
        LOG.append({"path": self.path, "auth": self.headers.get("authorization"), "body": body})
        self._send(200, {"success": True, "errors": [], "result": {"message_id": "<test@x>", "delivered": [body.get("to")]}})

ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 9999), H).serve_forever()
