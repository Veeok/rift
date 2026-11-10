#!/usr/bin/env node
import {loadConfig} from './config.js';
import {startService,EXIT_CODES} from './service.js';
import {ServiceClient,apiPort} from './service-client.js';
import {makeRedactor} from './redact.js';

const help=`Rift — local Roblox client inspection\n\nUsage: rift status [--json]\n       rift doctor [--json]\n       rift serve\n       rift setup [--apply] [--config <OpenCode JSON/JSONC path>]\n       rift migrate [--apply | --rollback] [--config <path>]\n\nNo command starts a background service. Start serve explicitly, then use OpenCode and the local dashboard together.\nExit codes: 0 healthy; 2 bridge offline; 3 no client; 4 build mismatch; 5 stale; 6 configuration/authentication/selection; 64 usage; 70 unexpected failure.\n`;
function human(s:any,doctor:boolean):string{
	const lines=[`Rift · ${s.state}`,`Session  ${s.session?.name??'—'} · ${s.session?.clientName??'no client'} (${s.session?.id??'none'})`,
		`Build    ${s.build?.serviceBuild??'not running'} · reader ${s.build?.reportedReaderBuild??'—'}`,`Updated  ${s.freshness?.lastUpdate??'never'}${s.freshness?.ageMs===null?'':` (${s.freshness?.ageMs??0} ms ago)`}`,
		`Reports  ${(s.capabilities??[]).join(', ')||'no reported capabilities'}`];
	if(doctor)lines.push(`Check    ${s.failedCheck??'all required health checks passed'}`);
	if(s.error||s.recovery)lines.push(`Action   ${s.recovery??s.error?.recovery}`);
	return lines.join('\n')+'\n';
}
export async function runCli(argv:string[]):Promise<number>{
	const command=argv[0],json=argv.includes('--json');
	if(!command||command==='--help'||command==='help'){process.stdout.write(help);return 0;}
	if(!['status','doctor','serve','setup','migrate'].includes(command)){process.stderr.write('Unknown Rift command. Use rift --help.\n');return 64;}
	if(command==='setup'||command==='migrate'){
		const path='./windows-setup.js';const setup=await import(path);return setup.runSetup(argv);
	}
	if(argv.slice(1).some(x=>x!=='--json')||command==='serve'&&json){process.stderr.write('Unsupported arguments. Use rift --help.\n');return 64;}
	try{
		if(command==='serve'){
			const config=loadConfig();const service=await startService({...config,apiPort:apiPort()});
			process.stderr.write(`Rift service ready · http://127.0.0.1:${service.apiPort}\n`);
			await new Promise<void>(resolve=>{let ending=false;const end=()=>{if(ending)return;ending=true;void service.stop().then(resolve);};for(const signal of ['SIGINT','SIGTERM','SIGBREAK'] as const)process.once(signal,end);});return 0;
		}
		const client=new ServiceClient();const value=await client.request('/api/'+command);
		process.stdout.write(json?JSON.stringify(value)+'\n':human(value,command==='doctor'));
		return EXIT_CODES[value.state as keyof typeof EXIT_CODES]??70;
	}catch(e){
		const offline=(e as any).code==='bridge_offline',state=offline?'bridge_offline':'configuration_error';
		const redact=makeRedactor(Object.entries(process.env).filter(([k,v])=>/token|secret|password|api.key/i.test(k)&&!!v).map(([,v])=>v!));
		const message=redact(e instanceof Error?e.message:'Rift failed.');
		const recovery=offline?'Start node dist/cli.js serve in the Rift folder.':'Run rift setup to preview the local configuration, then rift doctor.';
		const value={schemaVersion:1,apiVersion:1,state,observedAt:new Date().toISOString(),session:null,build:null,freshness:{lastUpdate:null,ageMs:null,staleAfterMs:15000},capabilities:[],activity:null,error:{check:offline?'bridge_online':'configuration',message,recovery},...(command==='doctor'?{ok:false,failedCheck:offline?'bridge_online':'configuration',recovery,checks:[{id:offline?'bridge_online':'configuration',pass:false}]}:{})};
		process.stdout.write(json?JSON.stringify(value)+'\n':human(value,command==='doctor'));return offline?2:6;
	}
}
if(import.meta.url===new URL(process.argv[1]??'', 'file:///').href || process.argv[1]?.replaceAll('\\','/').endsWith('/cli.js')){
	runCli(process.argv.slice(2)).then(code=>{process.exitCode=code;},()=>{process.stderr.write('Rift failed unexpectedly. Run rift doctor.\n');process.exitCode=70;});
}
