"""Provision the Adonai Pork — Dansoman TEST/PILOT tenant.

Idempotent: re-running never duplicates tenants, users, catalog, stock or
settings, and never rotates passwords unless --reset-passwords is given.
Login identities live in Supabase Auth and need SUPABASE_SERVICE_ROLE_KEY
(server-side only). Without it, the tenant, catalog and unlinked local users
are still created, and a later run links the identities.

    MAKNAM_ENV_FILE=.env.pilot python -m app.seed_pilot
"""
from __future__ import annotations

import argparse
import json
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import NAMESPACE_URL, uuid5

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.access import ensure_access
from app.core.config import settings
from app.db.session import SessionLocal
from app.models.access import ScopedSetting
from app.models.admin import AdminRecord, User
from app.models.models import Business, Location, Terminal
from app.schemas.admin import Operation
from app.schemas.settings import SECTIONS
from app.services.admin_service import apply_operation
from app.seed_demo_accounts import SupabaseAdmin, DemoSeedError as PilotSeedError


def pilot_id(name: str) -> str:
    return str(uuid5(NAMESPACE_URL, f'maknam-pilot:adonai:{name}'))


BUSINESS_ID = pilot_id('business')
LOCATION_ID = pilot_id('location:dansoman')
TERMINAL_ID = pilot_id('terminal:ad-01')
BUSINESS_NAME = 'Adonai Pork'
LOCATION_NAME = 'Dansoman'
TERMINAL_NAME = 'AD-01'
MARKER = 'maknam_pilot_account'
OPENING_DRINK_STOCK = 48

CATEGORIES = (('pork', 'Pork'), ('yam', 'Yam'), ('drinks', 'Drinks'))
# Prices in pesewas (GHS minor units).
MENU = (
    {'key': 'pork-yam', 'name': 'Pork + Yam', 'category': 'pork', 'variations': (('Small', 6000), ('Medium', 9000), ('Large', 13000))},
    {'key': 'fried-yam', 'name': 'Fried Yam', 'category': 'yam', 'variations': (('Small', 2000), ('Medium', 3000), ('Large', 4000))},
    {'key': 'coke', 'name': 'Coke', 'category': 'drinks', 'price': 1200, 'track': True},
    {'key': 'malt', 'name': 'Malt', 'category': 'drinks', 'price': 1500, 'track': True},
    {'key': 'water', 'name': 'Water', 'category': 'drinks', 'price': 500, 'track': True},
)
SETTINGS = {
    'general': ('BUSINESS', BUSINESS_ID, {'businessName': BUSINESS_NAME, 'businessType': 'Food Vendor (PILOT)', 'currency': 'GHS', 'timezone': 'Africa/Accra'}),
    'location': ('LOCATION', LOCATION_ID, {'name': LOCATION_NAME, 'address': 'Dansoman, Accra'}),
    'payments': ('BUSINESS', BUSINESS_ID, {'cash': True, 'momo': True, 'card': False, 'defaultMethod': 'CASH'}),
    'receipts': ('BUSINESS', BUSINESS_ID, {'paperWidth': 80, 'footer': 'PILOT TEST RECEIPT - not for real financial transactions.'}),
    'pos': ('BUSINESS', BUSINESS_ID, {}),
}


@dataclass
class Identity:
    key: str
    email: str
    name: str
    role: str
    password: str


@dataclass
class PilotSeedResult:
    created: list[str] = field(default_factory=list)
    unchanged: list[str] = field(default_factory=list)
    credentials: dict[str, dict[str, str]] = field(default_factory=dict)
    unlinked: list[str] = field(default_factory=list)


def identities() -> tuple[Identity, Identity]:
    return (
        Identity('admin', settings.pilot_admin_email.strip().lower(), 'Adonai Admin', 'ADMIN', settings.pilot_admin_password),
        Identity('cashier', settings.pilot_cashier_email.strip().lower(), 'Adonai Cashier', 'CASHIER', settings.pilot_cashier_password),
    )


def _ensure(db: Session, model, record_id: str, values: dict, result: PilotSeedResult):
    record = db.get(model, record_id)
    if record is None:
        db.add(model(id=record_id, **values))
        db.flush()
        result.created.append(f'{model.__tablename__}:{values.get("name")}')
    elif any(getattr(record, key) != value for key, value in values.items() if key != 'name'):
        raise PilotSeedError(f'Pilot identifier collision in {model.__tablename__}; existing data left unchanged.')
    else:
        result.unchanged.append(f'{model.__tablename__}:{record.name}')


