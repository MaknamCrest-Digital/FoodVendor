import {getDatabase} from './db';
import type {SettingsCacheRecord} from '../storage/database';
import {requireUser} from './auth';
import {api} from './api';
import {requirePermission} from './access';
export type Currency='GHS'|'USD'|'GBP'|'EUR';
export type PaperProfile='THERMAL_58'|'THERMAL_80'|'A4'|'LETTER';
export type PrinterConnection='LOCAL_PRINTER'|'SYSTEM_PRINTER'|'NETWORK_PRINTER'|'BLUETOOTH_PRINTER'|'USB_PRINTER'|'AIRPRINT_NATIVE'|'BROWSER_PRINT';
export type PrinterProfile={id:string;businessId:string;locationId:string;deviceId:string;name:string;printerType:'THERMAL'|'OFFICE';connectionType:PrinterConnection;paperProfile:PaperProfile;status:'CONFIGURED';isDefault:boolean;capabilities:string[];configuration:Record<string,string|number|boolean>};
export type Settings={
 general:{businessName:string;businessType:string;email:string;phone:string;address:string;logo:string;currency:Currency;timezone:string;dateFormat:'DD/MM/YYYY'|'MM/DD/YYYY'|'YYYY-MM-DD';timeFormat:'12h'|'24h'};
 location:{name:string;address:string;phone:string};
 payments:{cash:boolean;momo:boolean;card:boolean;defaultMethod:'CASH'|'MOMO'|'CARD';requireMomoReference:boolean};
 receipts:{showLogo:boolean;showBusinessName:boolean;showAddress:boolean;showPhone:boolean;showCashier:boolean;showPaymentMethod:boolean;showOrderNumber:boolean;showReceiptNumber:boolean;paperWidth:58|80;collectionMessage:string;footer:string};
 pos:{confirmSale:boolean;autoPrint:boolean;showChangeCalculator:boolean;allowNegativeStock:boolean;lowStockWarnings:boolean;requireShift:boolean;requireOpeningCash:boolean;requireClosingCount:boolean;requireVarianceNote:boolean};
 appearance:{theme:'LIGHT'|'DARK'|'SYSTEM';density:'COMFORTABLE'|'COMPACT'};
 device:{name:string;printerName:string;paperWidth:58|80;printerType:'MOCK';printers:PrinterProfile[];defaultPrinterId:string|null};
};
export type Section=keyof Settings;
export type SettingRow={section:Section;scope:'BUSINESS'|'LOCATION'|'USER'|'DEVICE';scopeId:string;revision:number;values:Settings[Section];pending?:boolean};
export const sectionPermissions:Record<Section,string>={general:'settings.general',location:'settings.general',payments:'settings.payments',receipts:'settings.receipts',pos:'settings.pos',appearance:'settings.appearance',device:'devices.manage'};
export function defaultSettings():Settings{const user=requireUser();return {
 general:{businessName:user.businessName,businessType:'Food Vendor',email:'',phone:'',address:'',logo:'',currency:'GHS',timezone:'Africa/Accra',dateFormat:'DD/MM/YYYY',timeFormat:'24h'},
 location:{name:user.locationName,address:'',phone:''},payments:{cash:true,momo:true,card:true,defaultMethod:'CASH',requireMomoReference:false},
 receipts:{showLogo:false,showBusinessName:true,showAddress:true,showPhone:true,showCashier:true,showPaymentMethod:true,showOrderNumber:true,showReceiptNumber:true,paperWidth:80,collectionMessage:'',footer:'Thank you for your purchase.'},
 pos:{confirmSale:true,autoPrint:true,showChangeCalculator:true,allowNegativeStock:false,lowStockWarnings:true,requireShift:true,requireOpeningCash:true,requireClosingCount:true,requireVarianceNote:true},
 appearance:{theme:'SYSTEM',density:'COMFORTABLE'},device:{name:user.terminalName,printerName:'',paperWidth:80,printerType:'MOCK',printers:[],defaultPrinterId:null},
};}
function cacheKey(section:Section){const u=requireUser();return `setting:${u.businessId}:${section}:${section==='appearance'?u.id:section==='device'?u.terminalId:section==='location'?u.locationId:u.businessId}`;}
export async function settingRows():Promise<SettingRow[]>{const db=await getDatabase();return (await Promise.all((Object.keys(defaultSettings()) as Section[]).map(section=>db.get<SettingsCacheRecord>('outbox',cacheKey(section))))).filter((row):row is SettingsCacheRecord=>row?.recordType==='settings-cache').map(row=>row.setting);}
async function cacheRow(row:SettingRow){await(await getDatabase()).put('outbox',{eventId:cacheKey(row.section),recordType:'settings-cache',setting:row});}
export function settingsFromRows(rows:SettingRow[]):Settings{const value=defaultSettings();for(const row of rows){const sectionValues=row.section==='device'?{...value.device,...row.values}:row.values;Object.assign(value,{[row.section]:sectionValues});}return value;}
export async function localSettings(){return settingsFromRows(await settingRows());}
export async function refreshSettings(){
 const user=requireUser();const response=await api<{businessId:string;userId:string;sections:SettingRow[]}>(`/settings?deviceId=${encodeURIComponent(user.terminalId)}`);
 if(response.businessId!==user.businessId||response.userId!==user.id)throw new Error('Settings scope mismatch.');
 const cached=await settingRows();
 for(const row of response.sections){const pending=cached.find(r=>r.section===row.section&&r.pending);if(pending&&row.section==='appearance'){
  try{await cacheRow(await api<SettingRow>('/settings/appearance','PUT',{revision:row.revision,values:pending.values}));}catch{await cacheRow({...pending,revision:row.revision});}
 }else await cacheRow(row);}
 return settingRows();
}
export async function saveSetting(section:Section,values:Settings[Section],revision:number,confirmCurrencyChange=false){
 requirePermission(sectionPermissions[section]);
 if(section==='appearance'){
  const row:SettingRow={section,scope:'USER',scopeId:requireUser().id,revision,values,pending:true};await cacheRow(row);
  try{await cacheRow(await api<SettingRow>(`/settings/${section}`,'PUT',{values,revision}));}catch{/* Personal preferences remain durable offline and retry on reconnect. */}
 }else await cacheRow(await api<SettingRow>(`/settings/${section}`,'PUT',{values,revision,deviceId:requireUser().terminalId,confirmCurrencyChange}));
 if(typeof window!=='undefined')window.dispatchEvent(new Event('settings-changed'));
 return settingRows();
}
let displayCurrency:Currency='GHS';
export function setDisplayCurrency(value:Currency){displayCurrency=value;}
export function money(value:number,currency:Currency=displayCurrency){return `${{GHS:'GH₵',USD:'$',GBP:'£',EUR:'€'}[currency]} ${(value/100).toFixed(2)}`;}
export function businessDay(date:string|Date,timezone:string){return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(date));}
