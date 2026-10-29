// Validation of the free-form printer `configuration` stored in device settings.
// No Bluetooth service or characteristic is assumed: the UUIDs must be read from
// the actual printer (for example with a BLE scanner app) and entered here.
import type {PaperProfile,PrinterConnection,PrinterProfile} from '../lib/settings';
import {charsPerLineFor,MAX_CHARS_PER_LINE,MIN_CHARS_PER_LINE} from './escpos';

export type PrinterConfiguration=PrinterProfile['configuration'];
export type BluetoothTransport='BLE_GATT'|'CLASSIC_SPP';
export type BluetoothPrinterConfig={transport:'BLE_GATT';serviceUuid:string;characteristicUuid:string;namePrefix:string;deviceId:string;chunkSize:number};
export type BluetoothConfigResult={ok:true;config:BluetoothPrinterConfig}|{ok:false;reason:string};

export const DEFAULT_CHUNK_SIZE=20;  // the smallest BLE write every printer accepts
export const MAX_CHUNK_SIZE=512;
const BASE_UUID_SUFFIX='-0000-1000-8000-00805f9b34fb';  // Bluetooth Core Specification base UUID

// A full 128-bit UUID, or a 16/32-bit assigned number expanded with the base UUID.
export function normalizeUuid(value:unknown):string|null{
  if(typeof value!=='string')return null;
  const text=value.trim().toLowerCase().replace(/^0x/,'');
  if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(text))return text;
  if(/^[0-9a-f]{4}$/.test(text))return `0000${text}${BASE_UUID_SUFFIX}`;
  if(/^[0-9a-f]{8}$/.test(text))return `${text}${BASE_UUID_SUFFIX}`;
  return null;
}

function integer(value:unknown,min:number,max:number):number|null|undefined{
  if(value===undefined||value==='')return undefined;
  const number=typeof value==='number'?value:typeof value==='string'&&/^\d+$/.test(value.trim())?Number(value):NaN;
  return Number.isInteger(number)&&number>=min&&number<=max?number:null;
}

export const NOT_SET_UP='Bluetooth printing is not set up. Enter the service and characteristic UUIDs read from this printer.';
export const CLASSIC_UNSUPPORTED='This printer uses Bluetooth Classic (SPP). Browsers can only reach Bluetooth Low Energy printers; use the Android print dialog route or a future native app.';

export function parseBluetoothConfig(configuration:PrinterConfiguration):BluetoothConfigResult{
  const transport=configuration.transport;
  if(transport==='CLASSIC_SPP')return {ok:false,reason:CLASSIC_UNSUPPORTED};
  if(transport!=='BLE_GATT')return {ok:false,reason:NOT_SET_UP};
  const serviceUuid=normalizeUuid(configuration.serviceUuid);
  const characteristicUuid=normalizeUuid(configuration.characteristicUuid);
  if(!serviceUuid||!characteristicUuid)return {ok:false,reason:NOT_SET_UP};
  const chunkSize=integer(configuration.chunkSize,DEFAULT_CHUNK_SIZE,MAX_CHUNK_SIZE);
  if(chunkSize===null)return {ok:false,reason:`Chunk size must be between ${DEFAULT_CHUNK_SIZE} and ${MAX_CHUNK_SIZE} bytes.`};
  const namePrefix=typeof configuration.namePrefix==='string'?configuration.namePrefix.trim():'';
  const deviceId=typeof configuration.deviceId==='string'?configuration.deviceId:'';
  return {ok:true,config:{transport,serviceUuid,characteristicUuid,namePrefix,deviceId,chunkSize:chunkSize??DEFAULT_CHUNK_SIZE}};
}

export function printerWidth(paper:PaperProfile,configuration:PrinterConfiguration):number{
  const override=integer(configuration.charsPerLine,MIN_CHARS_PER_LINE,MAX_CHARS_PER_LINE);
  return charsPerLineFor(paper,override??undefined);
}

// Errors shown before a profile is saved. A Bluetooth profile without UUIDs may be saved
// (it stays unavailable), but values that are entered must be well formed.
export function configurationErrors(connectionType:PrinterConnection,paper:PaperProfile,configuration:PrinterConfiguration):string[]{
  const errors:string[]=[];
  if(integer(configuration.charsPerLine,MIN_CHARS_PER_LINE,MAX_CHARS_PER_LINE)===null)errors.push(`Characters per line must be between ${MIN_CHARS_PER_LINE} and ${MAX_CHARS_PER_LINE}.`);
  if(configuration.charsPerLine!==undefined&&configuration.charsPerLine!==''&&!paper.startsWith('THERMAL_'))errors.push('Characters per line applies to thermal paper only.');
  if(connectionType!=='BLUETOOTH_PRINTER')return errors;
  const transport=configuration.transport;
  if(transport!==undefined&&transport!=='BLE_GATT'&&transport!=='CLASSIC_SPP')errors.push('Choose a Bluetooth transport.');
  if(transport==='BLE_GATT'){
    for(const [key,label] of [['serviceUuid','Service UUID'],['characteristicUuid','Characteristic UUID']] as const){
      const value=configuration[key];
      if(value!==undefined&&value!==''&&!normalizeUuid(value))errors.push(`${label} must be a 128-bit UUID or a 4/8-digit hex assigned number.`);
    }
    if(integer(configuration.chunkSize,DEFAULT_CHUNK_SIZE,MAX_CHUNK_SIZE)===null)errors.push(`Chunk size must be between ${DEFAULT_CHUNK_SIZE} and ${MAX_CHUNK_SIZE} bytes.`);
    const prefix=configuration.namePrefix;
    if(typeof prefix==='string'&&(prefix.length>40||/[^\x20-\x7e]/.test(prefix)))errors.push('Device name prefix must be up to 40 plain characters.');
  }
  if(!paper.startsWith('THERMAL_'))errors.push('Bluetooth receipt printers use 58 mm or 80 mm thermal paper.');
  return errors;
}

// Manual configuration enables direct Bluetooth only for BLE with both verified UUIDs.
export function manualSetupErrors(connectionType:PrinterConnection,paper:PaperProfile,configuration:PrinterConfiguration):string[]{
  const errors=configurationErrors(connectionType,paper,configuration);
  if(connectionType==='BLUETOOTH_PRINTER'){
    if(configuration.transport!=='BLE_GATT')errors.push('Manual Bluetooth setup supports Bluetooth Low Energy printers only.');
    if(!normalizeUuid(configuration.serviceUuid)||!normalizeUuid(configuration.characteristicUuid))errors.push('Enter the verified service and characteristic UUIDs before enabling direct Bluetooth printing.');
  }
  return [...new Set(errors)];
}
