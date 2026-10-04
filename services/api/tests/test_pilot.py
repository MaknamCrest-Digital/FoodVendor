"""Pilot critical path against the seeded Adonai Pork tenant (in-memory SQLite)."""
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import seed_pilot as pilot
from app.api import health_routes
from app.core import auth as auth_core
from app.core.config import settings
from app.db.session import Base, get_db
from app.main import app
from app.models.access import SecurityAudit
from app.models.admin import AdminEvent, AdminRecord, User
from app.models.models import Business, Location, Order, SyncEvent, Terminal
from test_auth import FakeJWKClient, token_for

B, L, T = pilot.BUSINESS_ID, pilot.LOCATION_ID, pilot.TERMINAL_ID
COKE = pilot.pilot_id('menu:coke')
PORK = pilot.pilot_id('menu:pork-yam')
PORK_MEDIUM = pilot.pilot_id('variation:pork-yam:medium')


class FakeResponse:
    def __init__(self, body): self.body = body; self.is_error = False
    def json(self): return self.body


class FakeSupabaseAdmin:
    """Stands in for the Supabase Auth admin API."""
    def __init__(self): self.users = []; self.client = self
    def list_users(self): return list(self.users)
    def post(self, path, json):
        user = {'id': str(uuid4()), 'email': json['email'], 'app_metadata': json['app_metadata']}
        self.users.append(user)
        return FakeResponse(user)
    def reset_password(self, user_id, password): pass
    def _check(self, response): pass


@pytest.fixture
def pilot_env(monkeypatch):
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    fake = FakeSupabaseAdmin()
    with sessions() as db:
        first = pilot.seed_pilot(db, fake)
    def scoped_db():
        with sessions() as db: yield db
    app.dependency_overrides[get_db] = scoped_db
    monkeypatch.setattr(settings, 'supabase_url', 'https://maknam-test.supabase.co')
    monkeypatch.setattr(auth_core, 'PyJWKClient', FakeJWKClient)
    monkeypatch.setattr(health_routes, 'engine', engine)
    auth_core._jwks_clients.clear()
    subjects = {u['app_metadata'][pilot.MARKER]: u['id'] for u in fake.users}
    headers = {key: {'Authorization': 'Bearer ' + token_for(subject)} for key, subject in subjects.items()}
    yield TestClient(app), sessions, headers, fake, first
    app.dependency_overrides.pop(get_db, None)
    auth_core._jwks_clients.clear()
    engine.dispose()


def me(client, headers): return client.get('/api/v1/auth/me', headers=headers).json()
def op(user, kind, entity, data, action='CREATED', version=0):
    return {'id': str(uuid4()), 'businessId': B, 'locationId': L, 'actorId': user['id'], 'entityId': entity, 'kind': kind, 'action': action, 'baseVersion': version, 'occurredAt': datetime.now(timezone.utc).isoformat(), 'data': data}
def push(client, headers, event): return client.post('/api/v1/admin/events', json=event, headers={**headers, 'Idempotency-Key': event['id']})


def sale(user, method, shift_id, coke_before=48, tender=None):
    order_id = str(uuid4())
    total = 9000 + 1200
    movement = op(user, 'stock', str(uuid4()), {'menuItemId': COKE, 'type': 'SALE', 'quantityDelta': -1, 'balanceBefore': coke_before, 'balanceAfter': coke_before - 1, 'referenceId': order_id, 'reason': 'Paid sale'})
    payload = {'id': order_id, 'receipt_no': f'AD-01-{order_id}', 'total_pesewas': total, 'payment_method': method, 'shift_id': shift_id, 'cashier_id': user['id'],
               'items': [{'id': str(uuid4()), 'menu_item_id': PORK, 'name': 'Pork + Yam · Medium', 'quantity': 1, 'unit_price_pesewas': 9000, 'variation_id': PORK_MEDIUM, 'variation_name': 'Medium'},
                         {'id': str(uuid4()), 'menu_item_id': COKE, 'name': 'Coke', 'quantity': 1, 'unit_price_pesewas': 1200, 'track_stock': True}],
               'stock_movements': [movement]}
    if method == 'CASH':
        payload.update(amount_tendered=tender or total, change=(tender or total) - total)
    else:
        payload['payment_reference'] = 'MOMO-REF-1'
    return {'event_id': str(uuid4()), 'event_type': 'order.completed', 'entity_id': order_id, 'business_id': B, 'location_id': L, 'terminal_id': T,
            'app_version': '1.0.0', 'local_schema_version': 1, 'sync_protocol_version': 2, 'occurred_at': datetime.now(timezone.utc).isoformat(), 'payload': payload}


