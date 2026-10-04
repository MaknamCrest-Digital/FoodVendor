import type {JournalEntry} from '../types/admin';
import type {LocalOrder,OutboxEvent} from '../types/domain';
import type {SettingRow} from '../lib/settings';

export const DATABASE_NAME='food-vendor-os-pos';
export const DATABASE_SCHEMA_VERSION=1;
export type StoreName='orders'|'outbox';
export type TransactionMode='readonly'|'readwrite';
export type StoredOrder=LocalOrder&{syncError?:string};
export type SettingsCacheRecord={eventId:string;recordType:'settings-cache';setting:SettingRow};
export type StoredOutbox=OutboxEvent|JournalEntry|SettingsCacheRecord;
export type StoredValue=StoredOrder|StoredOutbox;

export interface LocalObjectStore{
 add(value:StoredValue):Promise<string|number>;
 clear():Promise<void>;
 delete(key:string):Promise<void>;
 get<T extends StoredValue=StoredValue>(key:string):Promise<T|undefined>;
 getAll<T extends StoredValue=StoredValue>():Promise<T[]>;
 put(value:StoredValue):Promise<string|number>;
}

export interface LocalTransaction{
 readonly done:Promise<void>;
 readonly store:LocalObjectStore;
 objectStore(name:StoreName):LocalObjectStore;
 abort():void;
}

export interface LocalDatabase{
 readonly version:number;
 transaction(storeNames:StoreName|StoreName[],mode?:TransactionMode):LocalTransaction;
 clear(name:StoreName):Promise<void>;
 get<T extends StoredValue=StoredValue>(name:StoreName,key:string):Promise<T|undefined>;
 getAll<T extends StoredValue=StoredValue>(name:StoreName):Promise<T[]>;
 put(name:StoreName,value:StoredValue):Promise<string|number>;
}

export function isJournalEntry(value:StoredOutbox):value is JournalEntry{
 return 'recordType' in value&&value.recordType==='operation'&&'operation' in value;
}

export function recordKey(store:StoreName,value:StoredValue){
 if(store==='orders'&&'id' in value)return value.id;
 if(store==='outbox'&&'eventId' in value)return value.eventId;
 throw new Error(`A ${store} record is missing its primary key.`);
}
