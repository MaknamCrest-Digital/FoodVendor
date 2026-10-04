import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./e2e', fullyParallel:false, workers:1,
  use:{baseURL:'http://localhost:5174', headless:true, viewport:{width:1280,height:800}},
  webServer:{command:'node scripts/serve.mjs',url:'http://localhost:5174',reuseExistingServer:!process.env.CI},
});