def sync(client, headers, body): return client.post('/api/v1/sync/events', json=body, headers={**headers, 'Idempotency-Key': body['event_id']})


def open_shift(client, headers, user, opening=20000):
    shift_id = str(uuid4())
    data = {'operatorId': user['id'], 'operatorName': user['name'], 'terminalId': T, 'status': 'OPEN', 'openedAt': datetime.now(timezone.utc).isoformat(), 'openingCash': opening, 'staffIds': [user['id']]}
    response = push(client, headers, op(user, 'shift', shift_id, data, 'SHIFT_OPENED'))
    assert response.status_code == 200, response.text
    return shift_id, data


def coke_stock(sessions):
    with sessions() as db:
        return sum(r.data['quantityDelta'] for r in db.scalars(select(AdminRecord).where(AdminRecord.kind == 'stock')) if r.data['menuItemId'] == COKE)


def test_health_and_database_connection(pilot_env):
    client = pilot_env[0]
    assert client.get('/health').json()['status'] == 'ok'
    body = client.get('/health/db').json()
    assert body == {'status': 'ok', 'environment': settings.environment, 'database': 'connected'}
    assert client.get('/api/v1/health/db').status_code == 200


def test_seed_is_idempotent_and_shows_passwords_once(pilot_env):
    _, sessions, _, fake, first = pilot_env
    assert set(first.credentials) == {'admin', 'cashier'} and not first.unlinked
    def counts(db): return [db.scalar(select(func.count()).select_from(m)) for m in (Business, Location, Terminal, User, AdminRecord, AdminEvent)]
    with sessions() as db:
        before = counts(db)
        second = pilot.seed_pilot(db, fake)
        assert counts(db) == before
    assert second.created == [] and second.credentials == {}
    assert len(fake.users) == 2
    assert before[:4] == [1, 1, 1, 2]


def test_seed_without_service_role_key_creates_unlinked_users(monkeypatch):
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine, expire_on_commit=False)() as db:
        result = pilot.seed_pilot(db, None)
        assert sorted(result.unlinked) == ['admin@adonai.test', 'cashier@adonai.test']
        assert db.scalar(select(func.count()).select_from(User).where(User.supabase_user_id.is_not(None))) == 0
    engine.dispose()


def test_admin_and_cashier_login_profiles(pilot_env):
    client, _, headers, _, _ = pilot_env
    admin, cashier = me(client, headers['admin']), me(client, headers['cashier'])
    assert (admin['email'], admin['businessName'], admin['locationName'], admin['terminalId']) == ('admin@adonai.test', 'Adonai Pork', 'Dansoman', T)
    assert admin['businessId'] == cashier['businessId'] == B and admin['locationId'] == L
    assert {'roles.manage', 'settings.general', 'audit.view'} <= set(admin['permissions'])
    assert cashier['role'] == 'CASHIER'
    assert {'pos.sale.create', 'shifts.open', 'shifts.close_own', 'orders.view', 'customers.view', 'pos.receipt.reprint'} <= set(cashier['permissions'])
    assert not {'team.view', 'roles.manage', 'settings.general', 'audit.view', 'sales.refund', 'sales.view_all'} & set(cashier['permissions'])


def test_invalid_login_is_rejected(pilot_env):
    client = pilot_env[0]
    assert client.get('/api/v1/auth/me').status_code == 401
    assert client.get('/api/v1/auth/me', headers={'Authorization': 'Bearer not-a-token'}).status_code == 401
    assert client.get('/api/v1/auth/me', headers={'Authorization': 'Bearer ' + token_for(str(uuid4()))}).status_code == 401


