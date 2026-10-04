"use client";
import {useEffect,useRef,type ReactNode} from 'react';
import {X} from 'lucide-react';
import {Button} from './primitives';
export default function Dialog({title,onClose,children,busy=false,wide=false}:{title:string;onClose:()=>void;children:ReactNode;busy?:boolean;wide?:boolean}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const dialog=ref.current!;dialog.showModal();return()=>dialog.close();},[]);
  return <dialog ref={ref} className={`owner-dialog ${wide?'owner-dialog-wide':''}`} aria-label={title} onCancel={event=>{event.preventDefault();if(!busy)onClose();}} onClick={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}>
    <div className="owner-dialog-inner"><div className="owner-dialog-heading"><h2>{title}</h2><Button type="button" variant="quiet" aria-label={`Close ${title}`} onClick={onClose} disabled={busy}><X size={20}/></Button></div>{children}</div>
  </dialog>;
}
