import {test,expect,type Page} from '@playwright/test';
import {user as testProfile} from './pilot-fixture';

const authEndpoint='**/auth/v1/token*';
const validUser={id:'d6545a1b-9255-4a17-97c9-e1b62f2a1f5f',aud:'authenticated',role:'authenticated',email:'owner@example.test',app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};

async function mockSupabaseLogin(page:Page,status=200){
  await page.route(authEndpoint,route=>{
    if(status!==200)return route.fulfill({status,json:{msg:status===400?'Invalid login credentials':'Auth request failed',code:'invalid_credentials'}});
    const expiresAt=Math.floor(Date.now()/1000)+3600;
    return route.fulfill({json:{access_token:'test-access-token',token_type:'bearer',expires_in:3600,expires_at:expiresAt,refresh_token:'test-refresh-token',user:validUser}});
  });
  await page.route('**/auth/v1/logout*',route=>route.fulfill({status:204,body:''}));
}

async function submitLogin(page:Page){
  await page.getByLabel('USERNAME OR EMAIL',{exact:true}).fill('owner@example.test');
  await page.getByLabel('PASSWORD',{exact:true}).fill('password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
}

test('Maknam login fits desktop, tablet and mobile with accessible controls',async({page})=>{
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/login/');
  await expect(page).toHaveTitle('Sign in | Maknam POS');
  await expect(page.getByRole('heading',{name:'Maknam POS'})).toBeVisible();
  await expect(page.getByLabel('USERNAME OR EMAIL',{exact:true})).toBeEmpty();
  await expect(page.getByLabel('PASSWORD',{exact:true})).toHaveAttribute('type','password');
  await page.getByLabel('PASSWORD',{exact:true}).fill('visible-test');
  await page.getByRole('button',{name:'Show password'}).click();
  await expect(page.getByLabel('PASSWORD',{exact:true})).toHaveAttribute('type','text');
  await page.getByRole('button',{name:'Hide password'}).click();
  await expect(page.getByLabel('PASSWORD',{exact:true})).toHaveAttribute('type','password');
  await page.getByLabel('PASSWORD',{exact:true}).fill('');
  await page.getByRole('heading',{name:'Maknam POS'}).click();
  for(const [width,height] of [[1440,900],[1024,768],[768,1024],[390,844],[320,640],[844,390]]){
    await page.setViewportSize({width,height});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`).toBe(true);
    const form=await page.getByRole('form',{name:'Sign in'}).boundingBox();
    expect(form!.width).toBeLessThanOrEqual(420);
    expect((await page.getByRole('button',{name:'Sign in',exact:true}).boundingBox())!.height).toBeGreaterThanOrEqual(48);
  }
  await page.setViewportSize({width:1440,height:900});
  await page.screenshot({path:'test-results/maknam-login-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'test-results/maknam-login-mobile.png',fullPage:true});
  await expect(page.locator('body')).not.toContainText(/AxelleMD|SPR|patient|facility|procedure|medical|healthcare|Google|Create an account/i);
  expect(errors).toEqual([]);
});

test('field validation blocks invalid submissions and keyboard navigation works',async({page})=>{
  let requests=0;
  await page.route(authEndpoint,route=>{requests++;return route.abort();});
  await page.goto('/login/');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByText('Enter a valid email address or a demo username.')).toBeVisible();
  await expect(page.getByText('Password is required.')).toBeVisible();
  await expect(page.getByLabel('USERNAME OR EMAIL',{exact:true})).toBeFocused();
  await page.getByLabel('USERNAME OR EMAIL',{exact:true}).fill('invalid');
  await page.getByLabel('PASSWORD',{exact:true}).fill('password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByText('Enter a valid email address or a demo username.')).toBeVisible();
  expect(requests).toBe(0);
  await page.getByLabel('USERNAME OR EMAIL',{exact:true}).fill('owner@example.test');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('PASSWORD',{exact:true})).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button',{name:'Show password'})).toBeFocused();
});

for(const [status,message] of [[400,'Incorrect email or password.'],[429,'Too many sign-in attempts. Please try again later.'],[500,'Unable to connect to the server. Check your connection and try again.']] as const){
  test(`safe Supabase Auth error for HTTP ${status}`,async({page})=>{
    await mockSupabaseLogin(page,status);
    await page.goto('/login/');
    await submitLogin(page);
    await expect(page.getByRole('form',{name:'Sign in'}).getByRole('alert')).toHaveText(message);
    await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeEnabled();
    await expect(page.locator('body')).not.toContainText('Auth request failed');
    expect(await page.evaluate(()=>localStorage.getItem('food-vendor-admin-session'))).toBeNull();
  });
}

test('unlinked local account is rejected after Supabase authentication',async({page})=>{
  await mockSupabaseLogin(page);
  await page.route('**/api/v1/auth/me',route=>route.fulfill({status:401,json:{detail:'Internal identity details'}}));
  await page.goto('/login/');
  await submitLogin(page);
  await expect(page.getByRole('form',{name:'Sign in'}).getByRole('alert')).toContainText('This account has not been linked or is disabled.');
  await expect(page.locator('body')).not.toContainText('Internal identity details');
  expect(await page.evaluate(()=>localStorage.getItem('food-vendor-admin-session'))).toBeNull();
});

test('Supabase sign-in obtains a FastAPI profile and persists the POS session',async({page})=>{
  await mockSupabaseLogin(page);
  let loginEmail='';
  page.on('request',request=>{if(request.url().includes('/auth/v1/token'))loginEmail=JSON.parse(request.postData()||'{}').email;});
  await page.route('**/api/v1/auth/me',route=>route.fulfill({json:testProfile}));
  await page.route('**/auth/v1/logout*',route=>route.fulfill({status:204,body:''}));
  await page.goto('/login/');
  await page.getByLabel('USERNAME OR EMAIL',{exact:true}).fill('demo-admin');
  await page.getByLabel('PASSWORD',{exact:true}).fill('password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page).toHaveURL('http://localhost:5174/');
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  expect(loginEmail).toBe('demo-admin@demo.maknam.invalid');
  const cached=await page.evaluate(()=>JSON.parse(localStorage.getItem('food-vendor-admin-session')||'null'));
  expect(cached.user.id).toBe(testProfile.id);
  expect(cached.token).toBe('test-access-token');
  await page.reload();
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Sign Out',exact:true}).click();
  await expect(page).toHaveURL(/\/login\/$/);
});


test('demo cashier alias logs in with cashier-only local permissions',async({page})=>{
  const cashier={...testProfile,id:'demo-cashier-user',name:'Demo Cashier',role:'CASHIER',roleName:'Cashier',permissions:['dashboard.view','dashboard.shift_status.view','dashboard.sync_status.view','pos.view','pos.sale.create','pos.receipt.reprint','sales.view_own','shifts.open','shifts.view_own','shifts.close_own','settings.appearance','settings.about','devices.view']};
  await mockSupabaseLogin(page);
  let loginEmail='';
  page.on('request',request=>{if(request.url().includes('/auth/v1/token'))loginEmail=JSON.parse(request.postData()||'{}').email;});
  await page.route('**/api/v1/auth/me',route=>route.fulfill({json:cashier}));
  await page.goto('/login/');
  await page.getByLabel('USERNAME OR EMAIL',{exact:true}).fill('demo-cashier');
  await page.getByLabel('PASSWORD',{exact:true}).fill('password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page).toHaveURL('http://localhost:5174/');
  expect(loginEmail).toBe('demo-cashier@demo.maknam.invalid');
  const cached=await page.evaluate(()=>JSON.parse(localStorage.getItem('food-vendor-admin-session')||'null'));
  expect(cached.user.role).toBe('CASHIER');
  expect(cached.user.permissions).not.toContain('roles.manage');
  await page.getByRole('button',{name:'Sign Out',exact:true}).click();
});

test('network failure and password reset use Supabase Auth',async({page})=>{
  await page.route(authEndpoint,route=>route.abort());
  await page.route('**/auth/v1/recover*',route=>route.fulfill({status:200,json:{}}));
  await page.goto('/login/');
  await submitLogin(page);
  await expect(page.getByRole('form',{name:'Sign in'}).getByRole('alert')).toContainText('Unable to connect to the server.');
  await page.getByRole('link',{name:'Forgot password?'}).click();
  await expect(page).toHaveURL(/\/forgot-password\/$/);
  await page.getByLabel('Email').fill('owner@example.test');
  await page.getByRole('button',{name:'Send reset link'}).click();
  await expect(page.getByText(/Supabase will send a password reset link/)).toBeVisible();
  await page.getByRole('link',{name:'Back to sign in'}).click();
  await expect(page).toHaveURL(/\/login\/$/);
});


test('first-time sign-in clearly requires connectivity',async({page,context})=>{
  await page.goto('/login/');
  await context.setOffline(true);
  await page.getByLabel('USERNAME OR EMAIL',{exact:true}).fill('demo-admin');
  await page.getByLabel('PASSWORD',{exact:true}).fill('offline-test-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('form',{name:'Sign in'}).getByRole('alert')).toContainText('First-time sign-in requires an internet connection.');
  expect(await page.evaluate(()=>localStorage.getItem('food-vendor-admin-session'))).toBeNull();
});

test('duplicate submissions are blocked while Supabase Auth responds',async({page})=>{
  let requests=0;
  let release:()=>void=()=>{};
  const waiting=new Promise<void>(resolve=>{release=resolve;});
  await page.route(authEndpoint,async route=>{requests++;await waiting;await route.fulfill({status:400,json:{msg:'Invalid login credentials'}});});
  await page.goto('/login/');
  await page.getByLabel('USERNAME OR EMAIL',{exact:true}).fill('owner@example.test');
  await page.getByLabel('PASSWORD',{exact:true}).fill('password');
  await page.getByRole('form',{name:'Sign in'}).evaluate((form:HTMLFormElement)=>{form.requestSubmit();form.requestSubmit();});
  await expect(page.getByRole('button',{name:'Signing in...'})).toBeDisabled();
  await expect.poll(()=>requests).toBe(1);
  release();
  await expect(page.getByRole('form',{name:'Sign in'}).getByRole('alert')).toContainText('Incorrect email or password.');
});

test('real Supabase sign-in opens dashboard, survives reload and signs out',async({page})=>{
  test.skip(!process.env.E2E_LOGIN_EMAIL||!process.env.E2E_LOGIN_PASSWORD,'Supply controlled Supabase credentials and an explicitly linked test account for this live check.');
  await page.goto('/login/');
  await page.getByLabel('USERNAME OR EMAIL',{exact:true}).fill(process.env.E2E_LOGIN_EMAIL!);
  await page.getByLabel('PASSWORD',{exact:true}).fill(process.env.E2E_LOGIN_PASSWORD!);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page).toHaveURL('http://localhost:5174/');
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Sign Out',exact:true}).click();
  await expect(page).toHaveURL(/\/login\/$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login\/$/);
});
