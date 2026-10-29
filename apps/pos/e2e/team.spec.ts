import {test,expect,type Page} from '@playwright/test';
import {permissions,pilot} from './pilot-fixture';

const cashierPermissions=['dashboard.view','pos.view','pos.sale.create','pos.receipt.reprint','devices.view'];
const team={
 permissions,
 roles:[
  {id:'role-owner',name:'Owner',template:'OWNER',permissions},
  {id:'role-manager',name:'Manager',template:'MANAGER',permissions:permissions.filter(key=>!['roles.manage','settings.team_access','team.deactivate'].includes(key))},
  {id:'role-cashier',name:'Cashier',template:'CASHIER',permissions:cashierPermissions},
 ],
 members:[
  {id:'u1',name:'Adonai Admin',email:'admin@example.test',supabaseUserId:'a',linked:true,roleId:'role-owner',active:true,lastActive:null,permissions,overrides:{}},
  {id:'u2',name:'Adonai Cashier',email:'cashier@example.test',supabaseUserId:null,linked:false,roleId:'role-cashier',active:false,lastActive:null,permissions:cashierPermissions,overrides:{}},
 ],
};

// Registered after pilot(), so these handlers take precedence for the team endpoints.
async function mockTeam(page:Page,saved:Array<{url:string;body:unknown}>){
 await page.route('**/api/v1/team**',async route=>{
  const request=route.request();
  if(request.method()==='GET')return route.fulfill({json:team});
  saved.push({url:new URL(request.url()).pathname,body:request.postDataJSON()});
  return route.fulfill({json:{}});
 });
}

test('team access shows people and roles, and the role editor uses plain permission names',async({page})=>{
 const saved:Array<{url:string;body:unknown}>=[];
 await pilot(page);await mockTeam(page,saved);
 await page.goto('/settings/');
 await page.getByRole('button',{name:'Team & Access',exact:true}).click();
 const people=page.locator('.team-members li');
 await expect(people).toHaveCount(2);
 await expect(people.nth(0)).toContainText('Owner');await expect(people.nth(0)).toContainText('Active');await expect(people.nth(0)).toContainText('Supabase linked');
 await expect(people.nth(1)).toContainText('Disabled');await expect(people.nth(1)).toContainText('Not linked');
 await expect(page.locator('.team-role',{hasText:'Cashier'})).toContainText(`5 of ${permissions.length} permissions`);

 await page.locator('.team-role',{hasText:'Manager'}).getByRole('button',{name:'Edit role'}).click();
 const dialog=page.getByRole('dialog',{name:'Edit role'});
 const inventory=dialog.locator('details',{hasText:'Inventory'});
 await expect(inventory.locator('summary')).toContainText('5 of 5');
 await inventory.locator('summary').click();
 await expect(inventory.getByRole('switch',{name:/Add stock/})).toBeChecked();
 await inventory.getByRole('button',{name:'Clear'}).click();
 await expect(inventory.locator('summary')).toContainText('0 of 5');
 await dialog.getByRole('button',{name:'Save role'}).click();
 await expect(page.getByText('Access saved.')).toBeVisible();
 expect(saved).toHaveLength(1);
 const body=saved[0].body as {name:string;permissions:string[]};
 expect(saved[0].url).toMatch(/\/team\/roles\/role-manager$/);
 expect(body.name).toBe('Manager');
 expect(body.permissions.filter(key=>key.startsWith('inventory.'))).toEqual([]);
 expect(body.permissions).toContain('pos.sale.create');
});
