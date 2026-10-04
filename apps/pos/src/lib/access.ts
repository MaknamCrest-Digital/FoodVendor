import {readSession,requireUser,type AdminUser} from './auth';
export function can(permission:string,user:AdminUser|null|undefined=readSession()?.user){return !!user?.permissions?.includes(permission);}
export function requirePermission(permission:string){if(!can(permission,requireUser()))throw new Error('You do not have permission for this action.');}
const routes:Record<string,string[]>={
 '/':['dashboard.view'],'/pos':['pos.view'],'/sales':['sales.view_all','sales.view_own'],
 '/menu':['menu.view'],'/inventory':['inventory.view'],'/shifts':['shifts.view_all','shifts.view_own'],
 '/expenses':['expenses.view'],'/purchases':['purchases.view'],'/customers':['customers.view'],
 '/staff':['team.view'],'/reports':['reports.view'],'/audit':['audit.view'],
 '/devices':['devices.view'],'/orders':['orders.view'],'/kitchen':['kitchen.view'],
 '/settings':['settings.general','settings.appearance','settings.payments','settings.receipts','settings.pos','settings.team_access','settings.sync','settings.about'],
};
export function routeAllowed(path:string,user?:AdminUser){return (routes[path.replace(/\/$/,'')||'/']||[]).some(key=>can(key,user));}
