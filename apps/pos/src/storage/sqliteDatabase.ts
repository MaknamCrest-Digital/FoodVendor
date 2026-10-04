import {Capacitor} from '@capacitor/core';
import {CapacitorSQLite,SQLiteConnection,type SQLiteDBConnection} from '@capacitor-community/sqlite';
import {openDB,type DBSchema} from 'idb';
import {DATABASE_NAME,DATABASE_SCHEMA_VERSION,type LocalDatabase,type LocalObjectStore,type LocalTransaction,type StoreName,type StoredOutbox,type StoredValue,type TransactionMode,recordKey} from './database';

type SQLiteRow={value:string};
type SQLiteQueryResult={values?:SQLiteRow[]};
type SQLiteParameter=string|number|null;

interface SQLiteExecutor{
 beginTransaction():Promise<unknown>;
 commitTransaction():Promise<unknown>;
 rollbackTransaction():Promise<unknown>;
 query(statement:string,values?:SQLiteParameter[]):Promise<SQLiteQueryResult>;
 run(statement:string,values?:SQLiteParameter[],transaction?:boolean):Promise<unknown>;
 execute(statements:string,transaction?:boolean):Promise<unknown>;
 isDBOpen():Promise<{result?:boolean}>;
 open():Promise<void>;
}

interface LegacySchema extends DBSchema{
 orders:{key:string;value:Extract<StoredValue,{id:string}>};
 outbox:{key:string;value:StoredOutbox};
}

export class SQLiteLocalDatabase implements LocalDatabase{
 readonly version=DATABASE_SCHEMA_VERSION;
 private transactionTail:Promise<void>=Promise.resolve();

 constructor(private readonly connection:SQLiteExecutor){}

 transaction(storeNames:StoreName|StoreName[],mode:TransactionMode='readonly'){
  const names=Array.isArray(storeNames)?storeNames:[storeNames];
  return new SQLiteLocalTransaction(this,names,mode);
 }

 async acquireTransaction(){
  let release!:()=>void;
  const released=new Promise<void>(resolve=>{release=resolve;});
  const previous=this.transactionTail;
  this.transactionTail=previous.then(()=>released);
  await previous;
  try{await this.connection.beginTransaction();}
  catch(error){release();throw error;}
  return release;
 }

 async queryValue(store:StoreName,key:string){
  const result=await this.connection.query(`SELECT value FROM ${store} WHERE record_key = ?`,[key]);
  const value=result.values?.[0]?.value;
  return value===undefined?undefined:JSON.parse(value) as StoredValue;
 }

 async queryAll(store:StoreName){
  const result=await this.connection.query(`SELECT value FROM ${store}`);
  return (result.values||[]).map(row=>JSON.parse(row.value) as StoredValue);
 }

 async write(store:StoreName,value:StoredValue,insertOnly:boolean){
  const key=recordKey(store,value);
  const statement=insertOnly
   ?`INSERT INTO ${store} (record_key,value) VALUES (?,?)`
   :`INSERT INTO ${store} (record_key,value) VALUES (?,?) ON CONFLICT(record_key) DO UPDATE SET value = excluded.value`;
  await this.connection.run(statement,[key,JSON.stringify(value)],true);
  return key;
 }

 async deleteRecord(store:StoreName,key:string){await this.connection.run(`DELETE FROM ${store} WHERE record_key = ?`,[key],true);}
 async clearRecords(store:StoreName){await this.connection.run(`DELETE FROM ${store}`,[],true);}
 async commitTransaction(){await this.connection.commitTransaction();}
 async rollbackTransaction(){await this.connection.rollbackTransaction();}

 async get<T extends StoredValue=StoredValue>(store:StoreName,key:string){
  const tx=this.transaction(store,'readonly');
  const result=await tx.store.get<T>(key);
  await tx.done;
  return result;
 }
 async getAll<T extends StoredValue=StoredValue>(store:StoreName){
  const tx=this.transaction(store,'readonly');
  const result=await tx.store.getAll<T>();
  await tx.done;
  return result;
 }
 async put(store:StoreName,value:StoredValue){
  const tx=this.transaction(store,'readwrite');
  const key=await tx.store.put(value);
  await tx.done;
  return key;
 }
 async clear(store:StoreName){
  const tx=this.transaction(store,'readwrite');
  await tx.store.clear();
  await tx.done;
 }
}

class SQLiteLocalObjectStore implements LocalObjectStore{
 constructor(private readonly transaction:SQLiteLocalTransaction,private readonly name:StoreName){}
 add(value:StoredValue){return this.transaction.request(()=>this.transaction.database.write(this.name,value,true),true);}
 clear(){return this.transaction.request(()=>this.transaction.database.clearRecords(this.name),true);}
 delete(key:string){return this.transaction.request(()=>this.transaction.database.deleteRecord(this.name,key),true);}
 get<T extends StoredValue=StoredValue>(key:string){return this.transaction.request(async()=>await this.transaction.database.queryValue(this.name,key) as T|undefined);}
 getAll<T extends StoredValue=StoredValue>(){return this.transaction.request(async()=>await this.transaction.database.queryAll(this.name) as T[]);}
 put(value:StoredValue){return this.transaction.request(()=>this.transaction.database.write(this.name,value,false),true);}
}

