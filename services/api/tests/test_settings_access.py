from uuid import uuid4
from sqlalchemy import select
from test_auth import auth_client,signin,PASSWORD,token_for
from app.models.models import Business,Location,Terminal
from app.models.admin import User
from app.models.access import SecurityAudit,ScopedSetting
from app.core.auth import hash_password

def auth(client):return {'Authorization':'Bearer '+signin(client).json()['token']}
def rows(client,headers):return {r['section']:r for r in client.get('/api/v1/settings',headers=headers).json()['sections']}
def change(client,headers,section,values,revision=0,**kwargs):return client.put('/api/v1/settings/'+section,headers=headers,json={'values':values,'revision':revision,**kwargs})
def cashier(client,headers):
    team=client.get('/api/v1/team',headers=headers).json()
    role=next(r for r in team['roles'] if r['template']=='CASHIER')
    identity='e2477bcb-13cd-4cb9-8999-30ce74471108'
    result=client.post('/api/v1/team',headers=headers,json={'name':'Cashier','email':'cashier@example.test','supabaseUserId':identity,'roleId':role['id']})
    assert result.status_code==200,result.text
    token=token_for(identity)
    assert client.get('/api/v1/auth/me',headers={'Authorization':'Bearer '+token}).status_code==200
    return {'Authorization':'Bearer '+token},result.json()['id'],role['id']

def test_defaults_currency_confirmation_revision_and_audit(auth_client):
    client,sessions=auth_client;headers=auth(client);settings=rows(client,headers)
    assert settings['general']['values']['currency']=='GHS'
    assert settings['pos']['values']['requireShift'] is True
    general={**settings['general']['values'],'currency':'USD'}
    assert change(client,headers,'general',general).status_code==409
    result=change(client,headers,'general',general,confirmCurrencyChange=True)
    assert result.status_code==200,result.text
    assert result.json()['revision']==1
    assert change(client,headers,'general',general).status_code==409
    with sessions() as db:
        assert len(db.scalars(select(SecurityAudit).where(SecurityAudit.action=='CURRENCY_CHANGED')).all())==1
        assert db.scalar(select(ScopedSetting)).scope=='BUSINESS'

def test_payment_methods_and_timezone_validation(auth_client):
    client,_=auth_client;headers=auth(client);settings=rows(client,headers)
    assert change(client,headers,'payments',{'cash':False,'momo':False,'card':False,'defaultMethod':'CASH'}).status_code==422
    assert change(client,headers,'payments',{'cash':False,'momo':True,'card':False,'defaultMethod':'CASH'}).status_code==422
    assert change(client,headers,'payments',{'cash':False,'momo':True,'card':False,'defaultMethod':'MOMO','requireMomoReference':True}).status_code==200
    assert change(client,headers,'general',{**settings['general']['values'],'timezone':'Not/AZone'}).status_code==422

def test_cashier_backend_forbidden_and_user_appearance_isolation(auth_client):
    client,_=auth_client;owner=auth(client);staff,_,_=cashier(client,owner)
    profile=client.get('/api/v1/auth/me',headers=staff).json()
    assert 'pos.sale.create' in profile['permissions']
    assert 'dashboard.sales_summary.view' not in profile['permissions']
    assert client.get('/api/v1/team',headers=staff).status_code==403
    assert change(client,staff,'payments',rows(client,staff)['payments']['values']).status_code==403
    assert change(client,staff,'appearance',{'theme':'DARK','density':'COMPACT'}).status_code==200
    assert rows(client,owner)['appearance']['values']['theme']=='SYSTEM'
    assert rows(client,staff)['appearance']['values']['theme']=='DARK'
    event={'id':str(uuid4()),'businessId':'auth-business','locationId':'auth-location','actorId':profile['id'],'entityId':str(uuid4()),'kind':'stock','action':'STOCK_ADJUSTMENT','baseVersion':0,'occurredAt':'2026-10-02T12:00:00Z','data':{'type':'ADJUSTMENT'}}
    assert client.post('/api/v1/admin/events',headers={**staff,'Idempotency-Key':event['id']},json=event).status_code==403

