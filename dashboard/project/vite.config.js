import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {createPreviewApi} from './tools/preview-api.mjs';

const root=fileURLToPath(new URL('.',import.meta.url));
// A different loopback host keeps the real Rift cookie out of this fixture server.
const host='127.0.0.2';
export default defineConfig(({command,mode})=>{
 const runtime=mode==='runtime'&&command==='build';
 if(mode!=='preview'&&!runtime)throw new Error('Only synthetic preview or an explicit private runtime build is allowed.');
 const headers={
  'Content-Security-Policy':`default-src 'self'; script-src 'self'; style-src 'self'${command==='serve'?" 'unsafe-inline'":''}; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store',
 };
 return {root,base:'./',publicDir:false,plugins:[{
  name:'m115-isolated-synthetic-preview',
  configureServer(server){if(!runtime)server.middlewares.use(createPreviewApi());},
  configurePreviewServer(server){if(!runtime)server.middlewares.use(createPreviewApi());},
  transformIndexHtml(html){return runtime?html.replace('Rift · Synthetic reconstruction','Rift · Local inspection').replace('./theme-init.js','./health-state.js'):html;},
  generateBundle(){this.emitFile({type:'asset',fileName:runtime?'health-state.js':'theme-init.js',source:readFileSync(root+'theme-init.js')});},
 }],server:{host,port:41734,strictPort:true,cors:false,hmr:false,headers},
 preview:{host,port:41735,strictPort:true,cors:false,headers},build:{assetsInlineLimit:0,outDir:runtime?'../':'dist',emptyOutDir:false,...(runtime?{rollupOptions:{output:{entryFileNames:'app.js',chunkFileNames:'assets/[name]-[hash].js',assetFileNames:asset=>asset.names?.some(name=>name.endsWith('.css'))?'style.css':'assets/[name]-[hash][extname]'}}}:{})}};
});
