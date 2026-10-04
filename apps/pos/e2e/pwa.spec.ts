import {test,expect} from '@playwright/test';
import {pilot,savedOrders} from './pilot-fixture';

test('manifest and icons make the app installable',async({page,request})=>{
  await page.goto('/login/');
  expect(await page.locator('link[rel="manifest"]').getAttribute('href')).toBe('/manifest.webmanifest');
  const manifest=await (await request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({name:'Maknam POS',short_name:'Maknam POS',description:'Offline-first POS for food vendors.',display:'standalone',start_url:'/pos/',scope:'/'});
  for(const [src,size] of [['/icons/icon-192.png',192],['/icons/icon-512.png',512],['/icons/icon-maskable-512.png',512]] as const){
    expect(manifest.icons.some((icon:{src:string;sizes:string})=>icon.src===src&&icon.sizes===`${size}x${size}`)).toBe(true);
    const png=await (await request.get(src)).body();
    expect([png.readUInt32BE(16),png.readUInt32BE(20)]).toEqual([size,size]);
  }
});

test('install offer appears only when the browser offers it and stays dismissed',async({page})=>{
  await pilot(page);await page.goto('/pos/');
  await expect(page.locator('.admin-header')).toContainText('Synced');
  await expect(page.getByRole('button',{name:'Install Maknam POS'})).toHaveCount(0);
  // Browsers may fire the offer before the header has mounted.
  await page.addInitScript(()=>addEventListener('load',()=>{const e=new Event('beforeinstallprompt',{cancelable:true});Object.assign(e,{prompt:async()=>{},userChoice:Promise.resolve({outcome:'dismissed'})});dispatchEvent(e);}));
  await page.reload();
  await expect(page.getByRole('button',{name:'Install Maknam POS'})).toBeVisible();
  await page.getByRole('button',{name:'Not now'}).click();
  await expect(page.getByRole('button',{name:'Install Maknam POS'})).toHaveCount(0);
  await page.reload();await expect(page.locator('.admin-header')).toContainText('Synced');
  await expect(page.getByRole('button',{name:'Install Maknam POS'})).toHaveCount(0);
});

test('header shows Synced, Local mode offline, then Synced after reconnecting',async({page,context})=>{
  await pilot(page);await page.goto('/pos/');
  const header=page.locator('.admin-header');
  await expect(header).toContainText('Online');await expect(header).toContainText('Synced');
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await expect(header).toContainText('Offline');await expect(header).toContainText('Local mode');
  await page.getByRole('button',{name:/Fried Pork/}).click();await page.getByRole('button',{name:/Complete sale/}).click();await page.getByRole('button',{name:/Payment received/}).click();
  await page.getByRole('button',{name:'Done · New order'}).click();
  await expect(header).toContainText('Local mode');expect(await savedOrders(page)).toHaveLength(1);
  await context.setOffline(false);
  await expect(header).toContainText('Synced',{timeout:30000});
  expect((await savedOrders(page))[0].syncStatus).toBe('SYNCED');
});
