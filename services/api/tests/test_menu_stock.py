from uuid import uuid4
from datetime import datetime,timezone
from sqlalchemy import select,func
from app.models.admin import AdminRecord
from app.models.models import Order,SyncEvent
from test_auth import auth_client,signin  # noqa: imported pytest fixture

def operation(kind,entity,data,action='CREATED',version=0):
    return {'id':str(uuid4()),'businessId':'auth-business','locationId':'auth-location','actorId':'auth-owner','entityId':entity,'kind':kind,'action':action,'baseVersion':version,'occurredAt':datetime.now(timezone.utc).isoformat(),'data':data}

def push(client,event):return client.post('/api/v1/admin/events',json=event,headers={'Idempotency-Key':event['id']})

def setup_menu(client):
    client.headers['Authorization']='Bearer '+signin(client).json()['token']
    assert push(client,operation('category','drinks',{'name':'Drinks','position':0,'active':True})).status_code==200
    assert push(client,operation('menu','coke',{'name':'Coke','categoryId':'drinks','pricePesewas':1500,'trackStock':True,'requiresKitchen':False,'stockUnit':'Bottle','lowStockLevel':5})).status_code==200
    assert push(client,operation('stock','opening',{'menuItemId':'coke','type':'OPENING_STOCK','quantityDelta':24,'balanceBefore':0,'balanceAfter':24,'reason':'Opening','referenceId':None})).status_code==200

def sale(quantity=2):
    order_id=str(uuid4());movement=operation('stock',str(uuid4()),{'menuItemId':'coke','type':'SALE','quantityDelta':-quantity,'balanceBefore':24,'balanceAfter':24-quantity,'referenceId':order_id,'reason':'Paid sale'})
    return {'event_id':str(uuid4()),'entity_id':order_id,'event_type':'order.completed','business_id':'auth-business','location_id':'auth-location','terminal_id':'auth-terminal','app_version':'1.0.0','local_schema_version':1,'sync_protocol_version':2,'occurred_at':datetime.now(timezone.utc).isoformat(),'payload':{'id':order_id,'receipt_no':'TEST-'+order_id,'total_pesewas':quantity*1500,'payment_method':'CASH','items':[{'id':str(uuid4()),'menu_item_id':'coke','name':'Coke','quantity':quantity,'unit_price_pesewas':1500,'track_stock':True}],'stock_movements':[movement]}}

def test_sale_and_stock_sync_atomically_and_retry_does_not_deduct_again(auth_client):
    client,sessions=auth_client;setup_menu(client);body=sale()
    for _ in range(2):assert client.post('/api/v1/sync/events',json=body,headers={'Idempotency-Key':body['event_id']}).status_code==200
    with sessions() as db:
        moves=db.scalars(select(AdminRecord).where(AdminRecord.kind=='stock')).all()
        assert sum(r.data['quantityDelta'] for r in moves)==22
        assert len([r for r in moves if r.data['type']=='SALE'])==1
        assert db.scalar(select(func.count()).select_from(Order))==1
        assert db.scalar(select(func.count()).select_from(SyncEvent))==1
    # A duplicate stock event is harmless, even if separately retried.
    assert push(client,body['payload']['stock_movements'][0]).json()['status']=='already_processed'

def test_failed_stock_rolls_back_server_sale_and_marker(auth_client):
    client,sessions=auth_client;setup_menu(client);body=sale(25)
    assert client.post('/api/v1/sync/events',json=body).status_code in (409,422)
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(Order))==0
        assert db.scalar(select(func.count()).select_from(SyncEvent))==0
        assert sum(r.data['quantityDelta'] for r in db.scalars(select(AdminRecord).where(AdminRecord.kind=='stock')))==24

def test_tracked_sale_cannot_omit_deduction_or_use_old_protocol(auth_client):
    client,_=auth_client;setup_menu(client);body=sale();body['payload']['stock_movements']=[]
    assert client.post('/api/v1/sync/events',json=body).status_code==409
    body=sale();body['sync_protocol_version']=1
    assert client.post('/api/v1/sync/events',json=body).status_code==409

def test_stock_scope_and_immutability_are_server_enforced(auth_client):
    client,sessions=auth_client;setup_menu(client)
    wrong=operation('stock','wrong',{'menuItemId':'coke','type':'RESTOCK','quantityDelta':10,'balanceBefore':24,'balanceAfter':34,'referenceId':None,'reason':'Delivery'})
    wrong['businessId']='another-tenant';assert push(client,wrong).status_code==403
    edit=operation('stock','opening',{'menuItemId':'coke','type':'OPENING_STOCK','quantityDelta':100,'balanceBefore':0,'balanceAfter':100,'referenceId':None,'reason':'Overwrite'},version=1)
    assert push(client,edit).status_code==409
    with sessions() as db:assert sum(r.data['quantityDelta'] for r in db.scalars(select(AdminRecord).where(AdminRecord.kind=='stock')))==24