def test_existing_local_user_is_linked_by_explicit_supabase_uuid(auth_client):
    client,sessions=auth_client;owner=auth(client)
    identity='f001985b-c999-4fbf-a106-3816168847cc'
    with sessions.begin() as db:
        db.add(User(id='existing-unlinked',email='staff@example.test',name='Staff',role='CASHIER',business_id='auth-business',location_id='auth-location'))
    assert client.get('/api/v1/auth/me',headers={'Authorization':'Bearer '+token_for(identity,email='staff@example.test')}).status_code==401
    team=client.get('/api/v1/team',headers=owner).json()
    member=next(row for row in team['members'] if row['id']=='existing-unlinked')
    result=client.put('/api/v1/team/existing-unlinked',headers=owner,json={'name':member['name'],'roleId':member['roleId'],'active':True,'overrides':{},'supabaseUserId':identity})
    assert result.status_code==200,result.text
    profile=client.get('/api/v1/auth/me',headers={'Authorization':'Bearer '+token_for(identity,email='different@example.test')})
    assert profile.status_code==200
    assert profile.json()['id']=='existing-unlinked'
    with sessions() as db:assert db.get(User,'existing-unlinked').supabase_user_id==identity

def test_overrides_take_effect_and_final_owner_cannot_lose_access(auth_client):
    client,_=auth_client;owner=auth(client);staff,member_id,role_id=cashier(client,owner)
    updated=client.put('/api/v1/team/'+member_id,headers=owner,json={'name':'Cashier','roleId':role_id,'active':True,'overrides':{'menu.view':'ALLOW','pos.sale.create':'DENY'}})
    assert updated.status_code==200,updated.text
    permissions=client.get('/api/v1/auth/me',headers=staff).json()['permissions']
    assert 'menu.view' in permissions and 'pos.sale.create' not in permissions
    team=client.get('/api/v1/team',headers=owner).json();own=next(m for m in team['members'] if m['id']=='auth-owner')
    for changes in [{'active':False},{'roleId':role_id},{'overrides':{'roles.manage':'DENY'}}]:
        result=client.put('/api/v1/team/auth-owner',headers=owner,json={'name':'Owner','roleId':own['roleId'],'active':True,'overrides':{},**changes})
        assert result.status_code==409,result.text
    assert 'roles.manage' in client.get('/api/v1/auth/me',headers=owner).json()['permissions']

def test_second_tenant_settings_roles_users_and_devices_isolated(auth_client):
    client,sessions=auth_client;owner=auth(client)
    with sessions.begin() as db:
        db.add(Business(id='other-business',name='Other Restaurant'));db.add(Location(id='other-location',business_id='other-business',name='Other Branch'));db.add(Terminal(id='other-terminal',business_id='other-business',location_id='other-location',name='Other Tablet'));db.add(User(id='other-owner',supabase_user_id='46cb7b8e-1a87-4f84-a02e-42c7fdb51130',email='other@example.test',name='Other Owner',business_id='other-business',location_id='other-location',password_hash=hash_password(PASSWORD)))
    other={'Authorization':'Bearer '+token_for('46cb7b8e-1a87-4f84-a02e-42c7fdb51130')}
    general=rows(client,other)['general']['values'];assert general['businessName']=='Other Restaurant'
    assert change(client,other,'general',{**general,'currency':'EUR'},confirmCurrencyChange=True).status_code==200
    assert rows(client,owner)['general']['values']['currency']=='GHS'
    assert client.get('/api/v1/settings?deviceId=other-terminal',headers=owner).status_code==403
    foreign=client.get('/api/v1/team',headers=other).json()['roles'][0]
    assert client.put('/api/v1/team/roles/'+foreign['id'],headers=owner,json={'name':'Hijack','permissions':[]}).status_code==403
    assert client.put('/api/v1/team/other-owner',headers=owner,json={'name':'Hijack','roleId':foreign['id']}).status_code==403

def test_account_updates_display_name_without_handling_auth_credentials(auth_client):
    client,_=auth_client;first=auth(client);second=auth(client)
    result=client.put('/api/v1/auth/account',headers=first,json={'name':'Renamed Owner'})
    assert result.status_code==200,result.text
    assert result.json()['name']=='Renamed Owner'
    assert client.get('/api/v1/auth/me',headers=second).json()['name']=='Renamed Owner'
    assert client.get('/api/v1/auth/me',headers=first).status_code==200
    assert client.put('/api/v1/auth/account',headers=first,json={'name':'Name','newPassword':'new-test-password'}).status_code==422
