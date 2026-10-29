from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.db.session import Base, get_db
from app.models.models import Business, Location, Terminal
from app.models.admin import User
from app.core import auth as auth_core
from app.core.auth import SupabaseJwtVerifier, identity_verifier
from app.core.config import settings
from app.core.identity import Identity

SUB='d6545a1b-9255-4a17-97c9-e1b62f2a1f5f'
ISSUER='https://maknam-test.supabase.co/auth/v1'
PRIVATE_KEY=rsa.generate_private_key(public_exponent=65537,key_size=2048)
created_clients=[]


def token_for(key=PRIVATE_KEY, algorithm='RS256', kid='test-key', drop=(), **overrides):
    now=datetime.now(timezone.utc)
    claims={'iss':ISSUER,'aud':'authenticated','sub':SUB,'iat':now,'exp':now+timedelta(minutes=15),'role':'authenticated','email':'Owner@Example.Test'}
    claims.update(overrides)
    for name in drop:claims.pop(name)
    return jwt.encode(claims,key,algorithm=algorithm,headers={'kid':kid})


class FakeJWKClient:
    def __init__(self,url,*args,**kwargs):created_clients.append(url)
    def get_signing_key_from_jwt(self,token):
        if jwt.get_unverified_header(token).get('kid')!='test-key':raise auth_core.PyJWKClientError('Unknown key id')
        return SimpleNamespace(key=PRIVATE_KEY.public_key())


@pytest.fixture
def verifier(monkeypatch):
    monkeypatch.setattr(settings,'supabase_url','https://maknam-test.supabase.co')
    monkeypatch.setattr(auth_core,'PyJWKClient',FakeJWKClient)
    auth_core._jwks_clients.clear();created_clients.clear()
    yield SupabaseJwtVerifier()
    auth_core._jwks_clients.clear()


def rejected(verifier,token,status=401):
    with pytest.raises(HTTPException) as error:verifier.verify(token)
    return error.value.status_code==status


def test_valid_supabase_token_maps_to_provider_neutral_identity(verifier):
    identity=verifier.verify(token_for(sub=SUB.upper(),email='  Owner@Example.Test '))
    assert identity==Identity(provider='supabase',subject=SUB,email='owner@example.test',email_verified=False)


def test_user_editable_email_verified_claim_is_never_trusted(verifier):
    token=token_for(user_metadata={'email_verified':True},email_verified=True)
    assert verifier.verify(token).email_verified is False


def test_missing_or_blank_email_maps_to_none(verifier):
    assert verifier.verify(token_for(drop=('email',))).email is None
    assert verifier.verify(token_for(email='  ')).email is None


def test_invalid_signature_and_unknown_key_are_rejected(verifier):
    other=rsa.generate_private_key(public_exponent=65537,key_size=2048)
    assert rejected(verifier,token_for(key=other))
    assert rejected(verifier,token_for(kid='attacker-key'))


def test_unsigned_and_symmetric_tokens_are_rejected(verifier):
    assert rejected(verifier,token_for(key=None,algorithm='none'))
    assert rejected(verifier,token_for(key='guessable-shared-secret',algorithm='HS256'))


def test_expired_token_is_rejected_beyond_clock_skew(verifier):
    late=datetime.now(timezone.utc)-timedelta(seconds=auth_core.JWT_CLOCK_SKEW_SECONDS+5)
    assert rejected(verifier,token_for(exp=late))
    assert rejected(verifier,token_for(drop=('exp',)))


def test_token_from_a_slightly_fast_auth_clock_is_accepted(verifier):
    assert verifier.verify(token_for(iat=datetime.now(timezone.utc)+timedelta(seconds=5))).subject==SUB


def test_wrong_issuer_and_audience_are_rejected(verifier):
    assert rejected(verifier,token_for(iss='https://attacker.example/auth/v1'))
    assert rejected(verifier,token_for(drop=('iss',)))
    assert rejected(verifier,token_for(aud='other'))
    assert rejected(verifier,token_for(drop=('aud',)))


def test_missing_or_malformed_subject_is_rejected(verifier):
    assert rejected(verifier,token_for(drop=('sub',)))
    assert rejected(verifier,token_for(sub='not-a-uuid'))
    with pytest.raises(HTTPException) as error:verifier.verify(token_for(sub='not-a-uuid'))
    assert error.value.detail=='Invalid access token subject'


def test_unconfigured_supabase_fails_closed(verifier,monkeypatch):
    monkeypatch.setattr(settings,'supabase_url','')
    assert rejected(verifier,token_for(),503)


def test_jwks_client_is_created_once_per_issuer(verifier):
    for _ in range(3):verifier.verify(token_for())
    assert created_clients==[ISSUER+'/.well-known/jwks.json']


@pytest.fixture
def tenant_client(verifier):
    engine=create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool)
    Base.metadata.create_all(engine)
    sessions=sessionmaker(bind=engine,expire_on_commit=False)
    with sessions.begin() as db:
        for business in ('tenant-a','tenant-b'):db.add(Business(id=business,name=business))
        db.add(Location(id='branch-a',business_id='tenant-a',name='Branch'))
        db.add(Terminal(id='till-a',business_id='tenant-a',location_id='branch-a',name='Till'))
        db.add(User(id='owner-a',supabase_user_id=SUB,email='owner@example.test',name='Owner',business_id='tenant-a',location_id='branch-a'))
    def scoped_db():
        with sessions() as db:yield db
    app.dependency_overrides[get_db]=scoped_db
    yield TestClient(app)
    app.dependency_overrides.clear()
    engine.dispose()


def bearer(token=None):return {'Authorization':'Bearer '+(token or token_for())}


def test_tenant_user_is_resolved_from_the_verified_token_only(tenant_client):
    body=tenant_client.get('/api/v1/auth/me',headers=bearer()).json()
    assert (body['id'],body['businessId'],body['locationId'])==('owner-a','tenant-a','branch-a')
    missing=tenant_client.get('/api/v1/auth/me')
    assert missing.status_code==401 and missing.headers['www-authenticate']=='Bearer'


def test_tenant_scope_still_applies_after_identity_resolution(tenant_client):
    assert tenant_client.get('/api/v1/menu/tenant-a',headers=bearer()).status_code==200
    assert tenant_client.get('/api/v1/menu/tenant-b',headers=bearer()).status_code==403


def test_identity_from_another_provider_cannot_claim_a_supabase_link(tenant_client):
    class OtherProvider:
        provider='other'
        def verify(self,token):return Identity(provider='other',subject=SUB,email='owner@example.test',email_verified=True)
    app.dependency_overrides[identity_verifier]=lambda:OtherProvider()
    assert tenant_client.get('/api/v1/auth/me',headers=bearer('opaque')).status_code==401
