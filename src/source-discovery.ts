import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {Bridge} from './bridge.js';
import type {CacheEntry, DecompileService, ScriptInfo} from './decompile.js';
import {makeRedactor} from './redact.js';
import {SourceIndex, type SourceRecord} from './source-search.js';
import {LIMITS} from './limits.js';
import {budgetSourcePage} from './read-script-result.js';

const ref = z.object({id:z.string().min(1).max(200).optional(),path:z.array(z.string().min(1).max(200)).min(1).max(64).optional()}).refine(v=>!!v.id||!!v.path,'script id or path required');
export const sourceDiscoverySchema = {
  discover_source:{nameContains:z.string().min(1).max(200).optional(),pathContains:z.string().min(1).max(1000).optional(),className:z.string().min(1).max(100).optional(),loaded:z.boolean().optional(),running:z.boolean().optional(),query:z.string().min(1).max(500).optional(),caseSensitive:z.boolean().default(false),refresh:z.boolean().default(false),maxInventoryPages:z.number().int().min(1).max(10).default(2),maxRevalidations:z.number().int().min(0).max(50).default(10),offset:z.number().int().min(0).max(2000).default(0).describe('Offset into client candidates followed by provided execution candidates. Every page re-observes inventory; it is not a stable snapshot.'),limit:z.number().int().min(1).max(100).default(20),maxResponseChars:z.number().int().min(2048).max(100000).default(40000)},
  get_source_excerpt:{script:ref,expectedRevision:z.string().min(1).max(128).optional(),startLine:z.number().int().min(1).default(1),maxLines:z.number().int().min(1).max(200).default(30),contextLines:z.number().int().min(0).max(20).default(0),maxChars:z.number().int().min(1).max(20000).default(20000),fetchMissing:z.boolean().default(false),jobId:z.string().min(1).max(100).optional(),cursor:z.string().min(1).max(2000).optional()}
};
const discoverArgs=z.object(sourceDiscoverySchema.discover_source).strict();
const excerptArgs=z.object(sourceDiscoverySchema.get_source_excerpt).strict();
type DiscoverArgs=z.infer<typeof discoverArgs>;
type ExcerptArgs=z.infer<typeof excerptArgs>;
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
type Row={id:string;name:string;path:string;className:string;loaded?:boolean;running?:boolean;[key:string]:unknown};
type Guard={session:string;connectionId:string};
type Counts={enumerated:number;knownEligible:number|null;cached:number;missing:number;stale:number;unverified:number;revalidated:number};
type Dependencies={bridge:Bridge;decompiler:DecompileService;getProvidedSources:()=>SourceRecord[];readScript:(args:Record<string,unknown>)=>Promise<CallToolResult>;redact?:(text:string)=>string};
// Older cache entries contain normalized lines only; integrations may supply the exact original text.
const cachedText=(entry:CacheEntry):string => (entry as CacheEntry&{sourceText?:string}).sourceText??entry.lines.join('\n');
const hasExactText=(entry:CacheEntry):boolean => typeof (entry as CacheEntry&{sourceText?:string}).sourceText==='string';

