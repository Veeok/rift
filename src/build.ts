import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {PACKAGE_ROOT} from './config.js';

const hash=(text:string|Buffer)=>createHash('sha256').update(text).digest('hex');
export function buildIdentity(){
	const template=readFileSync(join(PACKAGE_ROOT,'luau','bootstrap.template.luau'));
	const files=readdirSync(join(PACKAGE_ROOT,'dist')).filter(f=>f.endsWith('.js')).sort();
	const h=createHash('sha256');for(const f of files)h.update(f).update(readFileSync(join(PACKAGE_ROOT,'dist',f)));
	h.update(template);
	return{serviceVersion:'0.3.0',serviceBuild:h.digest('hex').slice(0,16),expectedReaderBuild:hash(template).slice(0,12)};
}
