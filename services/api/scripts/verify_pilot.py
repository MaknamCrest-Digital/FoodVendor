"""Read-only TEST/PILOT database verification. Prints no credentials or hosts.

    cd services/api
    MAKNAM_ENV_FILE=.env.pilot python scripts/verify_pilot.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from alembic.config import Config  # noqa: E402
from alembic.script import ScriptDirectory  # noqa: E402
from sqlalchemy import inspect, select, text  # noqa: E402

import app.main  # noqa: E402,F401  registers every model
from app import seed_pilot as pilot  # noqa: E402
from app.core.access import effective_permissions  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.db.session import Base, SessionLocal, engine  # noqa: E402
from app.models.access import ScopedSetting  # noqa: E402
from app.models.admin import AdminRecord, User  # noqa: E402
from app.models.models import Business, Location, Terminal  # noqa: E402

results: list[tuple[bool, str, str]] = []


def check(ok: bool, name: str, detail: str = ''):
    results.append((bool(ok), name, detail))


def main() -> int:
    print(f'Maknam POS pilot verification  (environment: {settings.environment}, database: {engine.dialect.name})')
    try:
        with engine.connect() as connection:
            connection.execute(text('select 1'))
            check(True, 'Database connection')
            head = ScriptDirectory.from_config(Config(str(Path(__file__).resolve().parents[1] / 'alembic.ini'))).get_current_head()
            current = connection.execute(text('select version_num from alembic_version')).scalar()
            check(current == head, 'Migration version', f'{current} (head {head})')
            tables = set(inspect(connection).get_table_names())
            missing = set(Base.metadata.tables) - tables
            check(not missing, 'Required tables', f'{len(Base.metadata.tables) - len(missing)}/{len(Base.metadata.tables)}' + (f' missing {sorted(missing)}' if missing else ''))
            if engine.dialect.name == 'postgresql':
                exposed = connection.execute(text("""select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='public' and c.relkind='r' and (not c.relrowsecurity
                    or exists(select 1 from pg_roles r where r.rolname in ('anon','authenticated') and (has_table_privilege(r.oid,c.oid,'SELECT') or has_table_privilege(r.oid,c.oid,'INSERT'))))""")).scalar()
                check(exposed == 0, 'Supabase REST lockdown (RLS on, no anon/authenticated grants)', f'{exposed} exposed tables')
    except Exception as error:
        check(False, 'Database connection', type(error).__name__)
        return report()

    with SessionLocal() as db:
        business, location, terminal = db.get(Business, pilot.BUSINESS_ID), db.get(Location, pilot.LOCATION_ID), db.get(Terminal, pilot.TERMINAL_ID)
        check(business is not None, 'Pilot business', business.name if business else 'missing')
        check(location is not None and location.business_id == pilot.BUSINESS_ID, 'Pilot location', location.name if location else 'missing')
        check(terminal is not None and terminal.location_id == pilot.LOCATION_ID, 'Pilot terminal', terminal.name if terminal else 'missing')
        for spec, required in ((pilot.identities()[0], 'roles.manage'), (pilot.identities()[1], 'pos.sale.create')):
            user = db.scalar(select(User).where(User.email == spec.email))
            if user is None:
                check(False, f'{spec.key.title()} user', f'{spec.email} missing')
                continue
            scoped = user.business_id == pilot.BUSINESS_ID and user.location_id == pilot.LOCATION_ID and user.active
            check(scoped and user.role == spec.role and required in effective_permissions(db, user), f'{spec.key.title()} user', f'{spec.email} role={user.role}')
            check(user.supabase_user_id is not None, f'{spec.key.title()} login linked to Supabase Auth', 'linked' if user.supabase_user_id else 'NOT linked - set SUPABASE_SERVICE_ROLE_KEY and re-run seed')
        cashier = db.scalar(select(User).where(User.email == pilot.identities()[1].email))
        if cashier:
            forbidden = {'team.view', 'roles.manage', 'settings.general', 'audit.view'} & effective_permissions(db, cashier)
            check(not forbidden, 'Cashier restrictions', ', '.join(sorted(forbidden)) or 'no admin permissions')
        records = db.scalars(select(AdminRecord).where(AdminRecord.business_id == pilot.BUSINESS_ID, AdminRecord.location_id == pilot.LOCATION_ID)).all()
        names = lambda kind: sorted(r.data['name'] for r in records if r.kind == kind)  # noqa: E731
        check({'Pork', 'Yam', 'Drinks'} <= set(names('category')), 'Categories', ', '.join(names('category')))
        check({'Pork + Yam', 'Fried Yam', 'Coke', 'Malt', 'Water'} <= set(names('menu')), 'Menu items', ', '.join(names('menu')))
        stock = {}
        for r in records:
            if r.kind == 'stock':
                stock[r.data['menuItemId']] = stock.get(r.data['menuItemId'], 0) + r.data['quantityDelta']
        tracked = {r.entity_id: r.data['name'] for r in records if r.kind == 'menu' and r.data.get('trackStock')}
        check(set(tracked) and all(i in stock for i in tracked), 'Drink inventory', ', '.join(f'{tracked[i]}={stock.get(i, 0)}' for i in tracked))
        general = db.get(ScopedSetting, f'{pilot.BUSINESS_ID}:BUSINESS:{pilot.BUSINESS_ID}:general')
        values = general.values if general else {}
        check(values.get('currency') == 'GHS' and values.get('timezone') == 'Africa/Accra', 'Business settings', f"currency={values.get('currency')} timezone={values.get('timezone')}")
    return report()


def report() -> int:
    width = max(len(name) for _, name, _ in results)
    for ok, name, detail in results:
        print(f"  [{'PASS' if ok else 'FAIL'}] {name.ljust(width)}  {detail}")
    failed = sum(not ok for ok, _, _ in results)
    print(f'\n{len(results) - failed} passed, {failed} failed')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
