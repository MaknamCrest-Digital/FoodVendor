// Refuses a pilot/production build that would point testers at localhost.
// Set MAKNAM_DEPLOY=pilot (or production) in the hosting build environment.
import nextEnv from '@next/env';

const target=process.env.MAKNAM_DEPLOY;
nextEnv.loadEnvConfig(process.cwd(),false);
if(target){
  const problems=[];
  const api=process.env.NEXT_PUBLIC_API_URL||'';
  let url=null;
  try{url=new URL(api);}catch{problems.push('NEXT_PUBLIC_API_URL must be an absolute https:// URL ending in /api/v1');}
  if(url&&url.protocol!=='https:')problems.push('NEXT_PUBLIC_API_URL must use https://');
  if(url&&/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(url.hostname))problems.push('NEXT_PUBLIC_API_URL must not point at localhost');
  if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)problems.push('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required');
  if(/service_role|sb_secret_/.test(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||''))problems.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be the publishable key, never a secret/service-role key');
  if(problems.length){console.error(`Refusing ${target} build:\n - ${problems.join('\n - ')}`);process.exit(1);}
  console.log(`${target} build → API ${url.origin}`);
}
