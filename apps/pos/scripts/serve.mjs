// Small static-export preview server. Business APIs remain on FastAPI.
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';

const root=resolve('out');
const port=Number(process.env.PORT||5174);
const host=process.env.HOST||'localhost';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.txt':'text/x-component; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};
createServer(async(request,response)=>{
  if(!['GET','HEAD'].includes(request.method)){response.writeHead(405).end();return;}
  try{
    const url=new URL(request.url,`http://${request.headers.host}`);
    let file=resolve(root,'.'+decodeURIComponent(url.pathname));
    if(file!==root&&!file.startsWith(root+sep)){response.writeHead(403).end();return;}
    if((await stat(file)).isDirectory())file=resolve(file,'index.html');
    const data=await readFile(file);
    response.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});
    response.end(request.method==='HEAD'?undefined:data);
  }catch{response.writeHead(404,{'Content-Type':'text/plain'}).end('Not found');}
}).listen(port,host,()=>console.log(`Food Vendor OS Version 1: http://${host}:${port}`));
