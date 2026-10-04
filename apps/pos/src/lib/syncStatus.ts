// Cashier-facing sync state. "Synced" means the local outbox has nothing
// unresolved — never merely that the device is online.
export type SyncPhase='SYNCED'|'PENDING'|'SYNCING'|'OFFLINE'|'ERROR';
export type SyncSnapshot={online:boolean;syncing:boolean;pending:number;rejected:number;lastRunFailed:boolean};
export type SyncStatusView={phase:SyncPhase;label:string;detail:string};

const items=(count:number)=>`${count} ${count===1?'item':'items'}`;

export function syncStatus({online,syncing,pending,rejected,lastRunFailed}:SyncSnapshot):SyncStatusView{
  if(!online)return {phase:'OFFLINE',label:'Local mode',detail:pending?`${items(pending)} saved on this device; they will sync when you are back online.`:'Sales are saved on this device.'};
  if(syncing)return {phase:'SYNCING',label:pending?`Syncing ${items(pending)}`:'Syncing…',detail:'Sending saved records to the cloud.'};
  if(rejected||(lastRunFailed&&pending))return {phase:'ERROR',label:'Sync failed — retry available',detail:`${items(pending)} still saved on this device. Nothing was deleted.`};
  if(pending)return {phase:'PENDING',label:`${items(pending)} pending`,detail:'Waiting to sync. Press Sync now to send them.'};
  return {phase:'SYNCED',label:'Synced',detail:'Everything on this device is in the cloud.'};
}