def test_admin_authorization(pilot_env):
    client, _, headers, _, _ = pilot_env
    assert client.get('/api/v1/team', headers=headers['admin']).status_code == 200
    assert client.get('/api/v1/admin/security-audit', headers=headers['admin']).status_code == 200
    general = next(s for s in client.get('/api/v1/settings', headers=headers['admin']).json()['sections'] if s['section'] == 'general')
    assert general['values']['currency'] == 'GHS' and general['values']['timezone'] == 'Africa/Accra'
    response = client.put('/api/v1/settings/general', headers=headers['admin'], json={'revision': general['revision'], 'values': {**general['values'], 'phone': '0200000000'}})
    assert response.status_code == 200, response.text


def test_cashier_is_restricted_server_side(pilot_env):
    client, _, headers, _, _ = pilot_env
    cashier = me(client, headers['cashier'])
    h = headers['cashier']
    assert client.get('/api/v1/team', headers=h).status_code == 403
    assert client.get('/api/v1/admin/security-audit', headers=h).status_code == 403
    assert client.post('/api/v1/team/roles', headers=h, json={'name': 'Boss', 'permissions': ['roles.manage']}).status_code == 403
    general = next(s for s in client.get('/api/v1/settings', headers=h).json()['sections'] if s['section'] == 'general')
    assert client.put('/api/v1/settings/general', headers=h, json={'revision': general['revision'], 'values': general['values']}).status_code == 403
    assert push(client, h, op(cashier, 'menu', str(uuid4()), {'name': 'Free food', 'categoryId': pilot.pilot_id('category:pork'), 'pricePesewas': 0})).status_code == 403
    assert push(client, h, op(cashier, 'stock', str(uuid4()), {'menuItemId': COKE, 'type': 'ADJUSTMENT', 'quantityDelta': 100, 'balanceBefore': 48, 'balanceAfter': 148, 'reason': 'x'})).status_code == 403


def test_tenant_isolation(pilot_env):
    client, sessions, headers, _, _ = pilot_env
    other_sub = str(uuid4())
    with sessions.begin() as db:
        db.add(Business(id='biz-b', name='Other Chop Bar'))
        db.add(Location(id='loc-b', business_id='biz-b', name='Osu'))
        db.add(Terminal(id='term-b', business_id='biz-b', location_id='loc-b', name='OB-01'))
        db.add(User(id='cashier-b', business_id='biz-b', location_id='loc-b', name='B Cashier', email='b@other.test', role='CASHIER', supabase_user_id=other_sub))
    other = {'Authorization': 'Bearer ' + token_for(other_sub)}
    # Adonai has a real sale in the cloud.
    cashier = me(client, headers['cashier'])
    shift_id, _ = open_shift(client, headers['cashier'], cashier)
    assert sync(client, headers['cashier'], sale(cashier, 'CASH', shift_id)).status_code == 200
    snapshot = client.get('/api/v1/admin/snapshot', headers=other).json()
    assert snapshot['orders'] == [] and all(e['businessId'] == 'biz-b' for e in snapshot['events'])
    b_user = me(client, other)
    assert b_user['businessId'] == 'biz-b'
    # Changing IDs in the request does not cross the tenant boundary.
    forged = sale({**b_user}, 'CASH', None)
    forged['payload']['stock_movements'] = []
    forged['payload']['items'] = forged['payload']['items'][:1]
    forged['payload']['total_pesewas'] = 9000
    forged['payload'].update(amount_tendered=9000, change=0)
    assert sync(client, other, forged).status_code == 403
    assert push(client, other, {**op(b_user, 'customer', str(uuid4()), {'name': 'X'}), 'businessId': B, 'locationId': L}).status_code == 403
    assert client.get(f'/api/v1/menu/{B}', headers=other).status_code == 403
    assert client.get(f'/api/v1/settings?deviceId={T}', headers=other).status_code == 403
    assert client.get('/api/v1/team', headers=other).status_code == 403


def test_menu_catalog_is_served_by_backend(pilot_env):
    client, _, headers, _, _ = pilot_env
    events = client.get('/api/v1/admin/snapshot', headers=headers['cashier']).json()['events']
    categories = {e['data']['name'] for e in events if e['kind'] == 'category'}
    menu = {e['data']['name']: e['data'] for e in events if e['kind'] == 'menu'}
    assert categories == {'Pork', 'Yam', 'Drinks'}
    assert set(menu) == {'Pork + Yam', 'Fried Yam', 'Coke', 'Malt', 'Water'}
    assert [v['name'] for v in menu['Pork + Yam']['variations']] == ['Small', 'Medium', 'Large']
    assert all(menu[d]['trackStock'] for d in ('Coke', 'Malt', 'Water'))
    opening = [e for e in events if e['kind'] == 'stock' and e['data']['type'] == 'OPENING_STOCK']
    assert len(opening) == 3 and all(e['data']['balanceAfter'] == 48 for e in opening)


