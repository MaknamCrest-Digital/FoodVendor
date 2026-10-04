import {StatusBadge} from './primitives';
import type {SyncPhase,SyncStatusView} from '../../src/lib/syncStatus';

export const syncTone:Record<SyncPhase,'success'|'warning'|'danger'|'info'>={SYNCED:'success',PENDING:'info',SYNCING:'info',OFFLINE:'warning',ERROR:'danger'};

export function PrinterStatus(){
  return <StatusBadge tone="info" className="printer-badge">Printer: System</StatusBadge>;
}
export function SyncStatus({status}:{status:SyncStatusView}){
  return <div className="sync-state" role="status" title={status.detail}><StatusBadge tone={syncTone[status.phase]} dot>{status.label}</StatusBadge></div>;
}
