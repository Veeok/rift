import {loadConfig,loadEnvironment,DEFAULT_ENV_FILE} from './config.js';
import {DEFAULT_API_PORT,API_VERSION} from './service.js';

export function apiPort(env:NodeJS.ProcessEnv=process.env,envFile=DEFAULT_ENV_FILE):number{
	const local=loadEnvironment({},envFile);
	const value=Number(env.RIFT_API_PORT??env.VOLT_BRIDGE_API_PORT??local.RIFT_API_PORT??local.VOLT_BRIDGE_API_PORT??DEFAULT_API_PORT);
	if(!Number.isInteger(value)||value<1024||value>65535)throw new Error('RIFT_API_PORT must be an integer 1024–65535.');return value;
}
export class ServiceClient {
	private readonly port:number;private readonly token:string;
	constructor(){const config=loadConfig();if(!config.token)throw new Error('Rift credential is missing or invalid; run rift setup --apply.');this.token=config.token;this.port=apiPort();}
	async request(path:string,body?:unknown):Promise<any>{
		if(!/^\/api\/(?:status|doctor|catalog|tools\/[a-z_]+)$/.test(path))throw new Error('Unsupported local service route.');
		let response:Response;
		try{response=await fetch(`http://127.0.0.1:${this.port}${path}`,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${this.token}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(90_000),redirect:'error'});}
		catch{throw Object.assign(new Error('Rift bridge is offline. Start node dist/cli.js serve in the Rift folder.'),{code:'bridge_offline'});}
		if(response.status===401||response.status===403)throw Object.assign(new Error('Rift service refused authentication. Use the same local credential as the foreground service.'),{code:'authentication_failed'});
		if(!response.ok)throw new Error(`Rift service returned HTTP ${response.status}. Run rift doctor.`);
		const value=await response.json() as any;
		if(value.apiVersion!==undefined&&value.apiVersion!==API_VERSION)throw new Error('Rift API version mismatch. Rebuild and restart the matching local service.');
		return value;
	}
	call(name:string,args:unknown){return this.request('/api/tools/'+name,args);}
}