class SQLiteLocalTransaction implements LocalTransaction{
 readonly ready:Promise<()=>void>;
 private operations:Promise<void>=Promise.resolve();
 private finishPromise:Promise<void>|undefined;
 private aborted=false;
 private names:StoreName[];

 constructor(readonly database:SQLiteLocalDatabase,names:StoreName[],private readonly mode:TransactionMode){
  this.names=names;
  this.ready=database.acquireTransaction();
 }

 get done(){
  if(!this.finishPromise)this.finishPromise=this.finish();
  return this.finishPromise;
 }

 get store(){
  if(this.names.length!==1)throw new Error('A single-store transaction is required to use store.');
  return this.objectStore(this.names[0]);
 }

 objectStore(name:StoreName){
  if(!this.names.includes(name))throw new Error(`Store ${name} is not part of this transaction.`);
  return new SQLiteLocalObjectStore(this,name);
 }

 request<T>(operation:()=>Promise<T>,write=false){
  const result=this.operations.then(async()=>{
   if(this.aborted)throw new Error('Transaction aborted.');
   if(this.mode==='readonly'&&write)throw new Error('Cannot write to a readonly transaction.');
   await this.ready;
   return operation();
  });
  this.operations=result.then(()=>undefined);
  return result;
 }

 abort(){this.aborted=true;}

 private async finish(){
  const release=await this.ready;
  try{
   await this.operations;
   if(this.aborted)throw new Error('Transaction aborted.');
   await this.database.commitTransaction();
  }catch(error){
   try{await this.database.rollbackTransaction();}
   catch(rollbackError){console.error('Failed to roll back a local SQLite transaction.',rollbackError);}
   throw error;
  }finally{release();}
 }
}

export async function migrateLegacyIndexedDB(connection:SQLiteExecutor){
 await connection.execute(`CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY, completed_at TEXT NOT NULL);`,false);
 const marker=await connection.query(`SELECT name FROM local_migrations WHERE name = ?`,['indexeddb-v1-to-sqlite-v1']);
 if(marker.values?.length)return;

 const factory=globalThis.indexedDB as IDBFactory&{databases?:()=>Promise<Array<{name?:string}>>};
 if(typeof factory?.databases!=='function'){
  console.warn('IndexedDB does not expose database discovery; legacy browser records were not migrated. The source database remains unchanged.');
  return;
 }
 const databases=await factory.databases();
 if(!databases.some(database=>database.name===DATABASE_NAME))return;
 const legacy=await openDB<LegacySchema>(DATABASE_NAME,DATABASE_SCHEMA_VERSION);
 try{
  const orders=await legacy.getAll('orders');
  const outbox=await legacy.getAll('outbox');
  await connection.beginTransaction();
  try{
   for(const order of orders){
    if(typeof order.id!=='string')throw new Error('Legacy order is missing its ID; original browser data was left intact.');
    await connection.run(`INSERT OR IGNORE INTO orders (record_key,value) VALUES (?,?)`,[order.id,JSON.stringify(order)],true);
    const saved=await connection.query(`SELECT value FROM orders WHERE record_key = ?`,[order.id]);
    if(saved.values?.[0]?.value!==JSON.stringify(order))throw new Error(`Legacy order ${order.id} conflicts with SQLite data; original browser data was left intact.`);
   }
   for(const entry of outbox){
    if(typeof entry.eventId!=='string')throw new Error('Legacy outbox entry is missing its ID; original browser data was left intact.');
    await connection.run(`INSERT OR IGNORE INTO outbox (record_key,value) VALUES (?,?)`,[entry.eventId,JSON.stringify(entry)],true);
    const saved=await connection.query(`SELECT value FROM outbox WHERE record_key = ?`,[entry.eventId]);
    if(saved.values?.[0]?.value!==JSON.stringify(entry))throw new Error(`Legacy outbox entry ${entry.eventId} conflicts with SQLite data; original browser data was left intact.`);
   }
   await connection.run(`INSERT INTO local_migrations (name,completed_at) VALUES (?,?)`,['indexeddb-v1-to-sqlite-v1',new Date().toISOString()],true);
   await connection.commitTransaction();
   }catch(error){
   try{await connection.rollbackTransaction();}
   catch(rollbackError){console.error('Failed to roll back legacy local-data migration.',rollbackError);}
   throw error;
   }
  }finally{legacy.close();}
}

export async function openSQLiteDatabase():Promise<LocalDatabase>{
 if(!Capacitor.isNativePlatform())throw new Error('SQLite storage is available only in the native Capacitor app.');
 const manager=new SQLiteConnection(CapacitorSQLite);
 const name=DATABASE_NAME.replaceAll('-','_');
 const existing=await manager.isConnection(name,false);
 const connection:SQLiteDBConnection=existing.result
  ?await manager.retrieveConnection(name,false)
  :await manager.createConnection(name,false,'no-encryption',DATABASE_SCHEMA_VERSION,false);
 if(!(await connection.isDBOpen()).result)await connection.open();
 await connection.execute(`CREATE TABLE IF NOT EXISTS orders (record_key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outbox (record_key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);`,false);
 const executor:SQLiteExecutor=connection;
 const database=new SQLiteLocalDatabase(executor);
 await migrateLegacyIndexedDB(executor);
 return database;
}
