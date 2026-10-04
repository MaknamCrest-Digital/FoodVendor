from typing import Literal
from zoneinfo import ZoneInfo,ZoneInfoNotFoundError
from pydantic import BaseModel,Field,ConfigDict,model_validator,field_validator

class SettingsModel(BaseModel):
    model_config=ConfigDict(extra='forbid')

class General(SettingsModel):
    businessName:str=Field(min_length=1,max_length=120)
    businessType:str=Field(default='Food Vendor',max_length=80)
    email:str=Field(default='',max_length=254)
    phone:str=Field(default='',max_length=80)
    address:str=Field(default='',max_length=500)
    logo:str=Field(default='',max_length=550000)
    currency:Literal['GHS','USD','GBP','EUR']='GHS'
    timezone:str='Africa/Accra'
    dateFormat:Literal['DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD']='DD/MM/YYYY'
    timeFormat:Literal['12h','24h']='24h'

    @field_validator('timezone')
    @classmethod
    def timezone_exists(cls,value):
        try:ZoneInfo(value)
        except ZoneInfoNotFoundError:raise ValueError('Choose a valid IANA timezone')
        return value

    @field_validator('logo')
    @classmethod
    def logo_format(cls,value):
        import re
        if value and not re.fullmatch(r'data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+',value):raise ValueError('Use PNG, JPEG or WebP logo data')
        return value

class LocationSettings(SettingsModel):
    name:str=Field(min_length=1,max_length=120)
    address:str=Field(default='',max_length=500)
    phone:str=Field(default='',max_length=80)

class Payments(SettingsModel):
    cash:bool=True
    momo:bool=True
    card:bool=True
    defaultMethod:Literal['CASH','MOMO','CARD']='CASH'
    requireMomoReference:bool=False
    @model_validator(mode='after')
    def enabled_default(self):
        if not any([self.cash,self.momo,self.card]):raise ValueError('At least one payment method must remain enabled')
        if not getattr(self,self.defaultMethod.lower()):raise ValueError('Default payment method must be enabled')
        return self

class Receipts(SettingsModel):
    showLogo:bool=False
    showBusinessName:bool=True
    showAddress:bool=True
    showPhone:bool=True
    showCashier:bool=True
    showPaymentMethod:bool=True
    showOrderNumber:bool=True
    showReceiptNumber:bool=True
    paperWidth:Literal[58,80]=80
    collectionMessage:str=Field(default='',max_length=300)
    footer:str=Field(default='Thank you for your purchase.',max_length=500)

class PosSettings(SettingsModel):
    confirmSale:bool=True
    autoPrint:bool=True
    showChangeCalculator:bool=True
    allowNegativeStock:bool=False
    lowStockWarnings:bool=True
    requireShift:bool=True
    requireOpeningCash:bool=True
    requireClosingCount:bool=True
    requireVarianceNote:bool=True

class Appearance(SettingsModel):
    theme:Literal['LIGHT','DARK','SYSTEM']='SYSTEM'
    density:Literal['COMFORTABLE','COMPACT']='COMFORTABLE'

class PrinterProfile(SettingsModel):
    id:str=Field(min_length=1,max_length=80)
    businessId:str=Field(min_length=1,max_length=80)
    locationId:str=Field(min_length=1,max_length=80)
    deviceId:str=Field(min_length=1,max_length=80)
    name:str=Field(min_length=1,max_length=120)
    printerType:Literal['THERMAL','OFFICE']='THERMAL'
    connectionType:Literal['LOCAL_PRINTER','SYSTEM_PRINTER','NETWORK_PRINTER','BLUETOOTH_PRINTER','USB_PRINTER','AIRPRINT_NATIVE','BROWSER_PRINT']
    paperProfile:Literal['THERMAL_58','THERMAL_80','A4','LETTER']='THERMAL_80'
    status:Literal['CONFIGURED']='CONFIGURED'
    isDefault:bool=False
    capabilities:list[str]=Field(default_factory=list,max_length=20)
    configuration:dict[str,str|int|float|bool]=Field(default_factory=dict)

class DeviceSettings(SettingsModel):
    name:str=Field(min_length=1,max_length=120)
    printerName:str=Field(default='',max_length=120)
    paperWidth:Literal[58,80]=80
    printerType:Literal['MOCK']='MOCK'
    printers:list[PrinterProfile]=Field(default_factory=list,max_length=50)
    defaultPrinterId:str|None=None

    @model_validator(mode='after')
    def valid_default_printer(self):
        ids=[printer.id for printer in self.printers]
        if len(ids)!=len(set(ids)):raise ValueError('Printer IDs must be unique')
        defaults=[printer.id for printer in self.printers if printer.isDefault]
        if self.defaultPrinterId is None:
            if defaults:raise ValueError('A default printer profile must be selected')
        elif defaults!=[self.defaultPrinterId]:
            raise ValueError('Select exactly one configured default printer')
        if self.defaultPrinterId not in ids and self.defaultPrinterId is not None:raise ValueError('The default printer must be configured')
        return self

SECTIONS={'general':General,'location':LocationSettings,'payments':Payments,'receipts':Receipts,'pos':PosSettings,'appearance':Appearance,'device':DeviceSettings}
SCOPES={'general':'BUSINESS','location':'LOCATION','payments':'BUSINESS','receipts':'BUSINESS','pos':'BUSINESS','appearance':'USER','device':'DEVICE'}
