from __future__ import annotations

import argparse
import json
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import NAMESPACE_URL, uuid5

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.access import ensure_access
from app.core.config import settings
from app.db.session import SessionLocal
from app.models.access import Role, UserRole
from app.models.admin import AdminEvent, AdminRecord, User
from app.models.models import Business, Location, Terminal

DEMO_BUSINESS_ID = '96df9f2f-48c2-5e77-8f6c-0fbfa6f3ce31'
DEMO_LOCATION_ID = '1a3638dc-ff71-55a0-ae51-c0b28b233249'
DEMO_TERMINAL_ID = '284ef671-9786-54df-bc42-72a4d1708d06'
DEMO_EMAIL_DOMAIN = 'demo.maknam.invalid'
DEMO_IDENTITIES = (
    {'username': 'demo-admin', 'email': f'demo-admin@{DEMO_EMAIL_DOMAIN}', 'name': 'Demo Admin', 'role': 'ADMIN'},
    {'username': 'demo-cashier', 'email': f'demo-cashier@{DEMO_EMAIL_DOMAIN}', 'name': 'Demo Cashier', 'role': 'CASHIER'},
)


class DemoSeedError(RuntimeError):
    pass


class SupabaseAdmin:
    def __init__(self, project_url: str, service_role_key: str):
        if not project_url or not service_role_key:
            raise DemoSeedError('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
        self.client = httpx.Client(
            base_url=f'{project_url.rstrip("/")}/auth/v1',
            headers={'apikey': service_role_key, 'Authorization': f'Bearer {service_role_key}'},
            timeout=20,
        )

    def close(self):
        self.client.close()

    def list_users(self) -> list[dict[str, Any]]:
        users: list[dict[str, Any]] = []
        page = 1
        while True:
            response = self.client.get('/admin/users', params={'page': page, 'per_page': 1000})
            self._check(response)
            body = response.json()
            page_users = body.get('users', [])
            users.extend(page_users)
            if len(page_users) < 1000:
                return users
            page += 1

    def create_user(self, email: str, password: str, username: str) -> dict[str, Any]:
        response = self.client.post('/admin/users', json={
            'email': email,
            'password': password,
            'email_confirm': True,
            'app_metadata': {'maknam_demo_account': username},
            'user_metadata': {'display_name': username, 'is_demo': True},
        })
        self._check(response)
        return response.json()

    def reset_password(self, user_id: str, password: str):
        response = self.client.put(f'/admin/users/{user_id}', json={'password': password})
        self._check(response)

    @staticmethod
    def _check(response: httpx.Response):
        if response.is_error:
            detail = 'Supabase Auth provisioning request failed.'
            try:
                message = response.json().get('msg') or response.json().get('message')
                if message:
                    detail = f'Supabase Auth provisioning failed: {message}'
            except (ValueError, AttributeError):
                pass
            raise DemoSeedError(detail)


@dataclass
class SeedResult:
    credentials: dict[str, dict[str, str]]
    created: list[str]
    unchanged: list[str]


def _ensure_demo_tenant(db: Session):
    expected = (
        (Business, DEMO_BUSINESS_ID, {'name': 'Maknam POS Demo (Fictional)'}),
        (Location, DEMO_LOCATION_ID, {'business_id': DEMO_BUSINESS_ID, 'name': 'Demo Branch'}),
        (Terminal, DEMO_TERMINAL_ID, {'business_id': DEMO_BUSINESS_ID, 'location_id': DEMO_LOCATION_ID, 'name': 'DEMO-01'}),
    )
    for model, record_id, values in expected:
        record = db.get(model, record_id)
        if record is None:
            db.add(model(id=record_id, **values))
            db.flush()
        elif any(getattr(record, key) != value for key, value in values.items()):
            raise DemoSeedError(f'Demo tenant identifier collision for {model.__tablename__}; existing data was left unchanged.')
    db.commit()


def _remote_user(admin: SupabaseAdmin, spec: dict[str, str]) -> dict[str, Any] | None:
    matches = [user for user in admin.list_users() if (user.get('email') or '').lower() == spec['email']]
    if len(matches) > 1:
        raise DemoSeedError(f'Multiple Supabase identities use the reserved demo address {spec["email"]}.')
    if not matches:
        return None
    user = matches[0]
    marker = (user.get('app_metadata') or {}).get('maknam_demo_account')
    if marker != spec['username']:
        raise DemoSeedError(f'The reserved address {spec["email"]} belongs to an unmarked Supabase user; refusing to adopt it.')
    return user


def _ensure_identity(admin: SupabaseAdmin, spec: dict[str, str], reset_passwords: bool):
    user = _remote_user(admin, spec)
    if user is None:
        password = secrets.token_urlsafe(24)
        user = admin.create_user(spec['email'], password, spec['username'])
        return user['id'], password, True
    if reset_passwords:
        password = secrets.token_urlsafe(24)
        admin.reset_password(user['id'], password)
        return user['id'], password, True
    return user['id'], None, False


def _ensure_local_user(db: Session, spec: dict[str, str], subject: str) -> User:
    by_email = db.scalar(select(User).where(User.email == spec['email']))
    by_subject = db.scalar(select(User).where(User.supabase_user_id == subject))
    if by_subject is not None and by_subject is not by_email:
        raise DemoSeedError(f'Supabase identity for {spec["username"]} is linked to another local account.')
    user = by_email or by_subject
    if user is None:
        user = User(
            business_id=DEMO_BUSINESS_ID,
            location_id=DEMO_LOCATION_ID,
            name=spec['name'],
            email=spec['email'],
            supabase_user_id=subject,
            password_hash=None,
            role=spec['role'],
            active=True,
        )
        db.add(user)
        db.flush()
    elif user.business_id != DEMO_BUSINESS_ID or user.location_id != DEMO_LOCATION_ID or user.role != spec['role']:
        raise DemoSeedError(f'Existing local account {spec["username"]} is outside the isolated demo tenant or has a different role.')
    elif user.supabase_user_id not in (None, subject):
        raise DemoSeedError(f'Existing local account {spec["username"]} is linked to a different Supabase identity.')
    else:
        user.supabase_user_id = subject
    db.commit()
    ensure_access(db, user)
    return user


def _catalog_operation(admin_user: User, kind: str, entity_id: str, data: dict[str, Any]):
    return {
        'id': str(uuid5(NAMESPACE_URL, f'maknam-demo:{kind}:{entity_id}')),
        'businessId': DEMO_BUSINESS_ID,
        'locationId': DEMO_LOCATION_ID,
        'actorId': admin_user.id,
        'entityId': entity_id,
        'kind': kind,
        'action': 'CREATED',
        'baseVersion': 0,
        'occurredAt': datetime.now(timezone.utc),
        'data': data,
    }


def _seed_demo_catalog(db: Session, admin_user: User):
    from app.schemas.admin import Operation
    from app.services.admin_service import apply_operation

    category_id = str(uuid5(NAMESPACE_URL, 'maknam-demo:category:favorites'))
    category_key = f'{DEMO_BUSINESS_ID}:{DEMO_LOCATION_ID}:category:{category_id}'
    if db.get(AdminRecord, category_key) is None:
        try:
            apply_operation(db, admin_user, Operation.model_validate(_catalog_operation(admin_user, 'category', category_id, {
                'name': 'Demo Favorites', 'position': 0, 'active': True,
            })))
        except HTTPException as error:
            raise DemoSeedError(f'Could not create the fictional demo category: {error.detail}') from error

    items = (
        ('Demo Jollof Bowl', 4500, 'A fictional sample meal for POS practice.'),
        ('Demo Grilled Pork Plate', 8500, 'A fictional sample meal for POS practice.'),
        ('Demo Sobolo', 1200, 'A fictional sample drink for POS practice.'),
    )
    for name, price, description in items:
        item_id = str(uuid5(NAMESPACE_URL, f'maknam-demo:menu:{name}'))
        record_key = f'{DEMO_BUSINESS_ID}:{DEMO_LOCATION_ID}:menu:{item_id}'
        if db.get(AdminRecord, record_key) is not None:
            continue
        data = {
            'name': name, 'category': 'Demo Favorites', 'categoryId': category_id,
            'description': description, 'image': '', 'pricingType': 'SINGLE',
            'variations': [], 'pricePesewas': price, 'requiresKitchen': False,
            'active': True, 'isAvailable': True, 'trackStock': False,
            'stockUnit': 'Portion', 'lowStockLevel': 0,
        }
        try:
            apply_operation(db, admin_user, Operation.model_validate(_catalog_operation(admin_user, 'menu', item_id, data)))
        except HTTPException as error:
            raise DemoSeedError(f'Could not create fictional demo product {name}: {error.detail}') from error


def seed_demo_accounts(db: Session, admin: SupabaseAdmin, reset_passwords: bool = False) -> SeedResult:
    _ensure_demo_tenant(db)
    credentials: dict[str, dict[str, str]] = {}
    created: list[str] = []
    unchanged: list[str] = []
    admin_user: User | None = None

    for spec in DEMO_IDENTITIES:
        existing = db.scalar(select(User).where(User.email == spec['email']))
        if existing is not None and (existing.business_id != DEMO_BUSINESS_ID or existing.location_id != DEMO_LOCATION_ID or existing.role != spec['role']):
            raise DemoSeedError(f'Existing local account {spec["username"]} is outside the isolated demo tenant or has a different role.')
        subject, password, changed = _ensure_identity(admin, spec, reset_passwords)
        user = _ensure_local_user(db, spec, subject)
        if password is not None:
            credentials[spec['username']] = {'email': spec['email'], 'password': password}
        (created if changed else unchanged).append(spec['username'])
        if spec['username'] == 'demo-admin':
            admin_user = user

    if admin_user is None:
        raise DemoSeedError('Demo administrator could not be provisioned.')
    _seed_demo_catalog(db, admin_user)
    return SeedResult(credentials=credentials, created=created, unchanged=unchanged)


def main():
    parser = argparse.ArgumentParser(description='Provision isolated Maknam POS demo accounts and fictional POS products.')
    parser.add_argument('--reset-passwords', action='store_true', help='Explicitly rotate both demo passwords and print the new credentials once.')
    args = parser.parse_args()
    if not settings.demo_seed_enabled:
        raise SystemExit('Demo seeding is disabled. Set DEMO_SEED_ENABLED=true for this controlled operation.')
    try:
        admin = SupabaseAdmin(settings.supabase_url, settings.supabase_service_role_key)
        try:
            with SessionLocal() as db:
                result = seed_demo_accounts(db, admin, reset_passwords=args.reset_passwords)
        finally:
            admin.close()
    except DemoSeedError as error:
        raise SystemExit(str(error)) from error

    report = {'tenant': 'Maknam POS Demo (Fictional)', 'created_or_rotated': result.created, 'unchanged': result.unchanged}
    if result.credentials:
        report['credentials'] = result.credentials
        report['credential_notice'] = 'Store these generated credentials in a password manager now. They will not be shown again unless passwords are explicitly rotated.'
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
