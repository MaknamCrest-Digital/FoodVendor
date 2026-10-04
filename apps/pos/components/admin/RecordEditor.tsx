"use client";
import {useState} from 'react';
import {Button,Input} from '../ui/primitives';
import type {Data} from '../../src/types/admin';
import {useSettings} from '../settings/SettingsProvider';

export type Field={key:string;label:string;type?:'text'|'email'|'number'|'money'|'date'|'select'|'checkbox'|'textarea';options?:{value:string;label:string}[];required?:boolean;min?:number};
export function moneyInput(value:FormDataEntryValue|null){
  const text=String(value||'0').trim();
  if(!/^-?\d+(\.\d{1,2})?$/.test(text))throw new Error('Enter an amount with at most two decimal places.');
  const amount=Math.round(Number(text)*100);if(!Number.isSafeInteger(amount))throw new Error('Amount is too large.');return amount;
}
export default function RecordEditor({title,fields,initial={},onSave,onClose,children}:{title:string;fields:Field[];initial?:Data;onSave:(data:Data)=>Promise<void>;onClose:()=>void;children?:React.ReactNode}){
  const {settings}=useSettings();const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  return <div className="modal-backdrop"><section className="editor-modal" role="dialog" aria-modal="true" aria-label={title}><div className="receipt-title"><h2>{title}</h2><Button aria-label="Close form" onClick={onClose} disabled={busy}>×</Button></div><form onSubmit={async event=>{
    event.preventDefault();if(busy)return;setBusy(true);setError('');
    try{const form=new FormData(event.currentTarget);const data:Data={...initial};for(const field of fields){const value=form.get(field.key);data[field.key]=field.type==='checkbox'?value==='on':field.type==='money'?moneyInput(value):field.type==='number'?Number(value):String(value||'').trim();if(field.type==='number'&&!Number.isFinite(Number(data[field.key])))throw new Error('Enter a valid number.');}
      await onSave(data);onClose();
    }catch(error){setError(error instanceof Error?error.message:'Could not save this record.');}finally{setBusy(false);}
  }}><div className="form-grid">{fields.map(field=><label key={field.key} className={field.type==='checkbox'?'checkbox-field':''}>{field.label.replace('GH\u20b5',settings.general.currency)}{field.type==='select'?<select name={field.key} defaultValue={String(initial[field.key]??field.options?.[0]?.value??'')} required={field.required!==false}>{field.options?.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>:field.type==='textarea'?<textarea name={field.key} defaultValue={String(initial[field.key]||'')}/>:field.type==='checkbox'?<input name={field.key} type="checkbox" defaultChecked={Boolean(initial[field.key])}/>:<Input name={field.key} type={field.type==='money'?'number':field.type||'text'} step={field.type==='money'?'0.01':field.type==='number'?'0.001':undefined} min={field.min} required={field.required!==false} defaultValue={field.type==='money'?initial[field.key]===''?'':Number(initial[field.key]||0)/100:String(initial[field.key]??'')}/>}</label>)}</div>{children}{error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><Button onClick={onClose} type="button" disabled={busy}>Cancel</Button><Button type="submit" variant="primary" disabled={busy}>{busy?'Saving…':'Save'}</Button></div></form></section></div>;
}
