"""Real FastAPI + seeded pilot tenant for the full-stack Playwright test.

Uses an isolated SQLite file and a local JWKS (test signing key) in place of
Supabase Auth, so the API verifies real signed JWTs. Never touches the pilot DB.

    python scripts/e2e_server.py <workdir> [port]
Writes <workdir>/tokens.json for the Playwright test.
"""
import json
import os
import sys
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from uuid import uuid4

WORKDIR = Path(sys.argv[1]).resolve()
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8020
JWKS_PORT = PORT + 1
WORKDIR.mkdir(parents=True, exist_ok=True)
(WORKDIR / 'e2e.db').unlink(missing_ok=True)
os.environ.update(ENVIRONMENT='test', DATABASE_URL=f'sqlite:///{(WORKDIR / "e2e.db").as_posix()}',
                  SUPABASE_URL=f'http://127.0.0.1:{JWKS_PORT}', CORS_ORIGINS='http://localhost:5174')
os.environ.pop('MAKNAM_ENV_FILE', None)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import jwt  # noqa: E402
import uvicorn  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402

from app import seed_pilot as pilot  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.db.session import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402

assert settings.is_sqlite and 'e2e.db' in settings.database_url, 'e2e server must use its isolated SQLite file'
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
JWK = {**json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(KEY.public_key())), 'kid': 'e2e', 'alg': 'RS256', 'use': 'sig'}


class Jwks(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({'keys': [JWK]}).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(body)
    def log_message(self, *args): pass


class LocalAuth:
    """Stands in for the Supabase Auth admin API during seeding."""
    def __init__(self): self.users = []; self.client = self
    def list_users(self): return list(self.users)
    def post(self, path, json):
        user = {'id': str(uuid4()), 'email': json['email'], 'app_metadata': json['app_metadata']}
        self.users.append(user)
        return type('R', (), {'json': lambda _self: user, 'is_error': False})()
    def reset_password(self, *args): pass
    def _check(self, response): pass


def token(subject):
    now = datetime.now(timezone.utc)
    claims = {'iss': f'{settings.supabase_url}/auth/v1', 'aud': 'authenticated', 'sub': subject, 'role': 'authenticated', 'iat': now, 'exp': now + timedelta(hours=3)}
    return jwt.encode(claims, KEY, algorithm='RS256', headers={'kid': 'e2e'})


Base.metadata.create_all(engine)
auth = LocalAuth()
with SessionLocal() as db:
    pilot.seed_pilot(db, auth)
tokens = {u['app_metadata'][pilot.MARKER]: token(u['id']) for u in auth.users}
(WORKDIR / 'tokens.json').write_text(json.dumps({**tokens, 'api': f'http://127.0.0.1:{PORT}/api/v1'}))
threading.Thread(target=ThreadingHTTPServer(('127.0.0.1', JWKS_PORT), Jwks).serve_forever, daemon=True).start()
print(f'e2e API on {PORT}, tokens at {WORKDIR / "tokens.json"}', flush=True)
uvicorn.run(app, host='127.0.0.1', port=PORT, log_level='warning')
