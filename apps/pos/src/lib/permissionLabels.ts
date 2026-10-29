// Plain-language names for permission keys shown in Team & Access. The keys themselves
// are the server contract and are never changed here.
const GROUPS:Array<[string,string]>=[
  ['dashboard','Dashboard'],['pos','Point of sale'],['sales','Sales'],['orders','Orders'],['kitchen','Kitchen'],
  ['menu','Menu'],['inventory','Inventory'],['purchases','Purchases'],['expenses','Expenses'],['customers','Customers'],
  ['shifts','Shifts'],['reports','Reports'],['team','Team'],['roles','Roles'],['audit','Audit log'],
  ['settings','Settings'],['devices','Devices & printers'],
];

const LABELS:Record<string,string>={
  'dashboard.view':'Open the dashboard','dashboard.sales_summary.view':'See sales summary','dashboard.payment_breakdown.view':'See payment breakdown',
  'dashboard.expenses.view':'See expenses','dashboard.cash_position.view':'See cash position','dashboard.stock_alerts.view':'See stock alerts',
  'dashboard.sync_status.view':'See sync status','dashboard.shift_status.view':'See shift status',
  'pos.view':'Open the POS','pos.sale.create':'Make sales and print receipts','pos.discount.apply':'Apply discounts','pos.price_override':'Override prices',
  'pos.receipt.reprint':'Reprint receipts',
  'sales.view_own':'See own sales','sales.view_all':'See all sales','sales.refund':'Refund sales','sales.void':'Void sales',
  'orders.view':'See orders','orders.manage':'Manage orders','kitchen.view':'Open the kitchen screen','kitchen.manage':'Update kitchen orders',
  'menu.view':'See the menu','menu.create':'Add menu items','menu.edit':'Edit menu items','menu.price.edit':'Change prices','menu.availability.edit':'Mark items available or sold out',
  'inventory.view':'See stock','inventory.stock.add':'Add stock','inventory.stock.remove':'Remove stock','inventory.stock.adjust':'Adjust stock counts',
  'inventory.movements.view':'See stock movements',
  'purchases.view':'See purchases','purchases.create':'Create purchases','purchases.receive':'Receive purchases',
  'expenses.view':'See expenses','expenses.create':'Record expenses','expenses.edit':'Edit expenses',
  'customers.view':'See customers','customers.create':'Add customers','customers.edit':'Edit customers',
  'shifts.open':'Open shifts','shifts.view_own':'See own shifts','shifts.view_all':'See all shifts','shifts.close_own':'Close own shifts','shifts.close_any':'Close any shift',
  'reports.view':'See reports','reports.export':'Export reports',
  'team.view':'See the team','team.create':'Add users','team.edit':'Edit users','team.deactivate':'Disable users','roles.manage':'Manage roles and permissions',
  'audit.view':'See the audit log',
  'settings.general':'Business settings','settings.appearance':'Own appearance','settings.payments':'Payment settings','settings.receipts':'Receipt settings',
  'settings.pos':'POS rules','settings.team_access':'Team access settings','settings.sync':'Sync settings','settings.about':'About this app',
  'devices.view':'See devices and test printers','devices.manage':'Set up printers and transfer data',
};

const humanize=(text:string)=>{const words=text.replace(/[._]/g,' ').trim();return words.charAt(0).toUpperCase()+words.slice(1);};

export const permissionGroup=(key:string)=>key.split('.')[0];
export const groupLabel=(group:string)=>GROUPS.find(([id])=>id===group)?.[1]??humanize(group);
export const permissionLabel=(key:string)=>LABELS[key]??humanize(key.split('.').slice(1).join(' '));

// Groups in a fixed, task-oriented order; groups the server adds later go last.
export function groupPermissions(keys:string[]){
  const order=(group:string)=>{const index=GROUPS.findIndex(([id])=>id===group);return index<0?GROUPS.length:index;};
  const groups=[...new Set(keys.map(permissionGroup))].sort((a,b)=>order(a)-order(b)||a.localeCompare(b));
  return groups.map(group=>({group,label:groupLabel(group),keys:keys.filter(key=>permissionGroup(key)===group)}));
}