export class SourceDiscovery {
  private readonly redact:(text:string)=>string;
  private lastConnection:Guard|null=null;
  private readonly jobs=new Map<string,{session:string;connectionId:string;scriptId:string;createdAt:number}>();
  constructor(private readonly deps:Dependencies){this.redact=deps.redact??makeRedactor();}
  private guard():Guard {const r=this.deps.bridge.reader;if(!r||!this.deps.bridge.session||r.session!==this.deps.bridge.session)throw new Error('reader is not connected');const g={session:r.session,connectionId:r.connectionId};if(this.lastConnection&&(this.lastConnection.session!==g.session||this.lastConnection.connectionId!==g.connectionId))this.jobs.clear();this.lastConnection=g;return g;}
  private check(g:Guard):void {const r=this.deps.bridge.reader;if(!r||this.deps.bridge.session!==g.session||r.session!==g.session||r.connectionId!==g.connectionId)throw new Error('reader session or connection changed; retry');}
  private async request(g:Guard,op:string,args:Record<string,unknown>,deadlineMs?:number):Promise<any>{try {const value=await this.deps.bridge.request(op,args,deadlineMs===undefined?undefined:{deadlineMs});this.check(g);return value;}catch(e){this.check(g);throw e;}}
  private pruneJobs(preserveId?:string):void {const now=Date.now();for(const [id,job] of this.jobs){const current=this.deps.decompiler.getJob(id);if(now-job.createdAt>=LIMITS.jobRetentionMs||(id!==preserveId&&current&&current.status!=='queued'&&current.status!=='running'))this.jobs.delete(id);}}
  private entries(g:Guard,id:string):CacheEntry[]{return this.deps.decompiler.cachedEntries(g.session).filter(e=>e.script.id===id).sort((a,b)=>b.storedAt-a.storedAt||a.key.localeCompare(b.key));}
  private matches(record:SourceRecord,query:string,caseSensitive:boolean,g:Guard):boolean {const index=new SourceIndex(this.redact);index.replace(g.session,[record]);return index.search({sessionId:g.session,query,caseSensitive,limit:1}).totalMatches>0;}
  private matchesMeta(r:{name?:string;path:string;className?:unknown;loaded?:unknown;running?:unknown},a:DiscoverArgs):boolean {return (!a.nameContains||(r.name??'').toLowerCase().includes(a.nameContains.toLowerCase()))&&(!a.pathContains||r.path.toLowerCase().includes(a.pathContains.toLowerCase()))&&(!a.className||r.className===a.className)&&(a.loaded===undefined||r.loaded===a.loaded)&&(a.running===undefined||r.running===a.running);}
  async discover(input:Record<string,unknown>){
    const a=discoverArgs.parse(input),g=this.guard(),deadline=Date.now()+10000;const rows:Row[]=[],seen=new Set<string>(),limitsReached:string[]=[];let total:number|null=null,complete=false,reason:string|null=null,workReason:string|null=null,offset=0,snapshot:unknown;
    const limit=(name:string)=>{if(!limitsReached.includes(name))limitsReached.push(name);};
    for(let p=0;p<a.maxInventoryPages;p++){
      const remaining=deadline-Date.now();if(remaining<=0){reason??='work_deadline';limit('work_deadline');break;}
      let list:any;try{list=await this.request(g,'list_scripts',{offset,limit:200,refresh:p===0&&a.refresh,...(a.nameContains?{nameContains:a.nameContains}:{}),...(a.pathContains?{pathContains:a.pathContains}:{}),...(a.className?{className:a.className}:{}),...(a.loaded===undefined?{}:{loaded:a.loaded}),...(a.running===undefined?{}:{running:a.running})},Math.min(remaining,2000));}catch(e){this.check(g);reason??='inventory_read_failed';break;}
      if(!Array.isArray(list.items))throw new Error('invalid list_scripts response');
      const stamp=list.cache?.builtObservedAt;if(p===0){snapshot=stamp;total=Number.isSafeInteger(list.total)&&list.total>=0?list.total:null;}else if(stamp!==snapshot||(total!==null&&list.total!==total)){reason='inventory_changed';total=null;break;}
      if(list.partial===true)reason??=typeof list.partialReason==='string'&&list.partialReason?list.partialReason:'reader_partial';
      if(!stamp)reason??='inventory_snapshot_unverified';
      if(list.items.length>200){reason??='inventory_page_overflow';total=null;}
      for(const row of list.items.slice(0,200)){
        if(!row||typeof row.id!=='string'||!row.id||typeof row.path!=='string'||typeof row.name!=='string'||typeof row.className!=='string'||!this.matchesMeta(row,a)){reason??='invalid_inventory_row';total=null;continue;}
        if(seen.has(row.id)){reason??='duplicate_inventory_id';total=null;continue;}
        seen.add(row.id);rows.push(row);
      }
      if(!list.hasMore){if(total!==null&&rows.length!==total){reason??='inventory_count_mismatch';total=null;}complete=reason===null;break;}
      const next=list.nextOffset;if(!Number.isSafeInteger(next)||next<=offset){reason='invalid_inventory_cursor';break;}offset=next;
    }
    if(!complete&&!reason){reason='inventory_page_limit';limit('inventory_page_limit');}
    const counts:Counts={enumerated:rows.length,knownEligible:total,cached:0,missing:0,stale:0,unverified:0,revalidated:0};
    const candidates:Record<string,unknown>[]=[];let budget=a.maxRevalidations;
    for(const row of rows){
      const variants=this.entries(g,row.id);let selected:CacheEntry|undefined;let status:'cached'|'missing'|'stale'|'unverified';let bytecodeHash:string|null=null;let observedAt:string|null=null;
      if(!variants.length){status='missing';counts.missing++;}
      else if(budget===0||Date.now()>=deadline){status='unverified';counts.unverified++;if(Date.now()>=deadline)limit('work_deadline');else limit('revalidation_limit');}
      else {
        budget--;let info:ScriptInfo|undefined;
        try {info=await this.request(g,'script_info',{target:{id:row.id}},Math.min(2000,Math.max(1,deadline-Date.now())));counts.revalidated++;}catch(e){this.check(g);workReason??='revalidation_failed';}
        if(Date.now()>=deadline)limit('work_deadline');
        if(!info){status='unverified';counts.unverified++;}
        else {bytecodeHash=typeof info.hash==='string'?info.hash:null;observedAt=info.observedAt??null;
          if(bytecodeHash===null){selected=variants.find(v=>v.hash===null);status='unverified';counts.unverified++;}
          else {selected=variants.find(v=>v.hash===bytecodeHash);if(selected){status='cached';counts.cached++;}else{status='stale';counts.stale++;}}
        }
      }
      const source=selected&&cachedText(selected);
      if(a.query&&(!source||!this.matches({id:row.id,path:row.path,source},a.query,a.caseSensitive,g)))continue;
      candidates.push({...row,sourceKind:'cached_reconstructed',status,bytecodeHash,revision:source===undefined?null:digest(source),revisionExact:selected?hasExactText(selected):null,observedAt,cacheObservedAt:selected?.observedAt??null});
    }
    this.check(g);
    const provided=this.deps.getProvidedSources().filter(r=>r.sourceKind==='provided_execution'&&typeof r.source==='string'&&this.matchesMeta(r,a)).filter(r=>!a.query||this.matches(r,a.query,a.caseSensitive,g)).map(r=>({id:r.id,name:r.name??r.id,path:r.path,sourceKind:'provided_execution',revision:digest(r.source!),observedAt:r.observedAt??null}));
    this.check(g);
    const combined=[...candidates.map(item=>({kind:'client' as const,item})),...provided.map(item=>({kind:'provided' as const,item}))],page=combined.slice(a.offset,a.offset+a.limit);
    const items=page.filter(x=>x.kind==='client').map(x=>x.item),providedItems=page.filter(x=>x.kind==='provided').map(x=>x.item);
    const omittedByLimit=Math.max(0,combined.length-a.offset-page.length);if(omittedByLimit)limit('result_limit');
    const result={schemaVersion:1,sessionId:g.session,connectionId:g.connectionId,observedAt:new Date().toISOString(),scope:{nameContains:a.nameContains??null,pathContains:a.pathContains??null,className:a.className??null,loaded:a.loaded??null,running:a.running??null,query:a.query??null},inventory:{complete,reason,enumerated:rows.length,knownEligible:total},coverage:counts,items,providedExecution:{scope:'provided_execution',eligible:provided.length,items:providedItems},pagination:{offset:a.offset,notice:'Each page is a re-observation, not a stable snapshot; concurrent changes can cause duplicates or omissions.'},hasMore:false,nextOffset:null as number|null,omissions:{resultLimit:omittedByLimit,responseLimit:0},partial:false,partialReason:null as string|null,limitsReached,truncation:[] as string[]};
    const update=()=>{const n=result.items.length+result.providedExecution.items.length,next=a.offset+n;result.hasMore=next<combined.length;result.nextOffset=result.hasMore&&next<=2000&&n>0?next:null;if(result.hasMore&&result.nextOffset===null)limit(n===0?'response_item_too_large':'offset_limit');result.partial=!complete||!!workReason||limitsReached.length>0||!!(a.query&&(counts.missing||counts.stale||counts.unverified));result.partialReason=reason??workReason??limitsReached[0]??(result.partial?'source_coverage_incomplete':null);result.truncation=limitsReached.filter(x=>x==='result_limit'||x==='response_limit');};
    update();
    while(JSON.stringify(result).length>a.maxResponseChars&&(result.items.length||result.providedExecution.items.length)){if(result.providedExecution.items.length)result.providedExecution.items.pop();else result.items.pop();result.omissions.responseLimit++;limit('response_limit');update();}
    if(JSON.stringify(result).length>a.maxResponseChars)throw new Error('response metadata exceeds maxResponseChars');
    return result;
  }
  async excerpt(input:Record<string,unknown>){
    const result=await this.excerptImpl(input),metadata=result.metadata as Record<string,unknown>;
    const error=metadata.error as {code?:string}|undefined;
    return {...result,metadata:{...metadata,observedAt:metadata.observedAt??new Date().toISOString(),partial:metadata.partial??result.sourceText===null,partialReason:metadata.partialReason??(result.sourceText===null?(error?.code??metadata.status??'unavailable'):null),limitsReached:metadata.limitsReached??[],hasMore:metadata.hasMore??false,nextStartLine:metadata.nextStartLine??null,sourceTruncated:metadata.sourceTruncated??false}};
  }
  private async excerptImpl(input:Record<string,unknown>){
    const a=excerptArgs.parse(input),g=this.guard();this.pruneJobs(a.jobId);let start=a.startLine;
    let cursorData:any;
    if(a.cursor){try{cursorData=JSON.parse(Buffer.from(a.cursor,'base64url').toString('utf8'));if(!cursorData||cursorData.session!==g.session||cursorData.connectionId!==g.connectionId||JSON.stringify(cursorData.script)!==JSON.stringify(a.script)||!Number.isSafeInteger(cursorData.next)||cursorData.next<1||typeof cursorData.revision!=='string')throw Error();start=cursorData.next;}catch{throw new Error('cursor is invalid or belongs to a different session or connection');}}
    let raw:string|undefined,identity:Record<string,unknown>=a.script,sourceKind='cached_reconstructed',bytecodeHash:string|null=null,observedAt:string|null=null,cacheTruncated=false,unverified=false,revisionExact=true;
    const provided=this.deps.getProvidedSources().find(r=>r.sourceKind==='provided_execution'&&r.id===a.script.id);this.check(g);
    if(provided&&typeof provided.source==='string'){raw=provided.source;identity={id:provided.id,name:provided.name,path:provided.path};sourceKind='provided_execution';observedAt=provided.observedAt??null;}
    else if(a.script.id?.startsWith('exec:'))return {metadata:{ok:false,error:{code:'missing_source',message:'Provided execution source is unavailable for this connection.'},status:'missing',script:a.script,sourceKind:'provided_execution'},sourceText:null};
    else {
      let target=a.script;
      if(!target.id){const inspection=await this.request(g,'inspect_instance',{target,properties:[],maxProperties:1,includeAttributes:false,includeTags:false,includeAssets:false});if(inspection?.pathInfo?.unique!==true||inspection?.pathInfo?.complete!==true||typeof inspection?.object?.id!=='string')throw new Error('ambiguous or unverifiable script path; use an explicit id or manually update the reader');target={id:inspection.object.id};}
      const info:ScriptInfo=await this.request(g,'script_info',{target});
      if(!info?.object?.id)throw new Error('invalid script_info response');
      identity=info.object;bytecodeHash=typeof info.hash==='string'?info.hash:null;observedAt=info.observedAt??null;
      const variants=this.entries(g,info.object.id),entry=variants.find(v=>v.hash===bytecodeHash);
      if(entry){if(a.jobId)this.jobs.delete(a.jobId);raw=cachedText(entry);revisionExact=hasExactText(entry);cacheTruncated=entry.truncated;unverified=bytecodeHash===null;}
      else if(!a.fetchMissing)return {metadata:{ok:false,error:{code:variants.length?'stale_source':'missing_source',message:'No current cached source is available; set fetchMissing to explicitly request this script.'},status:variants.length?'stale':'missing',script:identity,bytecodeHash,sessionId:g.session,connectionId:g.connectionId},sourceText:null};
      else {
        const args:Record<string,unknown>={script:{id:info.object.id},startLine:1,maxLines:30,waitMs:0,refresh:false};if(a.jobId){const owner=this.jobs.get(a.jobId);if(!owner||owner.session!==g.session||owner.connectionId!==g.connectionId||owner.scriptId!==info.object.id)throw new Error('job does not belong to this script and connection');args.jobId=a.jobId;}
        let response:CallToolResult;try{response=await this.deps.readScript(args);this.check(g);}catch(e){this.check(g);throw e;}
        const data=(response.structuredContent??{}) as Record<string,any>;const metadata=(data.metadata??data) as Record<string,any>;
        if(response.isError||metadata.status!=='complete'){if(metadata.status==='pending'&&typeof metadata.jobId==='string'){this.pruneJobs();if(!this.jobs.has(metadata.jobId)&&this.jobs.size>=128)this.jobs.delete(this.jobs.keys().next().value!);const old=this.jobs.get(metadata.jobId);this.jobs.set(metadata.jobId,{...g,scriptId:info.object.id,createdAt:old?.createdAt??Date.now()});}else if(a.jobId)this.jobs.delete(a.jobId);return {metadata:{...metadata,sessionId:g.session,connectionId:g.connectionId},sourceText:null};}
        if(a.jobId)this.jobs.delete(a.jobId);
        const cached=this.entries(g,info.object.id).find(v=>v.hash===bytecodeHash);
        if(!cached)return {metadata:{ok:false,error:{code:'cache_evicted',message:'Completed source is unavailable in the current connection cache.'},status:'missing',reason:'cache_evicted',script:identity,sessionId:g.session,connectionId:g.connectionId},sourceText:null};
        raw=cachedText(cached);revisionExact=hasExactText(cached);cacheTruncated=cached.truncated;unverified=bytecodeHash===null;
      }
    }
    const revision=digest(raw);if((a.expectedRevision&&a.expectedRevision!==revision)||(cursorData&&cursorData.revision!==revision))return {metadata:{ok:false,error:{code:'revision_mismatch',message:'Source revision changed; restart the excerpt.'},status:'revision_mismatch',revision,script:identity,sessionId:g.session,connectionId:g.connectionId},sourceText:null};
    const display=this.redact(raw),lines=display.split(/\r?\n/);if(lines.length!==raw.split(/\r?\n/).length)throw new Error('redaction changed line count; an accurate excerpt cannot be produced');
    return budgetSourcePage(maxChars=>{
    const first=cursorData?start:Math.max(1,start-a.contextLines),last=Math.min(lines.length,start+a.maxLines-1+a.contextLines),out:string[]=[],truncation:string[]=[];let chars=0,next=first;
    for(let n=first;n<=last;n++){const line=lines[n-1]??'',separator=out.length?1:0,available=maxChars-chars-separator;if(line.length>available){if(out.length===0&&available>0){out.push(line.slice(0,available));next=n+1;truncation.push('long_line');}else next=n;truncation.push('max_chars');break;}out.push(line);chars+=separator+line.length;next=n+1;}
    if(next<=lines.length&&!truncation.length)truncation.push('max_lines');if(cacheTruncated)truncation.push('source_limit');
    if(maxChars<a.maxChars)truncation.push('response_size');
    const cursor=next<=lines.length?Buffer.from(JSON.stringify({session:g.session,connectionId:g.connectionId,script:a.script,revision,next})).toString('base64url'):null;
    return {metadata:{ok:true,status:'complete',script:identity,sourceKind,revision,revisionExact,bytecodeHash,observedAt,unverified,contentRedacted:display!==raw,startLine:first,endLine:out.length?next-1:first-1,totalLines:lines.length,cursor,hasMore:cursor!==null,nextStartLine:cursor!==null?next:null,sourceTruncated:cacheTruncated,partial:truncation.length>0,partialReason:truncation[0]??null,limitsReached:truncation,truncation,sessionId:g.session,connectionId:g.connectionId},sourceText:out.join('\n')};
    },a.maxChars);
  }
}
