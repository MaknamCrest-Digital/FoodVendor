from fastapi.testclient import TestClient
from app.main import app
from app.db.session import Base, get_db
from app.models.models import Business, Location, Terminal, Order, SyncEvent
from sqlalchemy import select, func, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.models.admin import User
from app.core.auth import hash_password
from app.core import auth as auth_core
from app.core.config import settings
from test_auth import FakeJWKClient, OWNER_SUB, token_for

ORIGINAL_JWKS_CLIENT=auth_core.PyJWKClient

engine=create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool)
SessionLocal=sessionmaker(bind=engine,expire_on_commit=False)
client = TestClient(app)

def test_db():
    with SessionLocal() as db:yield db
test_db.__test__=False

def setup_module():
    Base.metadata.create_all(engine)
    app.dependency_overrides[get_db]=test_db
    db=SessionLocal()
    b=Business(id="11111111-1111-1111-1111-111111111111", name="Adonai Pork")
    l=Location(id="22222222-2222-2222-2222-222222222222", business_id=b.id, name="Dansoman")
    t=Terminal(id="33333333-3333-3333-3333-333333333333", business_id=b.id, location_id=l.id, name="Tablet 1")
    db.add_all([b,l,t]); db.commit(); db.close()
    with SessionLocal.begin() as db:
        db.add(User(supabase_user_id=OWNER_SUB,email='sync-test@example.test',name='Test Admin',business_id=b.id,location_id=l.id,password_hash=hash_password('test-only-password-123')))
    settings.supabase_url='https://maknam-test.supabase.co'
    auth_core.PyJWKClient=FakeJWKClient
    auth_core._jwks_clients.clear()
    client.headers['Authorization']='Bearer '+token_for(OWNER_SUB)

def teardown_module():
    app.dependency_overrides.pop(get_db,None)
    auth_core.PyJWKClient=ORIGINAL_JWKS_CLIENT
    auth_core._jwks_clients.clear()
    engine.dispose()

def event():
    return {"event_id":"44444444-4444-4444-4444-444444444444","event_type":"order.completed","entity_id":"55555555-5555-5555-5555-555555555555","business_id":"11111111-1111-1111-1111-111111111111","location_id":"22222222-2222-2222-2222-222222222222","terminal_id":"33333333-3333-3333-3333-333333333333","app_version":"0.1.0","local_schema_version":1,"sync_protocol_version":1,"occurred_at":"2026-09-27T12:00:00Z","payload":{"id":"55555555-5555-5555-5555-555555555555","receipt_no":"AD-T1-000001","total_pesewas":8500,"payment_method":"MOMO","items":[{"id":"66666666-6666-6666-6666-666666666666","menu_item_id":"77777777-7777-7777-7777-777777777777","name":"Pork + Yam","quantity":1,"unit_price_pesewas":8500}]}}

def test_retry_is_idempotent():
    first=client.post("/api/v1/sync/events", json=event()); assert first.status_code==200; assert first.json()["status"]=="accepted"
    second=client.post("/api/v1/sync/events", json=event()); assert second.status_code==200; assert second.json()["status"]=="already_processed"
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Order)) == 1
        assert db.scalar(select(func.count()).select_from(SyncEvent)) == 1

def test_wrong_tenant_is_rejected_before_duplicate_ack():
    body = event()
    body["business_id"] = "99999999-9999-9999-9999-999999999999"
    assert client.post("/api/v1/sync/events", json=body).status_code == 403

def test_wrong_location_is_rejected():
    body = event()
    body["location_id"] = "99999999-9999-9999-9999-999999999999"
    assert client.post("/api/v1/sync/events", json=body).status_code == 403

def test_unsupported_sync_protocol_is_rejected():
    body = event()
    body["sync_protocol_version"] = 99
    assert client.post("/api/v1/sync/events", json=body).status_code == 409

def test_version_one_header_retry_keeps_existing_transaction():
    body = event()
    body["app_version"] = "1.0.0"
    first = client.post("/api/v1/sync/events", json=body, headers={"Idempotency-Key":body["event_id"]})
    second = client.post("/api/v1/sync/events", json=body, headers={"Idempotency-Key":body["event_id"]})
    assert first.status_code == second.status_code == 200
    assert second.json()["status"] == "already_processed"
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Order)) == 1

def test_mismatched_idempotency_header_is_rejected():
    assert client.post("/api/v1/sync/events", json=event(), headers={"Idempotency-Key":"different"}).status_code == 409
