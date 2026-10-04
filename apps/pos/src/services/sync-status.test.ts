import assert from 'node:assert/strict';
import {it} from 'node:test';
import {syncStatus} from '../lib/syncStatus';

const base={online:true,syncing:false,pending:0,rejected:0,lastRunFailed:false};

it('reports Synced only when nothing is pending, not merely when online',()=>{
  assert.equal(syncStatus(base).phase,'SYNCED');
  assert.equal(syncStatus({...base,pending:3}).phase,'PENDING');
  assert.equal(syncStatus({...base,pending:3}).label,'3 items pending');
});
it('shows local mode offline and syncing progress online',()=>{
  assert.deepEqual([syncStatus({...base,online:false,pending:2}).phase,syncStatus({...base,online:false,pending:2}).label],['OFFLINE','Local mode']);
  assert.equal(syncStatus({...base,syncing:true,pending:4}).label,'Syncing 4 items');
});
it('shows a retryable error for rejected records or a failed run with work left',()=>{
  assert.equal(syncStatus({...base,pending:1,rejected:1}).phase,'ERROR');
  assert.equal(syncStatus({...base,pending:2,lastRunFailed:true}).label,'Sync failed — retry available');
  assert.equal(syncStatus({...base,lastRunFailed:true}).phase,'SYNCED');
});
