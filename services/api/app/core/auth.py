import hashlib
import hmac
import secrets
from datetime import datetime, timezone
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient, PyJWTError
from jwt.exceptions import PyJWKClientError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.identity import Identity, IdentityVerifier
from app.db.session import get_db
from app.models.admin import User

bearer = HTTPBearer(auto_error=False)
JWT_CLOCK_SKEW_SECONDS = 30
_jwks_clients: dict[str, PyJWKClient] = {}


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, maxmem=64*1024*1024)
    return f'scrypt${salt.hex()}${digest.hex()}'


def verify_password(password: str, encoded: str | None) -> bool:
    try:
        if encoded is None:
            return False
        _, salt, digest = encoded.split('$')
        actual = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1, maxmem=64*1024*1024)
        return hmac.compare_digest(actual.hex(), digest)
    except (ValueError, TypeError):
        return False


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def decode_supabase_token(token: str) -> dict:
    base_url = settings.supabase_url.rstrip('/')
    if not base_url:
        raise HTTPException(503, 'Supabase authentication is not configured')
    issuer = f'{base_url}/auth/v1'
    jwks_url = f'{issuer}/.well-known/jwks.json'
    try:
        client = _jwks_clients.get(jwks_url)
        if client is None:
            client = PyJWKClient(jwks_url, cache_keys=True)
            _jwks_clients[jwks_url] = client
        signing_key = client.get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=['ES256', 'RS256', 'EdDSA'],
            audience=settings.supabase_jwt_audience,
            issuer=issuer,
            options={'require': ['exp', 'sub', 'iss', 'aud']},
            # Supabase Auth's clock can run ahead of the API host; without this a
            # just-issued token fails "iat in the future" and sign-in breaks.
            leeway=JWT_CLOCK_SKEW_SECONDS,
        )
    except (PyJWTError, PyJWKClientError, ValueError):
        raise HTTPException(401, 'Invalid or expired access token', headers={'WWW-Authenticate': 'Bearer'})


class SupabaseJwtVerifier:
    """Supabase Auth access tokens, verified by decode_supabase_token above."""
    provider = 'supabase'

    def verify(self, token: str) -> Identity:
        claims = decode_supabase_token(token)
        try:
            subject = str(UUID(claims['sub']))
        except (KeyError, TypeError, ValueError):
            raise HTTPException(401, 'Invalid access token subject', headers={'WWW-Authenticate': 'Bearer'})
        email = claims.get('email')
        email = email.strip().lower() if isinstance(email, str) and email.strip() else None
        # Supabase reports email_verified only inside user_metadata, which the user can
        # edit (auth.updateUser), so it is never trusted. Fail closed until a trusted
        # confirmation source is chosen.
        return Identity(provider=self.provider, subject=subject, email=email, email_verified=False)


_supabase_verifier = SupabaseJwtVerifier()


def identity_verifier() -> IdentityVerifier:
    return _supabase_verifier


def current_identity(credentials: HTTPAuthorizationCredentials | None = Depends(bearer), verifier: IdentityVerifier = Depends(identity_verifier)) -> Identity:
    if not credentials:
        raise HTTPException(401, 'Sign in to continue', headers={'WWW-Authenticate': 'Bearer'})
    return verifier.verify(credentials.credentials)


def current_user(identity: Identity = Depends(current_identity), db: Session = Depends(get_db)) -> User:
    # users.supabase_user_id links tenant accounts to Supabase subjects only.
    if identity.provider != SupabaseJwtVerifier.provider:
        raise HTTPException(401, 'Account is not linked or is unavailable')
    user = db.scalar(select(User).where(User.supabase_user_id == identity.subject))
    if not user or not user.active:
        raise HTTPException(401, 'Account is not linked or is unavailable')
    return user


def enforce_scope(user: User, business_id: str, location_id: str | None = None):
    if user.business_id != business_id or (location_id is not None and user.location_id != location_id):
        raise HTTPException(403, 'This record belongs to another business or location')
