from copy import deepcopy
from uuid import uuid4

from sqlalchemy import func, select

from app.models.access import Role, UserRole
from app.models.admin import AdminEvent, AdminRecord, User
from app.models.models import Business
from app.seed_demo_accounts import DEMO_BUSINESS_ID, DEMO_IDENTITIES, seed_demo_accounts
from app.core.access import effective_permissions
from test_auth import auth_client, token_for


class FakeSupabaseAdmin:
    def __init__(self):
        self.users=[]
        self.passwords={}

    def list_users(self):
        return deepcopy(self.users)

    def create_user(self,email,password,username):
        user={'id':str(uuid4()),'email':email,'app_metadata':{'maknam_demo_account':username}}
        self.users.append(user)
        self.passwords[user['id']]=password
        return deepcopy(user)

    def reset_password(self,user_id,password):
        self.passwords[user_id]=password


def test_seed_demo_accounts_is_idempotent_and_keeps_fictional_catalog(auth_client):
    _,sessions=auth_client
    admin=FakeSupabaseAdmin()
    with sessions() as db:
        first=seed_demo_accounts(db,admin)
    assert set(first.credentials)=={'demo-admin','demo-cashier'}
    assert first.created==['demo-admin','demo-cashier']
    assert all(len(value['password'])>=32 for value in first.credentials.values())
    assert len(admin.users)==2

    with sessions() as db:
        second=seed_demo_accounts(db,admin)
        assert second.credentials=={}
        assert second.created==[]
        assert second.unchanged==['demo-admin','demo-cashier']
        assert db.scalar(select(func.count()).select_from(User).where(User.business_id==DEMO_BUSINESS_ID))==2
        assert db.scalar(select(func.count()).select_from(AdminRecord).where(AdminRecord.business_id==DEMO_BUSINESS_ID))==4
        assert db.scalar(select(func.count()).select_from(AdminEvent).where(AdminEvent.business_id==DEMO_BUSINESS_ID))==4
        assert db.get(Business,DEMO_BUSINESS_ID).name=='Maknam POS Demo (Fictional)'


def test_demo_admin_and_cashier_are_scoped_to_demo_business_and_permissions(auth_client):
    client,sessions=auth_client
    admin=FakeSupabaseAdmin()
    with sessions() as db:
        result=seed_demo_accounts(db,admin)
        accounts={spec['username']:db.scalar(select(User).where(User.email==spec['email'])) for spec in DEMO_IDENTITIES}
        cashier=accounts['demo-cashier']
        cashier_role=db.get(Role,db.get(UserRole,cashier.id).role_id)
        assert cashier_role.template=='CASHIER'
        assert {'pos.view','pos.sale.create','sales.view_own'}<=effective_permissions(db,cashier)
        assert 'roles.manage' not in effective_permissions(db,cashier)
        assert 'team.create' not in effective_permissions(db,cashier)
        assert db.scalar(select(func.count()).select_from(User).where(User.business_id=='auth-business'))==1

    owner=accounts['demo-admin']
    owner_headers={'Authorization':'Bearer '+token_for(owner.supabase_user_id)}
    cashier_headers={'Authorization':'Bearer '+token_for(cashier.supabase_user_id)}
    admin_profile=client.get('/api/v1/auth/me',headers=owner_headers)
    cashier_profile=client.get('/api/v1/auth/me',headers=cashier_headers)
    assert admin_profile.status_code==cashier_profile.status_code==200
    assert admin_profile.json()['businessId']==cashier_profile.json()['businessId']==DEMO_BUSINESS_ID
    assert 'roles.manage' in admin_profile.json()['permissions']
    assert 'roles.manage' not in cashier_profile.json()['permissions']
    assert client.get('/api/v1/team',headers=cashier_headers).status_code==403

    foreign_event={'id':str(uuid4()),'businessId':'auth-business','locationId':'auth-location','actorId':owner.id,'entityId':str(uuid4()),'kind':'category','action':'CREATED','baseVersion':0,'occurredAt':'2026-10-04T00:00:00Z','data':{'name':'Not demo data','position':0,'active':True}}
    assert client.post('/api/v1/admin/events',headers={**owner_headers,'Idempotency-Key':foreign_event['id']},json=foreign_event).status_code==403


def test_existing_demo_password_is_not_rotated_without_explicit_request(auth_client):
    _,sessions=auth_client
    admin=FakeSupabaseAdmin()
    with sessions() as db:
        first=seed_demo_accounts(db,admin)
        previous={key:value['password'] for key,value in first.credentials.items()}
        second=seed_demo_accounts(db,admin)
        assert second.credentials=={}
        assert {name:admin.passwords[admin.users[index]['id']] for index,name in enumerate(('demo-admin','demo-cashier'))}==previous
        rotated=seed_demo_accounts(db,admin,reset_passwords=True)
        assert set(rotated.credentials)=={'demo-admin','demo-cashier'}
        assert all(rotated.credentials[name]['password']!=previous[name] for name in previous)
        assert len(admin.users)==2



def test_seed_does_not_reactivate_a_disabled_demo_user(auth_client):
    _,sessions=auth_client
    admin=FakeSupabaseAdmin()
    with sessions() as db:
        seed_demo_accounts(db,admin)
        cashier= db.scalar(select(User).where(User.email==DEMO_IDENTITIES[1]['email']))
        cashier.active=False
        db.commit()
        seed_demo_accounts(db,admin)
        assert db.scalar(select(User).where(User.id==cashier.id)).active is False