def ensure_tenant(db: Session, result: PilotSeedResult):
    _ensure(db, Business, BUSINESS_ID, {'name': BUSINESS_NAME}, result)
    _ensure(db, Location, LOCATION_ID, {'business_id': BUSINESS_ID, 'name': LOCATION_NAME}, result)
    _ensure(db, Terminal, TERMINAL_ID, {'business_id': BUSINESS_ID, 'location_id': LOCATION_ID, 'name': TERMINAL_NAME}, result)
    db.commit()


def _auth_identity(admin: SupabaseAdmin, spec: Identity, reset: bool, adopt: bool, result: PilotSeedResult) -> str:
    matches = [u for u in admin.list_users() if (u.get('email') or '').lower() == spec.email]
    if len(matches) > 1:
        raise PilotSeedError(f'Multiple Supabase identities use {spec.email}.')
    if not matches:
        password = spec.password or secrets.token_urlsafe(18)
        response = admin.client.post('/admin/users', json={
            'email': spec.email, 'password': password, 'email_confirm': True,
            'app_metadata': {MARKER: spec.key}, 'user_metadata': {'display_name': spec.name, 'is_pilot': True},
        })
        admin._check(response)
        result.credentials[spec.key] = {'email': spec.email, 'password': password}
        return response.json()['id']
    user = matches[0]
    if (user.get('app_metadata') or {}).get(MARKER) != spec.key and not adopt:
        raise PilotSeedError(f'{spec.email} already exists in Supabase Auth without the pilot marker; re-run with --adopt-existing-auth-users to link it.')
    if reset:
        password = spec.password or secrets.token_urlsafe(18)
        admin.reset_password(user['id'], password)
        result.credentials[spec.key] = {'email': spec.email, 'password': password}
    return user['id']


def ensure_user(db: Session, spec: Identity, subject: str | None, result: PilotSeedResult) -> User:
    user = db.scalar(select(User).where(User.email == spec.email))
    if subject:
        linked = db.scalar(select(User).where(User.supabase_user_id == subject))
        if linked is not None and linked is not user:
            raise PilotSeedError(f'The Supabase identity for {spec.email} is linked to another account.')
    if user is None:
        user = User(business_id=BUSINESS_ID, location_id=LOCATION_ID, name=spec.name, email=spec.email, supabase_user_id=subject, password_hash=None, role=spec.role, active=True)
        db.add(user)
        db.flush()
        result.created.append(f'user:{spec.email}')
    elif user.business_id != BUSINESS_ID or user.location_id != LOCATION_ID or user.role != spec.role:
        raise PilotSeedError(f'{spec.email} exists outside the pilot tenant or with a different role; left unchanged.')
    elif user.supabase_user_id not in (None, subject) and subject:
        raise PilotSeedError(f'{spec.email} is linked to a different Supabase identity; left unchanged.')
    else:
        if subject and user.supabase_user_id is None:
            user.supabase_user_id = subject
            result.created.append(f'link:{spec.email}')
        else:
            result.unchanged.append(f'user:{spec.email}')
    db.commit()
    ensure_access(db, user)
    if user.supabase_user_id is None:
        result.unlinked.append(spec.email)
    return user


def _apply(db: Session, admin: User, kind: str, entity_id: str, data: dict[str, Any], result: PilotSeedResult, label: str):
    if db.get(AdminRecord, f'{BUSINESS_ID}:{LOCATION_ID}:{kind}:{entity_id}') is not None:
        result.unchanged.append(label)
        return
    operation = Operation.model_validate({
        'id': pilot_id(f'event:{kind}:{entity_id}'), 'businessId': BUSINESS_ID, 'locationId': LOCATION_ID,
        'actorId': admin.id, 'entityId': entity_id, 'kind': kind, 'action': 'CREATED', 'baseVersion': 0,
        'occurredAt': datetime.now(timezone.utc), 'data': data,
    })
    try:
        apply_operation(db, admin, operation)
    except HTTPException as error:
        db.rollback()
        raise PilotSeedError(f'Could not seed {label}: {error.detail}') from error
    result.created.append(label)


