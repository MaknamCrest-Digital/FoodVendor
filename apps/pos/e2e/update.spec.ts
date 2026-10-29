import {test,expect,type Page} from '@playwright/test';
import {appendFile,readFile,writeFile} from 'node:fs/promises';
import {pilot,savedOrders} from './pilot-fixture';

// The preview server reads out/ on every request, so changing sw.js publishes a new release.
const SW='out/sw.js';
async function withNewRelease(run:()=>Promise<void>){
 const original=await readFile(SW);
 try{await appendFile(SW,`\n// next release ${Date.now()}\n`);await run();}
 finally{await writeFile(SW,original);}
}
// Retries across the app's own navigations until a service worker controls the page.
const controlled=(page:Page)=>expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller).catch(()=>false),{timeout:20000}).toBe(true);
const checkForUpdate=(page:Page)=>page.evaluate(async()=>{await (await navigator.serviceWorker.getRegistration())?.update();});
const waitingWorker=(page:Page)=>page.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration())?.waiting);

test('a signed-in till shows New update available and updates only when Update is tapped',async({page})=>{
 await pilot(page);await page.goto('/pos/');await expect(page.locator('.admin-header')).toContainText('Synced');await controlled(page);
 await page.getByRole('button',{name:/Fried Pork/}).click();await page.getByRole('button',{name:/Complete sale/}).click();await page.getByRole('button',{name:/Payment received/}).click();
 await page.getByRole('button',{name:'Done · New order'}).click();
 await withNewRelease(async()=>{
  await checkForUpdate(page);
  const banner=page.getByRole('status',{name:'New update available'});
  await expect(banner).toBeVisible();
  // Not applied on its own: the new version keeps waiting while someone is signed in.
  await page.waitForTimeout(500);
  expect(await waitingWorker(page)).toBe(true);
  await page.evaluate(()=>{(window as unknown as {beforeUpdate:boolean}).beforeUpdate=true;});
  await banner.getByRole('button',{name:'Update',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>!(window as unknown as {beforeUpdate?:boolean}).beforeUpdate).catch(()=>false)).toBe(true);
  await controlled(page);
  expect(await waitingWorker(page)).toBe(false);
  await expect(page.getByRole('status',{name:'New update available'})).toHaveCount(0);
 });
 expect(await savedOrders(page)).toHaveLength(1);
});

test('the sign-in screen applies a new version straight away',async({page})=>{
 await page.goto('/login/');await expect(page.getByRole('button',{name:'Sign in'})).toBeVisible();await controlled(page);
 await withNewRelease(async()=>{
  await page.evaluate(()=>{(window as unknown as {beforeUpdate:boolean}).beforeUpdate=true;});
  await checkForUpdate(page);
  await expect.poll(()=>page.evaluate(()=>!(window as unknown as {beforeUpdate?:boolean}).beforeUpdate).catch(()=>false),{timeout:15000}).toBe(true);
  await controlled(page);
  expect(await waitingWorker(page)).toBe(false);
 });
});

test('a release found while the app is opening still shows New update available',async({page})=>{
 await pilot(page);await page.goto('/pos/');await expect(page.locator('.admin-header')).toContainText('Synced');await controlled(page);
 await withNewRelease(async()=>{
  // Reopening the installed app: the browser finds the release during navigation,
  // often before the page has hydrated and started listening for it.
  await page.reload();
  await expect(page.getByRole('status',{name:'New update available'})).toBeVisible({timeout:15000});
 });
});
