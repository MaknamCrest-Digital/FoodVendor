"use client";
import {useState} from 'react';
import {useAdminData} from './AdminData';
import {Button,DataTable,EmptyState,Input,PageHeader,StatusBadge} from '../ui/primitives';
import RecordEditor,{type Field} from './RecordEditor';
import type {AdminRecord,EntityKind,Data} from '../../src/types/admin';
import {str,num} from '../../src/types/admin';
import {money} from '../../src/services/checkout';
import {useAuth} from '../auth/AuthProvider';
import {useSettings} from '../settings/SettingsProvider';
import {currentShift} from '../../src/lib/operations';
import {can} from '../../src/lib/access';

const option=(values:string[])=>values.map(value=>({value,label:value}));
export const recordConfigs:Partial<Record<EntityKind,{title:string;singular:string;fields:Field[];columns:[string,string][];defaults?:Data}>>={
  expense:{title:'Expenses',singular:'Expense',fields:[{key:'category',label:'Category',type:'select',options:option(['Food Supplies','Gas','Transport','Utilities','Cleaning','Maintenance','Other'])},{key:'description',label:'Description'},{key:'amount',label:'Amount (GH₵)',type:'money',min:0.01},{key:'paymentMethod',label:'Payment method',type:'select',options:option(['CASH','MOMO','CARD'])},{key:'date',label:'Date',type:'date'},{key:'status',label:'Status',type:'select',options:option(['DRAFT','SETTLED'])},{key:'fromDrawer',label:'Paid from current cash drawer',type:'checkbox',required:false},{key:'notes',label:'Notes',type:'textarea',required:false}],columns:[['description','Description'],['category','Category'],['amount','Amount'],['paymentMethod','Payment'],['date','Date'],['status','Status']]},
  supplier:{title:'Suppliers',singular:'Supplier',fields:[{key:'name',label:'Supplier name'},{key:'phone',label:'Phone',required:false}],columns:[['name','Name'],['phone','Phone']]},
  customer:{title:'Customers',singular:'Customer',fields:[{key:'name',label:'Name'},{key:'phone',label:'Phone',required:false}],columns:[['name','Name'],['phone','Phone']]},
  staff:{title:'Staff',singular:'Staff member',fields:[{key:'name',label:'Name'},{key:'phone',label:'Phone',required:false},{key:'email',label:'Email (optional)',type:'email',required:false},{key:'position',label:'Position'},{key:'location',label:'Location'},{key:'status',label:'Status',type:'select',options:option(['ACTIVE','INACTIVE'])}],columns:[['name','Name'],['position','Position'],['location','Location'],['phone','Phone'],['status','Status']]},
};

export default function RecordsModule({kind}:{kind:'expense'|'supplier'|'customer'|'staff'}){
  const {settings}=useSettings();const config=recordConfigs[kind]!;const {records,orders,mutate}=useAdminData();const {session}=useAuth();
  const [query,setQuery]=useState('');const [status,setStatus]=useState('ALL');const [edit,setEdit]=useState<AdminRecord|'new'|null>(null);const [view,setView]=useState<AdminRecord|null>(null);const [error,setError]=useState('');
  const rows=records.filter(record=>record.kind===kind&&(status==='ALL'||record.data.status===status)&&JSON.stringify(record.data).toLowerCase().includes(query.toLowerCase()));
  const initial=edit&&edit!=='new'?edit.data:kind==='expense'?{date:new Date().toISOString().slice(0,10),status:'SETTLED',notes:'',currency:settings.general.currency,fromDrawer:false}:kind==='staff'?{status:'ACTIVE',location:session?.user.locationName||''}:{};
  async function toggle(row:AdminRecord){try{await mutate(kind,{...row.data,status:row.data.status==='ACTIVE'?'INACTIVE':'ACTIVE'},'STAFF_STATUS_CHANGED',row.id,row.revision);}catch(error){setError(String(error));}}
  const customerSales=view?orders.filter(order=>order.customerId===view.id):[];
  return <section className="module-page"><PageHeader title={config.title} description={kind==='customer'?'Walk-in checkout remains available. Customer registration is optional.':kind==='staff'?'Staff records for this location. Admin retains full system access.':'Records for this business and location.'} action={(kind!=='expense'||can('expenses.create'))?<Button variant="primary" onClick={()=>setEdit('new')}>+ Add {config.singular}</Button>:undefined}/><div className="module-tools"><Input aria-label={`Search ${config.title}`} placeholder="Search records…" value={query} onChange={event=>setQuery(event.target.value)}/>{['expense','staff'].includes(kind)&&<select aria-label="Filter status" value={status} onChange={event=>setStatus(event.target.value)}><option value="ALL">All statuses</option>{(kind==='staff'?['ACTIVE','INACTIVE']:['DRAFT','SETTLED']).map(value=><option key={value}>{value}</option>)}</select>}</div>{error&&<p role="alert" className="form-error">{error}</p>}
    {rows.length?<DataTable label={config.title} rows={rows} rowKey={row=>row.id} columns={[...config.columns.map(([key,heading])=>({key,heading,render:(row:AdminRecord)=>key==='amount'?money(num(row.data,key)):key==='status'?<StatusBadge tone={row.data.status==='INACTIVE'?'warning':'info'}>{str(row.data,key)}</StatusBadge>:str(row.data,key)})),{key:'actions',heading:'Actions',render:row=><div className="row-actions"><Button onClick={()=>setView(row)}>View</Button>{!(kind==='expense'&&row.data.status==='SETTLED')&&<Button onClick={()=>setEdit(row)}>Edit</Button>}{kind==='staff'&&<Button onClick={()=>void toggle(row)}>{row.data.status==='ACTIVE'?'Deactivate':'Activate'}</Button>}</div>}]}/>:<EmptyState title={`No ${config.title.toLowerCase()} yet`}><p>Add a record to get started.</p></EmptyState>}
    {edit&&<RecordEditor title={`${edit==='new'?'Add':'Edit'} ${config.singular}`} fields={config.fields} initial={initial} onClose={()=>setEdit(null)} onSave={data=>mutate(kind,kind==='expense'?{...data,shiftId:data.fromDrawer?currentShift(records)?.id||null:null}:data,`${kind.toUpperCase()}_${edit==='new'?'CREATED':'UPDATED'}`,edit==='new'?undefined:edit.id,edit==='new'?undefined:edit.revision)}/>}
    {view&&<div className="modal-backdrop"><section className="editor-modal" role="dialog" aria-label={`${config.singular} details`}><PageHeader title={str(view.data,'name',str(view.data,'description',config.singular))} action={<Button onClick={()=>setView(null)}>Close</Button>}/><dl className="details-list">{config.columns.map(([key,label])=><div key={key}><dt>{label}</dt><dd>{key==='amount'?money(num(view.data,key)):str(view.data,key)}</dd></div>)}</dl>{kind==='customer'&&<><h3>{customerSales.length} orders · {money(customerSales.reduce((sum,order)=>sum+order.totalPesewas,0))} lifetime spend</h3><p>Last visit: {customerSales[0]?new Date(customerSales[0].occurredAt).toLocaleString():'No visits yet'}</p>{customerSales.slice(0,10).map(order=><p key={order.id}>{order.receiptNo} · {money(order.totalPesewas)}</p>)}</>}</section></div>}
  </section>;
}