def ensure_catalog(db: Session, admin: User, result: PilotSeedResult):
    for position, (key, name) in enumerate(CATEGORIES):
        _apply(db, admin, 'category', pilot_id(f'category:{key}'), {'name': name, 'position': position, 'active': True}, result, f'category:{name}')
    for item in MENU:
        category_id = pilot_id(f'category:{item["category"]}')
        base = {'name': item['name'], 'categoryId': category_id, 'description': '', 'image': '', 'requiresKitchen': False, 'active': True, 'isAvailable': True}
        if 'variations' in item:
            variations = [{'id': pilot_id(f'variation:{item["key"]}:{name.lower()}'), 'name': name, 'pricePesewas': price} for name, price in item['variations']]
            data = {**base, 'pricingType': 'VARIATIONS', 'variations': variations, 'pricePesewas': min(v['pricePesewas'] for v in variations), 'trackStock': False, 'stockUnit': 'Portion', 'lowStockLevel': 0}
        else:
            data = {**base, 'pricingType': 'SINGLE', 'variations': [], 'pricePesewas': item['price'], 'trackStock': item.get('track', False), 'stockUnit': 'Bottle', 'lowStockLevel': 6}
        menu_id = pilot_id(f'menu:{item["key"]}')
        _apply(db, admin, 'menu', menu_id, data, result, f'menu:{item["name"]}')
        if data['trackStock']:
            _apply(db, admin, 'stock', pilot_id(f'stock:opening:{item["key"]}'), {
                'menuItemId': menu_id, 'type': 'OPENING_STOCK', 'quantityDelta': OPENING_DRINK_STOCK,
                'balanceBefore': 0, 'balanceAfter': OPENING_DRINK_STOCK, 'referenceId': None, 'reason': 'Pilot opening stock',
            }, result, f'opening-stock:{item["name"]}')


def ensure_settings(db: Session, admin: User, result: PilotSeedResult):
    for section, (scope, scope_id, values) in SETTINGS.items():
        key = f'{BUSINESS_ID}:{scope}:{scope_id}:{section}'
        if db.get(ScopedSetting, key) is not None:
            result.unchanged.append(f'settings:{section}')
            continue
        validated = SECTIONS[section].model_validate(values).model_dump()
        db.add(ScopedSetting(key=key, business_id=BUSINESS_ID, scope=scope, scope_id=scope_id, section=section, revision=1, values=validated, updated_by=admin.id))
        result.created.append(f'settings:{section}')
    db.commit()


def seed_pilot(db: Session, auth: SupabaseAdmin | None, reset_passwords: bool = False, adopt_existing: bool = False) -> PilotSeedResult:
    if settings.environment == 'production':
        raise PilotSeedError('The pilot tenant must not be seeded into production.')
    result = PilotSeedResult()
    ensure_tenant(db, result)
    users = {}
    for spec in identities():
        if '@' not in spec.email:
            raise PilotSeedError(f'Invalid pilot email for {spec.key}.')
        subject = _auth_identity(auth, spec, reset_passwords, adopt_existing, result) if auth else None
        users[spec.key] = ensure_user(db, spec, subject, result)
    ensure_settings(db, users['admin'], result)
    ensure_catalog(db, users['admin'], result)
    return result


def main():
    parser = argparse.ArgumentParser(description='Provision the Adonai Pork (Dansoman) TEST/PILOT tenant.')
    parser.add_argument('--reset-passwords', action='store_true', help='Rotate both pilot passwords and print them once.')
    parser.add_argument('--adopt-existing-auth-users', action='store_true', help='Link pre-existing Supabase Auth users with the pilot emails.')
    args = parser.parse_args()
    auth = None
    try:
        if settings.supabase_service_role_key:
            auth = SupabaseAdmin(settings.supabase_url, settings.supabase_service_role_key)
        with SessionLocal() as db:
            result = seed_pilot(db, auth, args.reset_passwords, args.adopt_existing_auth_users)
    except PilotSeedError as error:
        raise SystemExit(f'Pilot seed stopped: {error}') from error
    finally:
        if auth:
            auth.close()
    report: dict[str, Any] = {'tenant': f'{BUSINESS_NAME} - {LOCATION_NAME} (PILOT)', 'environment': settings.environment, 'created': result.created, 'unchanged_count': len(result.unchanged)}
    if result.unlinked:
        report['unlinked_logins'] = result.unlinked
        report['action_required'] = 'Set SUPABASE_SERVICE_ROLE_KEY in .env.pilot and re-run to create the login identities.'
    if result.credentials:
        report['credentials'] = result.credentials
        report['credential_notice'] = 'Shown once. Store in a password manager; do not commit or paste into docs in Git.'
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
