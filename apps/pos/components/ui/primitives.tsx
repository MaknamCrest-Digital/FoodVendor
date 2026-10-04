import type {ButtonHTMLAttributes, InputHTMLAttributes, ReactNode} from 'react';

export function Button({variant='secondary',className='',...props}:ButtonHTMLAttributes<HTMLButtonElement>&{variant?:'primary'|'secondary'|'danger'|'quiet'}){
  return <button className={`ui-button ui-button--${variant} ${className}`} {...props}/>;
}
export function Card({children,className=''}:{children:ReactNode;className?:string}){
  return <div className={`ui-card ${className}`}>{children}</div>;
}
export function MetricCard({label,value}:{label:string;value:ReactNode}){
  return <Card className="metric-card"><span>{label}</span><strong>{value}</strong></Card>;
}
export type StatusTone='success'|'warning'|'danger'|'info';
export function StatusBadge({children,tone='info',className='',dot=false}:{children:ReactNode;tone?:StatusTone;className?:string;dot?:boolean}){
  return <span className={`badge status-${tone} ${className}`}>{dot&&<i aria-hidden="true"/>}{children}</span>;
}
export function Input({className='',...props}:InputHTMLAttributes<HTMLInputElement>){
  return <input className={`ui-input ${className}`} {...props}/>;
}
export function EmptyState({title,children}:{title:string;children?:ReactNode}){
  return <div className="empty-state"><h3>{title}</h3>{children}</div>;
}
export function PageHeader({title,description,eyebrow,action}:{title:string;description?:string;eyebrow?:string;action?:ReactNode}){
  return <div className="section-heading"><div>{eyebrow&&<span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2>{description&&<p>{description}</p>}</div>{action}</div>;
}
export type TableColumn<T>={key:string;heading:string;render:(row:T)=>ReactNode};
export function DataTable<T>({columns,rows,rowKey,label}:{columns:TableColumn<T>[];rows:T[];rowKey:(row:T)=>string;label:string}){
  return <div className="data-table-wrap"><table className="data-table" aria-label={label}><thead><tr>{columns.map(column=><th scope="col" key={column.key}>{column.heading}</th>)}</tr></thead><tbody>{rows.map(row=><tr className="sale-row" key={rowKey(row)}>{columns.map(column=><td key={column.key}>{column.render(row)}</td>)}</tr>)}</tbody></table></div>;
}
