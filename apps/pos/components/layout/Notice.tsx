"use client";
import {usePos} from '../pos/PosProvider';
export default function Notice(){
  const {notice,setNotice}=usePos();
  const tone=/failed|not saved|unavailable|could not/i.test(notice)?'danger':/sale saved|reprint logged/i.test(notice)?'success':'info';
  return notice?<div className={`notice status-${tone}`} role="status"><span>{notice}</span><button aria-label="Dismiss message" onClick={()=>setNotice('')}>×</button></div>:null;
}
