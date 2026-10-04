import {openDB,type DBSchema,type IDBPDatabase,type IDBPObjectStore,type IDBPTransaction} from 'idb';
import {DATABASE_NAME,DATABASE_SCHEMA_VERSION,type LocalDatabase,type LocalObjectStore,type LocalTransaction,type StoreName,type StoredValue,type TransactionMode} from './database';

interface BrowserSchema extends DBSchema{
 orders:{key:string;value:Extract<StoredValue,{id:string}>};
 outbox:{key:string;value:Exclude<StoredValue,{id:string}>};
}

type BrowserTransactionType=IDBPTransaction<BrowserSchema,StoreName[],TransactionMode>;
type BrowserStore=IDBPObjectStore<BrowserSchema,StoreName[],StoreName,TransactionMode>;

class BrowserObjectStore implements LocalObjectStore{
 constructor(private readonly store:BrowserStore){}
 add(value:StoredValue){return this.store.add!(value as never);}
 clear(){return this.store.clear!();}
 delete(key:string){return this.store.delete!(key);}
 get<T extends StoredValue=StoredValue>(key:string){return this.store.get!(key) as Promise<T|undefined>;}
 getAll<T extends StoredValue=StoredValue>(){return this.store.getAll!() as Promise<T[]>;}
 put(value:StoredValue){return this.store.put!(value as never);}
}

class BrowserTransaction implements LocalTransaction{
 constructor(private readonly transaction:BrowserTransactionType,private readonly names:StoreName[]){}
 get done(){return this.transaction.done;}
 get store(){
  if(this.names.length!==1)throw new Error('A single-store transaction is required to use store.');
  return this.objectStore(this.names[0]);
 }
 objectStore(name:StoreName){return new BrowserObjectStore(this.transaction.objectStore(name));}
 abort(){this.transaction.abort();}
}

export class BrowserLocalDatabase implements LocalDatabase{
 constructor(private readonly database:IDBPDatabase<BrowserSchema>){}
 get version(){return this.database.version;}
 transaction(storeNames:StoreName|StoreName[],mode:TransactionMode='readonly'){
  const names=Array.isArray(storeNames)?storeNames:[storeNames];
  return new BrowserTransaction(this.database.transaction(names,mode),names);
 }
 clear(name:StoreName){return this.database.clear(name);}
 get<T extends StoredValue=StoredValue>(name:StoreName,key:string){return this.database.get(name,key) as Promise<T|undefined>;}
 getAll<T extends StoredValue=StoredValue>(name:StoreName){return this.database.getAll(name) as Promise<T[]>;}
 async put(name:StoreName,value:StoredValue){return this.database.put(name,value as never);}
}

export async function openBrowserDatabase():Promise<BrowserLocalDatabase>{
 const database=await openDB<BrowserSchema>(DATABASE_NAME,DATABASE_SCHEMA_VERSION,{
  upgrade(db){
   if(!db.objectStoreNames.contains('orders'))db.createObjectStore('orders',{keyPath:'id'});
   if(!db.objectStoreNames.contains('outbox'))db.createObjectStore('outbox',{keyPath:'eventId'});
  },
 });
 return new BrowserLocalDatabase(database);
}
