// Development/preview middleware only. Never connects to Rift, a game or a window.
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {localApiGuard} from './local-api.mjs';

const source='-- Synthetic design preview; not game evidence.\nwarn("SYNTHETIC_PREVIEW")\nlocal widget = "SyntheticWidget"\nreturn widget';
const image=new URL('../image.png',import.meta.url);
const scenarios=new Set(['healthy','locked','no_client','offline','stale','reconnect']);

export function createPreviewApi(){
  let generation=1,scenario='healthy';
  let preferences={schemaVersion:1,preload:false,memory:false,virtual:false,unlocker:false};
  const protection=()=>({preferences:{...preferences},error:null,runtime:{preload:{state:preferences.preload?'Unverified':'Off',support:'unverified',inUse:false}}});
  const auth=randomBytes(24).toString('hex');
  const cookies=req=>(req.headers.cookie??'').split(';').some(value=>value.trim()==='rift_preview='+auth);
  const sessionId=()=>`synthetic-session-${generation}`;
  const scriptId=()=>`synthetic-script-${generation}`;
  const widgetId=()=>`synthetic-widget-${generation}`;
  const cursor=()=>`synthetic-cursor-${generation}`;
  const revision=()=>`synthetic-revision-${generation}`;
  const captureId=()=>`synthetic-capture-${generation}`;
  const usable=()=>!['no_client','offline'].includes(scenario);
  const session=()=>({id:sessionId(),connectionId:`synthetic-connection-${generation}`,name:`Synthetic preview · client ${generation}`,clientName:'Synthetic design fixture',sourceKind:'synthetic_preview',placeId:'not-a-real-place',capabilities:{logs:true,source:true,instances:true,capture:false,execute:false}});
  function status(){
    const now=new Date().toISOString(),stale=scenario==='stale';
    return {state:scenario==='offline'?'bridge_offline':!usable()?'no_client':stale?'stale':'healthy',observedAt:now,session:usable()?session():null,sessions:usable()?[session()]:[],freshness:{lastUpdate:now,ageMs:stale?45000:25,staleAfterMs:15000},build:{serviceBuild:'synthetic-design-preview',reportedReaderBuild:'synthetic-reader',expectedReaderBuild:'synthetic-reader'},activity:{retainedEvents:usable()?3:0,pendingRequests:0},...(scenario==='offline'?{error:{message:'Synthetic offline scenario. No connection to a real service was attempted.'}}:{})};
  }
  function events(){
    return [
      ['info','Synthetic preview initialized. This is not a live Roblox session.'],
      ['warn','SYNTHETIC_PREVIEW · Read-only example source and widget inspection are available.'],
      ['error','Synthetic error · <img src=x onerror=alert(1)> is inert text. '+ 'Long synthetic evidence stays readable and selectable. '.repeat(28)],
    ].map(([severity,message],i)=>({sessionId:sessionId(),seq:i+1,timestamp:'2026-11-11T00:00:00.000Z',receivedAt:'2026-11-11T00:00:00.010Z',severity,message,source:'synthetic_preview',attribution:'synthetic_preview',truncated:false,details:{synthetic:true,notice:'Design fixture only. No game, desktop capture or execution.'}}));
  }
  function send(res,code,value,headers={}){
    res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers});res.end(JSON.stringify(value));
  }
  const result=(res,value,text)=>send(res,200,{content:[{type:'text',text:JSON.stringify(value)},...(text===undefined?[]:[{type:'text',text}])]});
  const failure=(res,message)=>send(res,200,{isError:true,content:[{type:'text',text:JSON.stringify({error:{message,recovery:'Use current synthetic preview evidence; refresh or repeat the search.'}})}]});
  async function body(req,limit=16384){
    if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??''))throw new Error('JSON content type required.');
    let bytes=0;const chunks=[];
    for await(const chunk of req){bytes+=chunk.length;if(bytes>limit)throw Object.assign(new Error('Preview request exceeds its byte limit.'),{status:413});chunks.push(chunk);}
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Expected a JSON object.');return value;
  }
  async function route(req,res,next){
    const path=req.url.split('?')[0];
    if(!path.startsWith('/api/'))return next();
    const args=['POST','PATCH'].includes(req.method)?await body(req,path==='/api/protection'?1024:16384):{};
    if(path==='/api/preview/scenario'&&req.method==='POST'){
      if(!scenarios.has(args.scenario))return send(res,400,{error:'Unknown synthetic preview scenario.'});
      if(args.scenario==='reconnect')generation++;
      scenario=args.scenario==='reconnect'?'healthy':args.scenario;
      return send(res,200,{synthetic:true,scenario,sessionId:usable()?sessionId():null});
    }
    if(path==='/api/login'&&req.method==='POST'){
      if(args.token!=='preview-only')return send(res,401,{error:'Use the documented synthetic-only token: preview-only. Never enter a real Rift token in preview mode.'});
      return send(res,200,{ok:true,synthetic:true},{'set-cookie':`rift_preview=${auth}; HttpOnly; SameSite=Strict; Path=/`});
    }
    if(scenario==='locked'&&!cookies(req))return send(res,401,{error:'Synthetic preview is locked. Dummy token: preview-only.'});
    if(path==='/api/protection'&&req.method==='GET')return send(res,200,protection());
    if(path==='/api/protection'&&req.method==='PATCH'){
      if(Object.keys(args).length!==5||args.schemaVersion!==1||typeof args.preload!=='boolean'||args.memory!==false||args.virtual!==false||args.unlocker!==false)return send(res,400,{error:'Invalid protection preferences.'});
      preferences={...args};return send(res,200,{ok:true,preferences:{...preferences}});
    }
    if(path==='/api/status'&&req.method==='GET')return send(res,200,status());
    if(path==='/api/doctor'&&req.method==='GET')return send(res,200,{synthetic:true,state:status().state,notice:'Synthetic diagnostics only. No game or service was contacted.',checks:[{name:'Isolated design preview',ok:true},{name:'Execution and image sharing disabled',ok:true}]});
    if(path==='/api/captures/'+captureId()&&req.method==='GET'){
      const png=readFileSync(image);res.writeHead(200,{'content-type':'image/png','content-length':png.length,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(png);return;
    }
    if(req.method!=='POST'||!path.startsWith('/api/tools/'))return send(res,404,{error:'No such synthetic preview endpoint.'});
    const name=path.slice('/api/tools/'.length);
    if(name==='list_windows')return result(res,{items:[{id:'synthetic-window',title:'Synthetic supplied design image (not a desktop capture)',processName:'fixture',pid:0,width:1191,height:321,minimized:false}],notice:'Synthetic fixture only; no windows were inspected.'});
    if(!usable())return failure(res,'No current synthetic client.');
    if(args.sessionId!==undefined&&args.sessionId!==sessionId())return failure(res,'Stale synthetic session.');
    const meta={sessionId:sessionId(),sourceKind:'synthetic_preview',observedAt:new Date().toISOString(),freshness:{state:'synthetic',notice:'Not live evidence.'},notice:'Synthetic preview data only; never game evidence.'};
    switch(name){
      case 'select_session':
        return args.sessionId===sessionId()?result(res,{...meta,selected:session()}):failure(res,'Unknown synthetic session.');
      case 'get_logs':
        if(args.cursor!==undefined&&args.cursor!==cursor())return failure(res,'Stale synthetic cursor.');
        return result(res,{...meta,current:true,items:args.cursor?[]:events(),nextCursor:cursor(),hasMore:false});
      case 'search_source':{
        if(args.cursor!==undefined)return failure(res,'Synthetic search has no additional pages.');
        if(typeof args.query!=='string'||!args.query.trim())return failure(res,'Enter a literal source query.');
        const path='SyntheticPreview.DemoScript',query=args.caseSensitive?args.query:args.query.toLowerCase();
        const matches=!args.pathFilter||path.toLowerCase().includes(String(args.pathFilter).toLowerCase());
        const items=matches?source.split('\n').flatMap((excerpt,i)=>(args.caseSensitive?excerpt:excerpt.toLowerCase()).includes(query)?[{...meta,scriptId:scriptId(),name:'DemoScript',path,line:i+1,excerpt,revision:revision()}]:[]):[];
        return result(res,{...meta,items,revision:revision(),coverage:{searchedScripts:1,eligibleScripts:1,missingSource:0,staleSource:0},partial:false,truncated:false,nextCursor:null});
      }
      case 'read_script':{
        if(args.script?.id!==scriptId())return failure(res,'Stale or unknown synthetic source handle. Repeat the search.');
        const start=args.startLine??1,count=args.maxLines??30;
        if(!Number.isSafeInteger(start)||start<1||!Number.isSafeInteger(count)||count<1||count>100)return failure(res,'Invalid synthetic source range.');
        return result(res,{...meta,revision:revision(),path:'SyntheticPreview.DemoScript',startLine:start,totalLines:4},source.split('\n').slice(start-1,start-1+count).join('\n'));
      }
      case 'search_instances':
        return result(res,{...meta,items:typeof args.name==='string'&&'syntheticwidget'.includes(args.name.toLowerCase())?[{id:widgetId(),name:'SyntheticWidget',path:'SyntheticPreview.SyntheticWidget',className:'Frame'}]:[],partial:false,hasMore:false});
      case 'inspect_instance':
        return args.target?.id===widgetId()?result(res,{...meta,id:widgetId(),path:'SyntheticPreview.SyntheticWidget',className:'Frame',properties:{Visible:true,Size:'Synthetic example only'}}):failure(res,'Stale or unknown synthetic instance handle.');
      case 'preview_capture':
        if(args.windowId!=='synthetic-window')return failure(res,'Choose the synthetic image explicitly.');
        if(args.crop!==undefined)return failure(res,'Synthetic preview does not simulate cropping. Clear the crop fields to view the original supplied image.');
        return result(res,{...meta,captureId:captureId(),width:1191,height:321,sessionMatch:'unverified',notice:'Original supplied design image, not a capture of a game or desktop. No image was shared.'});
      default:return send(res,404,{error:'Unsupported synthetic preview tool.'});
    }
  }
  return(req,res,next)=>localApiGuard(req,res,()=>{void route(req,res,next).catch(error=>{
    if(!res.headersSent)send(res,error.status===413?413:400,{error:'Invalid synthetic preview request. Supply a small JSON object.'});else res.end();
  });});
}
