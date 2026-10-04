from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field, ConfigDict, model_validator
import re

class RecordData(BaseModel):
    model_config=ConfigDict(extra='forbid')

class InventoryData(RecordData):
    name:str=Field(min_length=1,max_length=160)
    type:Literal['INGREDIENT','RESALE','PACKAGING']
    unit:str=Field(min_length=1,max_length=30)
    reorderLevel:float=Field(ge=0,allow_inf_nan=False)

class MovementData(RecordData):
    itemId:str
    quantity:float=Field(allow_inf_nan=False)
    reason:str=Field(min_length=1,max_length=500)
    type:Literal['RECEIVE','ADJUSTMENT','WASTAGE']

class SupplierData(RecordData):
    name:str=Field(min_length=1,max_length=160)
    phone:str=''

class PurchaseLine(RecordData):
    itemId:str
    quantity:float=Field(gt=0,allow_inf_nan=False)
    unitCost:int=Field(ge=0)

class PurchaseData(RecordData):
    supplierId:str
    status:Literal['DRAFT','RECEIVED','CANCELLED']='DRAFT'
    items:list[PurchaseLine]=Field(min_length=1)
    notes:str=''

class ExpenseData(RecordData):
    currency:Literal['GHS','USD','GBP','EUR']='GHS'
    fromDrawer:bool=False
    shiftId:str|None=None
    category:Literal['Food Supplies','Gas','Transport','Utilities','Cleaning','Maintenance','Other']
    description:str=Field(min_length=1,max_length=300)
    amount:int=Field(gt=0)
    paymentMethod:Literal['CASH','MOMO','CARD']
    date:str
    notes:str=''
    status:Literal['DRAFT','SETTLED']='SETTLED'

class CustomerData(RecordData):
    name:str=Field(min_length=1,max_length=160)
    phone:str=''

class StaffData(RecordData):
    name:str=Field(min_length=1,max_length=160)
    phone:str=''
    email:str=''
    position:str=Field(min_length=1,max_length=120)
    location:str=Field(min_length=1,max_length=160)
    status:Literal['ACTIVE','INACTIVE']='ACTIVE'

class ShiftData(RecordData):
    operatorId:str|None=None
    operatorName:str=''
    terminalId:str|None=None
    status:Literal['OPEN','CLOSED']
    openedAt:datetime
    closedAt:datetime|None=None
    openingCash:int=Field(ge=0)
    staffIds:list[str]=[]
    countedCash:int|None=Field(default=None,ge=0)
    expectedCash:int|None=None
    variance:int|None=None
    notes:str=''

class CashMovementData(RecordData):
    expenseId:str|None=None
    shiftId:str
    amount:int
    reason:str=Field(min_length=1,max_length=300)

class CorrectionData(RecordData):
    orderId:str
    type:Literal['REFUND','VOID']
    amount:int=Field(gt=0)
    reason:str=Field(min_length=1,max_length=500)
    paymentMethod:Literal['CASH','MOMO','CARD']
    shiftId:str|None=None

class WorkflowData(RecordData):
    orderId:str
    status:Literal['NEW','ACCEPTED','PREPARING','READY','COMPLETED','CANCELLED']
    notes:str=''

class PaymentData(RecordData):
    orderId:str
    amount:int=Field(ge=0)
    paymentMethod:Literal['CASH','MOMO','CARD']
    amountTendered:int|None=Field(default=None,ge=0)
    change:int=Field(default=0,ge=0)
    reference:str=Field(default='',max_length=200)

class MenuData(RecordData):
    name:str=Field(min_length=1,max_length=160)
    category:str=''
    categoryId:str=''
    description:str=Field(default='',max_length=2000)
    image:str=Field(default='',max_length=550000)
    pricingType:Literal['SINGLE','VARIATIONS']='SINGLE'
    variations:list['VariationData']=Field(default_factory=list,max_length=50)
    pricePesewas:int=Field(ge=0)
    requiresKitchen:bool=True
    active:bool=True
    isAvailable:bool=True
    trackStock:bool=False
    stockUnit:str=Field(default='Bottle',min_length=1,max_length=30)
    lowStockLevel:int=Field(default=0,ge=0)

    @model_validator(mode='after')
    def valid_variations(self):
        if self.pricingType=='VARIATIONS':
            if not self.variations or len({v.name.strip().lower() for v in self.variations})!=len(self.variations) or len({v.id for v in self.variations})!=len(self.variations):
                raise ValueError('Variations require unique names and identifiers')
            if self.pricePesewas!=min(v.pricePesewas for v in self.variations):raise ValueError('Starting price must match the lowest variation price')
        if self.image and not re.fullmatch(r'data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+',self.image):raise ValueError('Unsupported image format')
        return self

class VariationData(RecordData):
    id:str=Field(min_length=1,max_length=36)
    name:str=Field(min_length=1,max_length=80)
    pricePesewas:int=Field(ge=0)

class CategoryData(RecordData):
    name:str=Field(min_length=1,max_length=80)
    position:int=Field(ge=0)
    active:bool=True

class StockData(RecordData):
    menuItemId:str
    type:Literal['OPENING_STOCK','RESTOCK','SALE','ADJUSTMENT','WASTAGE','RETURN']
    quantityDelta:int
    balanceBefore:int
    balanceAfter:int
    referenceId:str|None=None
    reason:str=Field(default='',max_length=500)

MenuData.model_rebuild()

class SettingsData(RecordData):
    section:Literal['Business','Locations','POS','Receipt','Feature Flags','Updates','Sync']
    values:dict[str,str|bool|int]

class DeviceData(RecordData):
    name:str=Field(min_length=1,max_length=160)
    terminalId:str=Field(min_length=1,max_length=36)
    location:str

class HoldData(RecordData):
    label:str
    status:Literal['HELD','RESUMED','CANCELLED']='HELD'
    items:list[dict]
    orderType:Literal['DINE_IN','TAKEAWAY']='TAKEAWAY'
    notes:str=''
    customerId:str|None=None

class SystemData(RecordData):
    message:str=Field(max_length=1000)
    orderId:str|None=None

SCHEMAS={'inventory':InventoryData,'movement':MovementData,'supplier':SupplierData,'purchase':PurchaseData,
    'expense':ExpenseData,'customer':CustomerData,'staff':StaffData,'shift':ShiftData,'cash':CashMovementData,
    'correction':CorrectionData,'workflow':WorkflowData,'payment':PaymentData,'menu':MenuData,
    'settings':SettingsData,'device':DeviceData,'hold':HoldData,'system':SystemData,'category':CategoryData,'stock':StockData}

class Operation(BaseModel):
    id:str=Field(min_length=1,max_length=36)
    businessId:str
    locationId:str
    actorId:str
    entityId:str=Field(min_length=1,max_length=100)
    kind:str
    action:str=Field(min_length=1,max_length=40)
    baseVersion:int=Field(ge=0)
    occurredAt:datetime
    data:dict
