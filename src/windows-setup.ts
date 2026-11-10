// Explicit, journaled local setup. The public plan never contains credential bytes.
import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync,unlinkSync,lstatSync} from 'node:fs';
import {dirname,join,resolve,basename} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {parseEnv} from 'node:util';
import {PACKAGE_ROOT,TOKEN_PATTERN} from './config.js';

interface Node {start:number;end:number;value:any;props?:Map<string,{start:number;keyEnd:number;node:Node}>}
/** JSONC scanner retains original byte spans, including unrelated comments/formatting. */
function parse(text:string):Node {
	let i=0;
	function ws(){while(i<text.length){if(/\s/.test(text[i]!)){i++;continue;}if(text.startsWith('//',i)){const n=text.indexOf('\n',i);i=n<0?text.length:n;continue;}if(text.startsWith('/*',i)){const n=text.indexOf('*/',i+2);if(n<0)throw new Error('Unterminated JSONC comment.');i=n+2;continue;}break;}}
	function string(){const start=i++;while(i<text.length){if(text[i]==='\\'){i+=2;continue;}if(text[i++]==='"')return JSON.parse(text.slice(start,i)) as string;}throw new Error('Unterminated JSONC string.');}
	function value(depth=0):Node {
		if(depth>64)throw new Error('Configuration nesting exceeds 64 levels.');ws();const start=i,c=text[i];
		if(c==='{'){
			i++;const props=new Map<string,{start:number;keyEnd:number;node:Node}>(),obj:Record<string,unknown>={};ws();
			while(text[i]!=='}'){
				ws();if(text[i]!=='"')throw new Error('Expected a quoted JSONC property.');const keyStart=i,key=string(),keyEnd=i;ws();if(text[i++]!==':')throw new Error('Expected JSONC colon.');const node=value(depth+1);
				if(props.has(key))throw new Error(`Duplicate configuration key ${key}; resolve it before setup.`);
				props.set(key,{start:keyStart,keyEnd,node});Object.defineProperty(obj,key,{value:node.value,enumerable:true,writable:true,configurable:true});ws();
				if(text[i]===','){i++;ws();if(text[i]==='}')break;}else if(text[i]!=='}')throw new Error('Expected JSONC comma.');
			}
			if(text[i++]!=='}')throw new Error('Unterminated JSONC object.');return{start,end:i,value:obj,props};
		}
		if(c==='['){i++;const array=[];ws();while(text[i]!==']'){array.push(value(depth+1).value);ws();if(text[i]===','){i++;ws();if(text[i]===']')break;}else if(text[i]!==']')throw new Error('Expected JSONC array comma.');}if(text[i++]!==']')throw new Error('Unterminated JSONC array.');return{start,end:i,value:array};}
		if(c==='"'){const v=string();return{start,end:i,value:v};}
		const match=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));if(!match)throw new Error('Invalid JSONC value.');i+=match[0].length;return{start,end:i,value:JSON.parse(match[0])};
	}
	const root=value();ws();if(i!==text.length||!root.props)throw new Error('OpenCode configuration must be one JSONC object.');return root;
}
const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const bytes=(path:string)=>existsSync(path)?readFileSync(path):null;
function atomic(path:string,data:Buffer|string){
	if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw new Error('Setup refuses symlinked managed files.');
	mkdirSync(dirname(path),{recursive:true});const temporary=path+'.rift-'+randomBytes(6).toString('hex')+'.tmp';
	writeFileSync(temporary,data,{mode:0o600});renameSync(temporary,path);
}
function replaceProperty(text:string,parent:Node,key:string,value:unknown):string {
	const prop=parent.props?.get(key),encoded=JSON.stringify(value,null,2);
	if(prop)return text.slice(0,prop.node.start)+encoded+text.slice(prop.node.end);
	if(!parent.props)throw new Error('Existing mcp/servers configuration is not an object.');
	return text.slice(0,parent.start+1)+'\n'+JSON.stringify(key)+': '+encoded+(parent.props.size?',':'')+'\n'+text.slice(parent.start+1);
}
function registration(text:string,root:string,legacyRoot?:string):string {
	let tree=parse(text),mcp=tree.props!.get('mcp')?.node;
	if(mcp&&!mcp.props)throw new Error('Existing mcp configuration is not an object.');
	const servers=mcp?.props?.get('servers')?.node;
	if(servers&&!servers.props)throw new Error('Existing mcp.servers is not an object.');
	const normalize=(path:string)=>process.platform==='win32'?resolve(path).replaceAll('\\','/').toLowerCase():resolve(path);
	const allowed=new Set([root,legacyRoot].filter((v):v is string=>!!v).map(r=>normalize(join(r,'dist','index.js'))));
	const entries=[...(servers?.props??[])].filter(([key])=>['rift','volt','volt-bridge'].includes(key));
	const owns=(p:{node:Node})=>Array.isArray(p.node.value?.command)&&p.node.value.command.some((v:unknown)=>typeof v==='string'&&allowed.has(normalize(v)));
	const foreign=entries.some(([key,p])=>!owns(p)&&(key==='rift'||Array.isArray(p.node.value?.command)&&p.node.value.command.some((v:unknown)=>typeof v==='string'&&/[\\/](?:volt-bridge|rift-bridge)[\\/]/.test(v))));
	if(foreign)throw new Error('Rift registration conflict: another installation owns this entry. Nothing was written.');
	const owned=entries.filter(([,p])=>owns(p));
	if(owned.length>1)throw new Error('Conflicting old/new Rift registrations; resolve the conflict before setup.');
	const existing=owned[0]?.[1].node.value??servers?.props?.get('rift')?.node.value;
	if(servers?.props?.has('rift')&&!owned.some(([key])=>key==='rift'))throw new Error('The rift MCP name is already used by another entry; refusing to overwrite it.');
	const entry={...(existing??{}),type:'local',command:[process.execPath,join(root,'dist','index.js'),'--shared'],cwd:root,disabled:false};
	if(owned[0]?.[0]==='rift'&&JSON.stringify(existing)===JSON.stringify(entry))return text;
	if(!mcp)return replaceProperty(text,tree,'mcp',{servers:{rift:entry}});
	if(!servers)return replaceProperty(text,mcp,'servers',{rift:entry});
	if(owned.length&&owned[0]![0]!=='rift'){
		const p=owned[0]![1];text=text.slice(0,p.node.start)+JSON.stringify(entry,null,2)+text.slice(p.node.end);
		text=text.slice(0,p.start)+'"rift"'+text.slice(p.keyEnd);return text;
	}
	return replaceProperty(text,servers,'rift',entry);
}
interface Change {path:string;before:Buffer|null;after:Buffer}
export interface SetupPlan {root:string;configFile:string;changes:Change[];public:{root:string;configFile:string;changes:Array<{path:string;action:string}>;tokenAction:string;confirmation:string}}
interface Journal {version:1;phase:'prepared'|'committed'|'recovered';root:string;configFile:string;files:Array<{path:string;before:string|null;afterHash:string}>}
export function planSetup(options:{root?:string;configFile:string}):SetupPlan {
	const root=resolve(options.root??PACKAGE_ROOT),configFile=resolve(options.configFile),envFile=join(root,'.env'),tokenFile=join(root,'.secrets','token');
	if(['rift-bridge','volt-bridge'].includes(basename(root))&&existsSync(join(dirname(root),basename(root)==='rift-bridge'?'volt-bridge':'rift-bridge')))throw new Error('Setup conflict: legacy and canonical install folders both exist. Nothing was written.');
	const legacy=parseEnv(bytes(envFile)?.toString('utf8')??'').VOLT_BRIDGE_TOKEN;
	const tokenInFile=bytes(tokenFile)?.toString('utf8').trim();
	if(legacy!==undefined&&!TOKEN_PATTERN.test(legacy))throw new Error('Existing local credential is invalid; setup will not overwrite or rotate it.');
	if(tokenInFile&&!TOKEN_PATTERN.test(tokenInFile))throw new Error('Existing token file is invalid; setup will not overwrite it.');
	if(legacy&&tokenInFile&&legacy!==tokenInFile)throw new Error('Local .env and token file disagree; resolve the credential conflict without rotating it.');
	const token=legacy??tokenInFile??randomBytes(32).toString('base64url');
	const oldConfig=bytes(configFile)?.toString('utf8')??'{\n "$schema": "https://opencode.ai/config.json"\n}\n';
	const newConfig=registration(oldConfig,root),changes:Change[]=[];
	const add=(path:string,content:string)=>{const before=bytes(path),after=Buffer.from(content);if(!before?.equals(after))changes.push({path,before,after});};
	add(configFile,newConfig);
	if(!legacy)add(envFile,(bytes(envFile)?.toString('utf8').trimEnd()??'')+`\nVOLT_BRIDGE_TOKEN=${token}\n`);
	if(!tokenInFile)add(tokenFile,token+'\n');
	const template=readFileSync(join(root,'luau','bootstrap.template.luau'),'utf8');
	const port=parseEnv(bytes(envFile)?.toString('utf8')??'').VOLT_BRIDGE_PORT??'38917';
	if(!/^\d+$/.test(port)||Number(port)<1024||Number(port)>65535)throw new Error('Existing local port is invalid; no setup files were written.');
	add(join(root,'.secrets','rift-bootstrap.local.luau'),template.replace('__VOLT_BRIDGE_URL__',`ws://127.0.0.1:${port}/volt`).replace('__VOLT_BRIDGE_TOKEN__',token).replace('__VOLT_BRIDGE_BUILD__',sha(template).slice(0,12)));
	return{root,configFile,changes,public:{root,configFile,changes:[...changes.map(c=>({path:c.path,action:c.before?'update':'create'})),...(changes.length?[{path:join(root,'.secrets','setup-journal.json'),action:'write private recovery journal (contains original bytes; never publish)'}]:[])],tokenAction:legacy||tokenInFile?'preserve existing credential':'create one local credential',confirmation:`node "${join(root,'dist','cli.js')}" doctor --json`}};
}
export function prepareSetup(plan:SetupPlan):void {
	for(const change of plan.changes){const current=bytes(change.path);if((current===null)!==(change.before===null)||current&&change.before&&!current.equals(change.before))throw new Error('Setup input changed since preview; preview again.');}
	const journal:Journal={version:1,phase:'prepared',root:plan.root,configFile:plan.configFile,files:plan.changes.map(c=>({path:c.path,before:c.before?.toString('base64')??null,afterHash:sha(c.after)}))};
	atomic(join(plan.root,'.secrets','setup-journal.json'),JSON.stringify(journal,null,2));
}
export function recoverSetup(options:{root:string;configFile:string}):boolean {
	const root=resolve(options.root),configFile=resolve(options.configFile),path=join(root,'.secrets','setup-journal.json');if(!existsSync(path))return false;
	const journal=JSON.parse(readFileSync(path,'utf8')) as Journal;
	if(journal.version!==1||journal.root!==root||journal.configFile!==configFile)throw new Error('Recovery journal does not match this setup/configuration.');
	if(journal.phase!=='prepared')return false;
	const allowed=new Set([configFile,join(root,'.env'),join(root,'.secrets','token'),join(root,'.secrets','rift-bootstrap.local.luau')]);
	for(const f of journal.files){
		if(!allowed.has(f.path))throw new Error('Recovery journal contains an unapproved path.');const current=bytes(f.path),before=f.before===null?null:Buffer.from(f.before,'base64');
		if(current&&sha(current)!==f.afterHash&&(!before||!current.equals(before)))throw new Error('Managed file has independent edits; recovery stopped to preserve them.');
	}
	for(const f of [...journal.files].reverse()){if(f.before===null){if(existsSync(f.path))unlinkSync(f.path);}else atomic(f.path,Buffer.from(f.before,'base64'));}
	journal.phase='recovered';atomic(path,JSON.stringify(journal,null,2));return true;
}
export function applySetup(plan:SetupPlan):void {
	if(!plan.changes.length)return;
	prepareSetup(plan);
	try{
		// Credential first, configuration last: a new registration never points at half-written credentials.
		for(const change of [...plan.changes].sort((a,b)=>Number(a.path===plan.configFile)-Number(b.path===plan.configFile)))atomic(change.path,change.after);
		const path=join(plan.root,'.secrets','setup-journal.json'),j=JSON.parse(readFileSync(path,'utf8')) as Journal;j.phase='committed';atomic(path,JSON.stringify(j,null,2));
	}catch(error){recoverSetup(plan);throw error;}
}
export function migratePackage(args:{from:string;to:string;configFile:string;apply:boolean}) {
	const from=resolve(args.from),to=resolve(args.to),configFile=resolve(args.configFile);
	if(from===to) return{changes:[],state:'already_canonical'};
	if(!existsSync(from))throw new Error('Legacy install is missing; check the migration source folder.');
	if(existsSync(to))throw new Error('Migration conflict: old and new install folders both exist. Nothing was written.');
	if(basename(from)!=='volt-bridge'||basename(to)!=='rift-bridge'||dirname(from)!==dirname(to))throw new Error('Migration must rename sibling volt-bridge to rift-bridge.');
	const before=bytes(configFile);
	// Strict rename + registration: no hidden setup/bootstrap/token writes.
	const after=Buffer.from(registration(before?.toString('utf8')??'{}',to,from));
	const changes=[{action:'rename entire package, preserving credential/generated bytes',from,to},{action:'update Rift registration only',path:configFile},{action:'write private recovery journal before moving; carry it with the package',path:join(from,'.secrets','migration-journal.json')}];
	if(!args.apply)return{changes,state:'preview'};
	const journal={version:1,phase:'prepared',from,to,configFile,before:before?.toString('base64')??null,beforeHash:before?sha(before):null,afterHash:sha(after)};
	atomic(join(from,'.secrets','migration-journal.json'),JSON.stringify(journal,null,2));
	renameSync(from,to);
	try{
		const current=bytes(configFile);if((current?sha(current):null)!==journal.beforeHash)throw new Error('Configuration has independent edits; migration stopped to preserve them.');
		atomic(configFile,after);journal.phase='committed';atomic(join(to,'.secrets','migration-journal.json'),JSON.stringify(journal,null,2));
	}catch(e){
		const current=bytes(configFile),hash=current?sha(current):null;
		if(hash!==journal.beforeHash&&hash!==journal.afterHash)throw new Error('Migration interrupted with independent configuration edits. New folder and recovery journal retained; no independent edits were overwritten.');
		if(hash===journal.afterHash){if(before)atomic(configFile,before);else if(existsSync(configFile))unlinkSync(configFile);}
		renameSync(to,from);throw e;
	}
	return{changes,state:'migrated',confirmation:`node "${join(to,'dist','cli.js')}" doctor --json`};
}
export function rollbackMigration(args:{root:string;configFile:string}):void {
	const root=resolve(args.root),configFile=resolve(args.configFile),journal=JSON.parse(readFileSync(join(root,'.secrets','migration-journal.json'),'utf8'));
	if(journal.version!==1||journal.to!==root||journal.configFile!==configFile||basename(journal.from)!=='volt-bridge'||dirname(journal.from)!==dirname(root))throw new Error('Migration recovery identity mismatch.');
	if(existsSync(journal.from))throw new Error('Rollback conflict: legacy folder already exists; nothing was written.');
	const current=bytes(configFile),hash=current?sha(current):null,beforeHash=journal.before===null?null:sha(Buffer.from(journal.before,'base64'));
	if(hash!==journal.afterHash&&hash!==beforeHash)throw new Error('Configuration changed independently; rollback stopped in every phase to preserve those edits.');
	if(hash!==beforeHash){if(journal.before===null){if(existsSync(configFile))unlinkSync(configFile);}else atomic(configFile,Buffer.from(journal.before,'base64'));}
	journal.phase='configuration_restored';atomic(join(root,'.secrets','migration-journal.json'),JSON.stringify(journal,null,2));
	renameSync(root,journal.from);
}
export async function runSetup(argv:string[]):Promise<number>{
	const command=argv[0],apply=argv.includes('--apply'),json=argv.includes('--json'),root=PACKAGE_ROOT;
	const at=argv.indexOf('--config'),configFile=resolve(at>=0?argv[at+1]??'':join(process.cwd(),'.opencode','opencode.json'));
	try{
		let result:unknown;
		if(command==='migrate'&&argv.includes('--rollback')){if(!apply)throw new Error('Rollback writes files; add --apply after reviewing the migration journal.');rollbackMigration({root,configFile});result={state:'rolled_back'};}
		else if(command==='migrate')result=migratePackage({from:root,to:join(dirname(root),'rift-bridge'),configFile,apply});
		else{
			if(apply)recoverSetup({root,configFile});const plan=planSetup({root,configFile});
			if(apply)applySetup(plan);result={schemaVersion:1,state:apply?'configured':'preview',...plan.public,next:apply?'Start rift serve explicitly, then run the confirmation command.':'Review these writes, then repeat with --apply. Nothing has been changed.'};
		}
		process.stdout.write(JSON.stringify(result,null,json?undefined:2)+'\n');return 0;
	}catch(e){process.stderr.write((e instanceof Error?e.message:'Rift setup failed. No credential is printed.')+'\n');return 6;}
}
