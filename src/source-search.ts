import {createHash} from 'node:crypto';

export interface SourceRecord {id:string;name?:string;path:string;source?:string|null;revision?:string;stale?:boolean;sourceKind?:string;freshness?:string;observedAt?:string}
export interface SourceInventory {complete:boolean;knownTotal?:number;reason?:string|null}
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export class SourceIndex {
	private sessionId:string|null=null;
	private records:SourceRecord[]=[];
	private version=0;
	private inventory:SourceInventory={complete:true};
	replace(sessionId:string,records:SourceRecord[],inventory:SourceInventory={complete:true}):void {
		if(records.length>2000)throw new Error('source inventory exceeds 2000 scripts');
		let chars=0;
		const ids=new Set<string>();
		const prior=JSON.stringify([this.sessionId,this.records.map(({observedAt,...r})=>r),this.inventory]);
		const next=records.map(r=>{
			if(ids.has(r.id))throw new Error('duplicate script identity');ids.add(r.id);
			if(!r.id||typeof r.path!=='string')throw new Error('source requires identity and current path');
			if(typeof r.source==='string'){chars+=r.source.length;if(r.source.length>2_000_000 || chars>32_000_000)throw new Error('authorized source size budget exceeded');}
			return{...r,revision:typeof r.source==='string'?digest(r.source):r.revision};
		}).sort((a,b)=>a.path.localeCompare(b.path)||a.id.localeCompare(b.id));
		this.records=next;this.sessionId=sessionId;this.inventory=inventory;
		if(prior!==JSON.stringify([this.sessionId,this.records.map(({observedAt,...r})=>r),this.inventory]))this.version++;
	}
	search(args:{sessionId:string;query:string;caseSensitive?:boolean;pathFilter?:string;cursor?:string;limit?:number}) {
		if(args.sessionId!==this.sessionId)throw new Error('source index belongs to another or expired session');
		if(typeof args.query!=='string'||!args.query.length||args.query.length>500)throw new Error('literal query must contain 1–500 characters');
		const eligible=this.records.filter(r=>!args.pathFilter||r.path.toLowerCase().includes(args.pathFilter.toLowerCase()));
		const fingerprint=digest(JSON.stringify([this.sessionId,this.version,args.query,args.caseSensitive===true,args.pathFilter??'']));
		let offset=0;
		if(args.cursor){try{const c=JSON.parse(Buffer.from(args.cursor,'base64url').toString('utf8'));if(c[0]!==fingerprint||!Number.isSafeInteger(c[1])||c[1]<0)throw new Error();offset=c[1];}catch{throw new Error('cursor query/revision snapshot changed; start the search again');}}
		const items:Array<{scriptId:string;name:string;path:string;revision:string;line:number;excerpt:string;sourceKind:string;freshness:string;observedAt:string|null}>=[];
		let searchedScripts=0,missingSource=0,staleSource=0,capped=false;
		const needle=args.caseSensitive?args.query:args.query.toLowerCase();
		for(const r of eligible){
			if(r.stale){staleSource++;continue;}
			if(typeof r.source!=='string'){missingSource++;continue;}
			searchedScripts++;
			const lines=r.source.split(/\r?\n/);
			for(let n=0;n<lines.length;n++){
				const text=lines[n]!,index=(args.caseSensitive?text:text.toLowerCase()).indexOf(needle);
				if(index<0)continue;
				if(items.length===10_000){capped=true;break;}
				const from=Math.max(0,index-40);
				items.push({scriptId:r.id,name:r.name??r.path.split('/').at(-1)??r.id,path:r.path,revision:r.revision!,line:n+1,
					excerpt:(from?'…':'')+text.slice(from,from+240)+(text.length>from+240?'…':''),sourceKind:r.sourceKind??'owned_original',freshness:r.freshness??'owned_snapshot',observedAt:r.observedAt??null});
			}
		}
		const limit=Math.min(200,Math.max(1,args.limit??50)),page=items.slice(offset,offset+limit),more=offset+page.length<items.length;
		return{schemaVersion:1,sessionId:args.sessionId,snapshot:fingerprint,query:args.query,items:page,totalMatches:items.length,
			coverage:{eligibleScripts:!args.pathFilter?Math.max(eligible.length,this.inventory.knownTotal??0):eligible.length,searchedScripts,missingSource,staleSource},partial:missingSource>0||staleSource>0||capped||!this.inventory.complete,
			inventory:{complete:this.inventory.complete,enumeratedScripts:eligible.length,knownEligibleScripts:this.inventory.knownTotal??null,countKind:args.pathFilter?'enumerated_path_filtered':this.inventory.knownTotal===undefined?'enumerated':'known_total',reason:this.inventory.reason??null},
			truncated:more||capped,nextCursor:more?Buffer.from(JSON.stringify([fingerprint,offset+page.length])).toString('base64url'):null,
			notice:'Literal search of authorized source already present. Missing/stale source is not fetched or decompiled. No matches are not proof of absence when coverage is incomplete.'};
	}
}
