from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.db.session import Base, get_db
from app.models.models import Business, Location, Terminal
from app.models.admin import User
from app.core import auth as auth_core
from app.core.auth import hash_password
from app.core.config import settings

OWNER_SUB='d6545a1b-9255-4a17-97c9-e1b62f2a1f5f'
UNLINKED_SUB='91f9d3b2-d919-4db7-bf82-9effe58377b7'
ISSUER='https://maknam-test.supabase.co/auth/v1'
PRIVATE_KEY=rsa.generate_private_key(public_exponent=65537,key_size=2048)
PUBLIC_KEY=PRIVATE_KEY.public_key()
PASSWORD='test-only-owner-password'


def token_for(subject=OWNER_SUB, **overrides):
    now=datetime.now(timezone.utc)
    claims={'iss':ISSUER,'aud':'authenticated','sub':subject,'iat':now,'exp':now+timedelta(minutes=15),'role':'authenticated'}
    claims.update(overrides)
    return jwt.encode(claims,PRIVATE_KEY,algorithm='RS256',headers={'kid':'test-key'})


class FakeJWKClient:
    def __init__(self,*args,**kwargs):pass
    def get_signing_key_from_jwt(self,token):
        if jwt.get_unverified_header(token).get('kid')!='test-key':
            raise auth_core.PyJWKClientError('Unknown key id')
        return SimpleNamespace(key=PUBLIC_KEY)


class SignInResult:
    def __init__(self,response,token):
        self.status_code=response.status_code
        self.response=response
        self.token=token
    def json(self):
        return {'token':self.token,'user':self.response.json()}


@pytest.fixture
def auth_client(monkeypatch):
    engine=create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool)
    Base.metadata.create_all(engine)
    sessions=sessionmaker(bind=engine,expire_on_commit=False)
    with sessions.begin() as db:
        db.add(Business(id='auth-business',name='Restaurant'))
        db.add(Location(id='auth-location',business_id='auth-business',name='Branch'))
        db.add(Terminal(id='auth-terminal',business_id='auth-business',location_id='auth-location',name='Tablet'))
        db.add(User(id='auth-owner',supabase_user_id=OWNER_SUB,email='owner@example.test',name='Owner',business_id='auth-business',location_id='auth-location',password_hash=hash_password(PASSWORD)))
    def scoped_db():
        with sessions() as db:yield db
    app.dependency_overrides[get_db]=scoped_db
    monkeypatch.setattr(settings,'supabase_url','https://maknam-test.supabase.co')
    monkeypatch.setattr(auth_core,'PyJWKClient',FakeJWKClient)
    auth_core._jwks_clients.clear()
    yield TestClient(app),sessions
    app.dependency_overrides.pop(get_db,None)
    auth_core._jwks_clients.clear()
    engine.dispose()


def signin(client,subject=OWNER_SUB):
    token=token_for(subject)
    response=client.get('/api/v1/auth/me',headers={'Authorization':'Bearer '+token})
    return SignInResult(response,token)


def test_linked_supabase_identity_resolves_local_tenant_profile(auth_client):
    client,sessions=auth_client
    response=signin(client)
    assert response.status_code==200
    body=response.json()
    assert body['user']['role']=='ADMIN'
    assert body['user']['businessId']=='auth-business'
    assert 'password_hash' not in body['user']
    assert client.get('/api/v1/auth/me',headers={'Authorization':'Bearer '+body['token']}).status_code==200
    with sessions() as db:
        user=db.scalar(select(User).where(User.email=='owner@example.test'))
        assert user.supabase_user_id==OWNER_SUB


def test_missing_or_unlinked_identity_is_rejected(auth_client):
    client,_=auth_client
    assert client.get('/api/v1/auth/me').status_code==401
    assert signin(client,UNLINKED_SUB).status_code==401


def test_invalid_signature_issuer_audience_and_expiry_are_rejected(auth_client):
    client,_=auth_client
    wrong_key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
    invalid=jwt.encode({'iss':ISSUER,'aud':'authenticated','sub':OWNER_SUB,'exp':datetime.now(timezone.utc)+timedelta(minutes=5)},wrong_key,algorithm='RS256',headers={'kid':'test-key'})
    cases=[invalid,token_for(iss='https://attacker.example/auth/v1'),token_for(aud='other'),token_for(exp=datetime.now(timezone.utc)-timedelta(seconds=auth_core.JWT_CLOCK_SKEW_SECONDS+5))]
    for token in cases:
        assert client.get('/api/v1/auth/me',headers={'Authorization':'Bearer '+token}).status_code==401


def test_disabled_user_and_missing_server_configuration_fail_closed(auth_client,monkeypatch):
    client,sessions=auth_client
    with sessions.begin() as db:db.get(User,'auth-owner').active=False
    assert signin(client).status_code==401
    monkeypatch.setattr(settings,'supabase_url','')
    assert client.get('/api/v1/auth/me',headers={'Authorization':'Bearer '+token_for()}).status_code==503


def test_token_issued_by_a_slightly_fast_auth_clock_is_accepted(auth_client):
    # Supabase Auth's clock can be a few seconds ahead of the API host.
    client,_=auth_client
    ahead=datetime.now(timezone.utc)+timedelta(seconds=5)
    assert client.get('/api/v1/auth/me',headers={'Authorization':'Bearer '+token_for(iat=ahead)}).status_code==200
