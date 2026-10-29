"use client";
import {useEffect,useState} from 'react';
import {Plus,UserPlus} from 'lucide-react';
import {api} from '../../src/lib/api';
import {can} from '../../src/lib/access';
import {groupPermissions,permissionLabel} from '../../src/lib/permissionLabels';
import {Button,StatusBadge} from '../ui/primitives';
import Dialog from '../ui/Dialog';
type Role={id:string;name:string;template:string;permissions:string[]};
type Member={id:string;name:string;email:string;supabaseUserId:string|null;linked?:boolean;roleId:string;active:boolean;lastActive:string|null;permissions:string[];overrides:Record<string,string>};
type Team={roles:Role[];members:Member[];permissions:string[]};
const initials=(name:string)=>name.split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]?.toUpperCase()).join('')||'?';

export default function TeamAccess(){
 const [team,setTeam]=useState<Team|null>(null);const [error,setError]=useState('');const [notice,setNotice]=useState('');const [busy,setBusy]=useState(false);const [member,setMember]=useState<Member|null>(null);const [role,setRole]=useState<Role|null>(null);
 async function load(){try{setTeam(await api<Team>('/team'));setError('');}catch(e){setError((e as Error).message);}}
 useEffect(()=>{let active=true;void api<Team>('/team').then(value=>{if(active)setTeam(value);}).catch(e=>{if(active)setError((e as Error).message);});return()=>{active=false;};},[]);
 async function save(){if(busy)return;setBusy(true);setError('');try{
  if(member){if(member.id)await api(`/team/${member.id}`,'PUT',{name:member.name,roleId:member.roleId,active:member.active,overrides:member.overrides,supabaseUserId:member.supabaseUserId||null});else await api('/team','POST',{name:member.name,email:member.email,supabaseUserId:member.supabaseUserId,roleId:member.roleId});}
  if(role)await api(role.id?`/team/roles/${role.id}`:'/team/roles',role.id?'PUT':'POST',{name:role.name,permissions:role.permissions});
  setMember(null);setRole(null);setNotice('Access saved. Connected sessions refresh permissions within 30 seconds.');await load();
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const groups=team?groupPermissions(team.permissions):[];
 const total=team?.permissions.length||0;
 const setRolePermissions=(keys:string[],on:boolean)=>role&&setRole({...role,permissions:on?[...new Set([...role.permissions,...keys])]:role.permissions.filter(key=>!keys.includes(key))});

 return <section className="team-access">
  <header className="team-access-head"><div className="settings-section-head"><h2>Team & access</h2><p>Manage restaurant accounts linked to Supabase Auth, and what each role can do.</p></div>{can('team.create')&&can('roles.manage')&&<Button variant="primary" onClick={()=>{setError('');setMember({id:'',name:'',email:'',supabaseUserId:'',roleId:team?.roles.find(r=>r.template==='CASHIER')?.id||'',active:true,lastActive:null,permissions:[],overrides:{}});}}><UserPlus size={18} aria-hidden="true"/>Add user</Button>}</header>
  {error&&!member&&!role&&<p role="alert" className="form-error">{error}</p>}{notice&&<p role="status" className="devices-message">{notice}</p>}
  {!team?<Button onClick={()=>void load()}>Retry loading team</Button>:<>
   <h3 className="team-section-title">People <span>{team.members.length}</span></h3>
   <ul className="team-members">{team.members.map(user=><li key={user.id}>
    <span className="team-avatar" aria-hidden="true">{initials(user.name)}</span>
    <span className="team-member-text"><strong>{user.name}</strong><small>{user.email}</small></span>
    <span className="team-member-badges"><StatusBadge tone="info">{team.roles.find(r=>r.id===user.roleId)?.name||'No role'}</StatusBadge><StatusBadge tone={user.active?'success':'danger'} dot>{user.active?'Active':'Disabled'}</StatusBadge><StatusBadge tone={user.linked?'success':'warning'}>{user.linked?'Supabase linked':'Not linked'}</StatusBadge></span>
    {can('team.edit')&&<Button onClick={()=>{setError('');setMember(structuredClone(user));}}>Edit access</Button>}
   </li>)}</ul>
   <h3 className="team-section-title">Roles <span>{team.roles.length}</span></h3>
   <div className="team-roles">{team.roles.map(row=><article key={row.id} className="team-role">
    <div className="team-role-head"><strong>{row.name}</strong><small>{row.template==='CUSTOM'?'Custom':'Built-in'}</small></div>
    <div className="team-role-meter" aria-hidden="true"><i style={{width:`${total?Math.round(row.permissions.length/total*100):0}%`}}/></div>
    <small>{row.permissions.length} of {total} permissions</small>
    {can('roles.manage')&&<Button onClick={()=>{setError('');setRole(structuredClone(row));}}>Edit role</Button>}
   </article>)}
   {can('roles.manage')&&<button type="button" className="team-role team-role-new" onClick={()=>{setError('');setRole({id:'',name:'',template:'CUSTOM',permissions:[]});}}><Plus size={22} aria-hidden="true"/>Create custom role</button>}</div>
  </>}
  {member&&team&&<Dialog title={member.id?'Edit user access':'Add user'} onClose={()=>setMember(null)} busy={busy} wide><form onSubmit={e=>{e.preventDefault();void save();}} className="owner-form team-form">
   <div className="form-grid">
    <label>Name<input required value={member.name} onChange={e=>setMember({...member,name:e.target.value})}/></label>
    <label>Email<input type="email" required disabled={!!member.id} value={member.email} onChange={e=>setMember({...member,email:e.target.value})}/></label>
    <label>Role<select disabled={!can('roles.manage')} value={member.roleId} onChange={e=>setMember({...member,roleId:e.target.value})}>{team.roles.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
    <label>Supabase Auth user ID<input required={!member.id} disabled={!can('roles.manage')} value={member.supabaseUserId||''} onChange={e=>setMember({...member,supabaseUserId:e.target.value.trim()||null})}/></label>
   </div>
   <small>Create the user in Supabase Auth first, then paste its UUID here. Accounts are never linked by email.</small>
   {member.id&&<label className="setting-toggle"><span className="setting-toggle-text"><span>Active account</span><small>Disabled users cannot sign in.</small></span><input type="checkbox" role="switch" disabled={!can('team.deactivate')} checked={member.active} onChange={e=>setMember({...member,active:e.target.checked})}/></label>}
   {member.id&&can('roles.manage')&&<fieldset className="settings-group"><legend>Permission overrides</legend><p className="settings-group-hint">Inherit uses the selected role. Allow or Deny changes this user only.</p>
    <div className="permission-groups">{groups.map(({group,label,keys})=>{const changed=keys.filter(key=>(member.overrides[key]||'INHERIT')!=='INHERIT').length;return <details key={group} className="permission-group"><summary><span>{label}</span>{changed>0&&<small className="permission-count">{changed} changed</small>}</summary><div className="permission-list">{keys.map(key=>{const inherited=team.roles.find(r=>r.id===member.roleId)?.permissions.includes(key);const override=member.overrides[key]||'INHERIT';const allowed=override==='ALLOW'||(override==='INHERIT'&&inherited);return <label className="permission-row" key={key}><span className="setting-toggle-text"><span>{permissionLabel(key)}</span><small>{key} · {allowed?'Allowed':'Denied'}</small></span><select value={override} onChange={e=>setMember({...member,overrides:{...member.overrides,[key]:e.target.value}})}><option value="INHERIT">Inherit</option><option value="ALLOW">Allow</option><option value="DENY">Deny</option></select></label>;})}</div></details>;})}</div>
   </fieldset>}
   {error&&<p role="alert" className="form-error">{error}</p>}
   <div className="form-actions"><Button type="button" onClick={()=>setMember(null)} disabled={busy}>Cancel</Button><Button variant="primary" disabled={busy}>{busy?'Saving…':'Save user'}</Button></div>
  </form></Dialog>}
  {role&&team&&<Dialog title={role.id?'Edit role':'Create role'} onClose={()=>setRole(null)} busy={busy} wide><form onSubmit={e=>{e.preventDefault();void save();}} className="owner-form team-form">
   <label>Role name<input required value={role.name} onChange={e=>setRole({...role,name:e.target.value})}/></label>
   <p className="settings-group-hint">{role.permissions.length} of {total} permissions selected. Open a section to change it.</p>
   <div className="permission-groups">{groups.map(({group,label,keys})=>{const on=keys.filter(key=>role.permissions.includes(key)).length;return <details key={group} className="permission-group"><summary><span>{label}</span><small className={`permission-count${on===keys.length?' is-all':on===0?' is-none':''}`}>{on} of {keys.length}</small></summary>
    <div className="permission-group-actions"><button type="button" disabled={on===keys.length} onClick={()=>setRolePermissions(keys,true)}>Select all</button><button type="button" disabled={on===0} onClick={()=>setRolePermissions(keys,false)}>Clear</button></div>
    <div className="permission-list">{keys.map(key=><label className="setting-toggle" key={key}><span className="setting-toggle-text"><span>{permissionLabel(key)}</span><small>{key}</small></span><input type="checkbox" role="switch" checked={role.permissions.includes(key)} onChange={e=>setRolePermissions([key],e.target.checked)}/></label>)}</div>
   </details>;})}</div>
   {error&&<p role="alert" className="form-error">{error}</p>}
   <div className="form-actions"><Button type="button" onClick={()=>setRole(null)} disabled={busy}>Cancel</Button><Button variant="primary" disabled={busy}>{busy?'Saving…':'Save role'}</Button></div>
  </form></Dialog>}
 </section>;
}
