import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import {createPreviewApi} from './preview-api.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const output=path.join(root,'evidence');await fs.mkdir(output,{recursive:true});
const sourceRoot=path.resolve(root,'..');
const copies=path.join(root,'baseline','served');await fs.mkdir(copies,{recursive:true});
const baselineManifest=path.join(copies,'hashes.json');let pins;
try{pins=JSON.parse(await fs.readFile(baselineManifest,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const currentPins={};
for(const name of ['index.html','app.js','health-state.js','style.css']){
 const data=await fs.readFile(path.join(sourceRoot,name));const hash=createHash('sha256').update(data).digest('hex');currentPins[name]=hash;
 if(pins){assert.equal(hash,pins[name],'Canonical reference changed; do not silently replace the accepted baseline');assert.equal(createHash('sha256').update(await fs.readFile(path.join(copies,name))).digest('hex'),pins[name]);}
 else await fs.writeFile(path.join(copies,name),data);
}
if(!pins)await fs.writeFile(baselineManifest,JSON.stringify(currentPins,null,2),{flag:'wx'});
const fixture=createPreviewApi();
const reference=http.createServer((req,res)=>fixture(req,res,()=>{
 const names=new Map([['/','index.html'],['/app.js','app.js'],['/health-state.js','health-state.js'],['/style.css','style.css']]);
 const name=names.get(new URL(req.url,'http://127.0.0.2').pathname);
 if(!name){res.writeHead(404);res.end();return;}
 fs.readFile(path.join(copies,name)).then(data=>{
  res.writeHead(200,{'content-type':name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'text/javascript','cache-control':'no-store'});res.end(data);
 }).catch(()=>{res.writeHead(500);res.end();});
}));
await new Promise((resolve,reject)=>{reference.once('error',reject);reference.listen(41736,'127.0.0.2',resolve);});
let browser;
const results=[],errors=[],blocked=[];
try{
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce',colorScheme:'dark',serviceWorkers:'block'});
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.protocol==='http:'&&url.hostname==='127.0.0.2'&&['41734','41735','41736'].includes(url.port))return route.continue();
  blocked.push(url.origin);return route.abort();
 });
 await context.addInitScript(()=>{localStorage.setItem('rift-waves','paused');});
 const pages={reference:await context.newPage(),rebuilt:await context.newPage()};
 for(const [name,page] of Object.entries(pages))page.on('pageerror',e=>errors.push({page:name,message:e.message}));
 const origins={reference:'http://127.0.0.2:41736',rebuilt:'http://127.0.0.2:41735'};
 async function capture(name,view,theme='dark',size='desktop',state='initial'){
  const page=pages[name];if(state==='initial'){await page.goto(origins[name]+'/#'+view,{waitUntil:'networkidle'});
   await page.waitForFunction(()=>document.getElementById('overview-title')?.textContent.includes('Synthetic preview'));}
  // Only the intentional new section is omitted when measuring the old design.
  const protection=page.locator('#extra-protection');if(await protection.count())await protection.evaluate(e=>e.hidden=true);
  await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;localStorage.setItem('rift-theme',theme);},theme);
  // Explicitly omit the synthetic-only marker from visual comparison, never from interaction tests.
  const marker=page.locator('.synthetic-preview-marker');if(await marker.count())await marker.evaluate(e=>e.hidden=true);
  await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});
  const file=path.join(output,`${size}-${theme}-${view}-${state}-${name}.png`);
  const bytes=await page.screenshot({path:file,fullPage:true,animations:'disabled'});
  const metrics=await page.evaluate(()=>{
   const ids=['main','overview-title','health','session','activity','source','visuals','diagnostics'];
   return Object.fromEntries(ids.map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return [id,{x:r.x,y:r.y,w:r.width,h:r.height,hidden:e.hidden,text:e.textContent.trim().slice(0,120)}];}));
  });
  return {file,bytes,metrics};
 }
 async function compare(view,theme,size,state='initial'){
  const a=await capture('reference',view,theme,size,state),b=await capture('rebuilt',view,theme,size,state);
  const geometry=['main','overview-title','health','session',view].map(id=>({id,reference:a.metrics[id],rebuilt:b.metrics[id]}));
  const diff=await pages.rebuilt.evaluate(async({a,b})=>{
   const image=data=>createImageBitmap(new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:'image/png'}));
   const left=await image(a),right=await image(b);if(left.width!==right.width||left.height!==right.height)return {sameSize:false,left:[left.width,left.height],right:[right.width,right.height]};
   const canvas=document.createElement('canvas');canvas.width=left.width;canvas.height=left.height;const c=canvas.getContext('2d',{willReadFrequently:true});
   c.drawImage(left,0,0);const p=c.getImageData(0,0,canvas.width,canvas.height).data;c.clearRect(0,0,canvas.width,canvas.height);c.drawImage(right,0,0);const q=c.getImageData(0,0,canvas.width,canvas.height).data;
   let changed=0;for(let i=0;i<p.length;i+=4)if(Math.max(Math.abs(p[i]-q[i]),Math.abs(p[i+1]-q[i+1]),Math.abs(p[i+2]-q[i+2]))>16)changed++;
   return {sameSize:true,changedPixels:changed,totalPixels:left.width*left.height,ratio:changed/(left.width*left.height)};
  },{a:a.bytes.toString('base64'),b:b.bytes.toString('base64')});
  results.push({view,theme,size,state,diff,geometry});
 }
 for(const view of ['activity','source','visuals','diagnostics'])await compare(view,'dark','desktop');
 await compare('source','light','desktop');
 for(const page of Object.values(pages))await page.setViewportSize({width:390,height:844});
 await compare('activity','dark','narrow');
 for(const [name,p] of Object.entries(pages)){
  await p.setViewportSize({width:1440,height:900});await p.goto(origins[name]+'/#diagnostics',{waitUntil:'networkidle'});
  await p.locator('#doctor').click();await p.waitForFunction(()=>document.getElementById('doctor-notice').textContent.startsWith('Read-only diagnostics returned'));
 }
 const diagnosticsDom=await pages.reference.locator('#diagnostics').evaluate(e=>e.outerHTML);
 await fs.writeFile(path.join(output,'diagnostics-reference-dom.html'),diagnosticsDom);
 await compare('diagnostics','dark','desktop','populated');
 for(const scenario of ['stale','no_client','offline','locked']){
  for(const [name,p]of Object.entries(pages)){
   await p.evaluate(async scenario=>{
    const response=await fetch('/api/preview/scenario',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenario})});
    if(!response.ok)throw new Error('Synthetic scenario setup refused');
   },scenario);
   await p.goto(origins[name]+'/#activity',{waitUntil:'networkidle'});
   if(scenario==='locked')await p.locator('#unlock').waitFor({state:'visible'});
   else await p.waitForFunction(state=>document.getElementById('health').textContent===(state==='offline'?'bridge_offline':state),scenario);
  }
  await compare('activity','dark','desktop',scenario);
 }
 for(const [name,p]of Object.entries(pages)){
  await p.evaluate(async()=>{await fetch('/api/preview/scenario',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"scenario":"healthy"}'});});
  await p.reload({waitUntil:'networkidle'});
  await p.waitForFunction(()=>document.getElementById('overview-title')?.textContent.includes('Synthetic preview'));
 }
 // Browser-level source/widget functionality exercises the actual rebuilt event handlers.
 const page=pages.rebuilt;await page.setViewportSize({width:1440,height:900});await page.goto(origins.rebuilt+'/#source',{waitUntil:'networkidle'});
 await page.locator('#query').fill('warn');await page.locator('#source-form button').click();await page.locator('#source-results button').first().waitFor();
 await page.locator('#source-results button').first().click();await page.waitForFunction(()=>document.getElementById('source-detail').textContent.includes('SYNTHETIC_PREVIEW'));
 await page.locator('input[value="widgets"]').check();await page.locator('#widget-name').fill('Synthetic');await page.locator('#widget-form button').click();
 await page.locator('#widget-results button').first().click();await page.waitForFunction(()=>document.getElementById('widget-detail').textContent.includes('SyntheticWidget'));
 await page.locator('a[data-view="diagnostics"]').click();
 await page.locator('#doctor-popup-setting').uncheck();
  assert.equal(await page.evaluate(()=>localStorage.getItem('rift-doctor-popup')),'off','diagnostic popup choice was not saved');
 await page.locator('#preload-request').check();await page.locator('#protection-form [type="submit"]').click();
 await page.waitForFunction(()=>document.getElementById('protection-status').textContent.startsWith('Saved.'));
 await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>document.getElementById('preload-runtime').textContent==='Unverified');
 assert.equal(await page.locator('#preload-request').isChecked(),true);
 const protectionScreenshots=[];
 for(const [theme,width]of [['dark',1440],['light',1440],['dark',390]]){
  await page.setViewportSize({width,height:900});await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
  const file=path.join(output,`protection-${theme}-${width}.png`);await page.locator('#extra-protection').screenshot({path:file,animations:'disabled'});protectionScreenshots.push(file);
 }
 await page.locator('#preload-request').uncheck();await page.locator('#protection-form [type="submit"]').click();
 await page.waitForFunction(()=>document.getElementById('preload-runtime').textContent==='Off');
 const interactions={sourceAndWidgets:true,protectionSavedReloaded:true,protectionScreenshots,externalOriginsAttempted:[...new Set(blocked)]};
 await page.goto('http://127.0.0.2:41734/test/lifecycle.html',{waitUntil:'domcontentloaded'});await page.locator('#lifecycle-result').waitFor();
 const lifecycle=JSON.parse(await page.locator('#lifecycle-result').textContent());
 const report={syntheticOnly:true,actualChromeVersion:browser.version(),baselineHashes:currentPins,results,errors,interactions,lifecycle};
 await fs.writeFile(path.join(output,'browser-verification.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({comparisons:results.map(r=>({view:r.view,theme:r.theme,size:r.size,diff:r.diff})),interactions,lifecycle,pageErrors:errors},null,2));
 assert.equal(lifecycle.failures.length,0);assert.equal(errors.length,0);
 assert.ok(results.every(r=>r.diff.sameSize&&r.diff.ratio<0.005),'Visual parity exceeded 0.5% changed pixels; inspect screenshots before acceptance');
 console.log('PRIVATE_BROWSER_ACCEPTANCE_PASS');
}finally{await browser?.close();await new Promise(r=>reference.close(r));}
