export type EntityKind='inventory'|'movement'|'supplier'|'purchase'|'expense'|'customer'|'staff'|'shift'|'cash'|'correction'|'workflow'|'payment'|'menu'|'category'|'stock'|'settings'|'device'|'hold'|'system';
export type Data=Record<string,unknown>;
export type Operation={id:string;businessId:string;locationId:string;actorId:string;entityId:string;kind:EntityKind;action:string;baseVersion:number;occurredAt:string;data:Data};
export type JournalEntry={eventId:string;orderId:string;attempts:number;createdAt:string;recordType:'operation';operation:Operation;synced:boolean;syncError?:string};
export type AdminRecord={id:string;kind:EntityKind;revision:number;data:Data;updatedAt:string;pending:boolean;error?:string};
export type PurchaseLine={itemId:string;quantity:number;unitCost:number};
export const str=(data:Data,key:string,fallback='')=>String(data[key]??fallback);
export const num=(data:Data,key:string,fallback=0)=>Number(data[key]??fallback);
export const lines=(data:Data)=>Array.isArray(data.items)?data.items as PurchaseLine[]:[];