def test_cashier_shift_cash_and_momo_sales_inventory_audit_and_close(pilot_env):
    client, sessions, headers, _, _ = pilot_env
    h = headers['cashier']
    cashier = me(client, h)
    shift_id, shift = open_shift(client, h, cashier)
    # Cash sale: tender 120.00 for 102.00, change 18.00.
    cash = sale(cashier, 'CASH', shift_id, 48, tender=12000)
    response = sync(client, h, cash)
    assert response.status_code == 200 and response.json()['status'] == 'accepted', response.text
    order_id = cash['entity_id']
    for event in (op(cashier, 'payment', order_id, {'orderId': order_id, 'amount': 10200, 'paymentMethod': 'CASH', 'amountTendered': 12000, 'change': 1800}),
                  op(cashier, 'workflow', order_id, {'orderId': order_id, 'status': 'COMPLETED'}),
                  op(cashier, 'system', str(uuid4()), {'orderId': order_id, 'message': 'Sale recorded'}, 'SALE_CREATED')):
        assert push(client, h, event).status_code == 200
    assert coke_stock(sessions) == 47
    # MoMo sale.
    momo = sale(cashier, 'MOMO', shift_id, 47)
    assert sync(client, h, momo).status_code == 200
    assert coke_stock(sessions) == 46
    # Sales are visible to the cashier (own) and to the admin (all).
    assert {o['id'] for o in client.get('/api/v1/admin/snapshot', headers=h).json()['orders']} == {order_id, momo['entity_id']}
    admin_orders = client.get('/api/v1/admin/snapshot', headers=headers['admin']).json()['orders']
    assert {o['paymentMethod'] for o in admin_orders} == {'CASH', 'MOMO'}
    assert next(o for o in admin_orders if o['id'] == order_id)['change'] == 1800
    # Audit trail: sale journal event attributed to the cashier.
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(AdminEvent).where(AdminEvent.kind == 'system', AdminEvent.actor_id == cashier['id'])) == 1
    # Close own shift; expected cash covers only the cash sale.
    expected = shift['openingCash'] + 10200
    closed = {**shift, 'status': 'CLOSED', 'closedAt': datetime.now(timezone.utc).isoformat(), 'countedCash': expected, 'expectedCash': expected, 'variance': 0, 'notes': ''}
    assert push(client, h, op(cashier, 'shift', shift_id, closed, 'SHIFT_CLOSED', 1)).status_code == 200
    assert push(client, h, op(cashier, 'shift', shift_id, closed, 'SHIFT_CLOSED', 2)).status_code == 409


def test_duplicate_sync_retry_is_idempotent(pilot_env):
    client, sessions, headers, _, _ = pilot_env
    h = headers['cashier']
    cashier = me(client, h)
    shift_id, _ = open_shift(client, h, cashier)
    body = sale(cashier, 'CASH', shift_id)
    statuses = [sync(client, h, body).json()['status'] for _ in range(3)]
    assert statuses == ['accepted', 'already_processed', 'already_processed']
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(Order)) == 1
        assert db.scalar(select(func.count()).select_from(SyncEvent)) == 1
    assert coke_stock(sessions) == 47
    # Same journal event re-sent (e.g. ACK lost) is acknowledged, not re-applied.
    movement = body['payload']['stock_movements'][0]
    assert push(client, h, movement).json()['status'] == 'already_processed'
    assert coke_stock(sessions) == 47


def test_settings_change_writes_security_audit(pilot_env):
    client, sessions, headers, _, _ = pilot_env
    receipts = next(s for s in client.get('/api/v1/settings', headers=headers['admin']).json()['sections'] if s['section'] == 'receipts')
    assert client.put('/api/v1/settings/receipts', headers=headers['admin'], json={'revision': receipts['revision'], 'values': {**receipts['values'], 'paperWidth': 58}}).status_code == 200
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(SecurityAudit).where(SecurityAudit.action == 'RECEIPT_SETTINGS_CHANGED')) == 1
