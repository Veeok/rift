// Development-only boundary. Never expose the owner's backend to foreign origins.
export function localApiGuard(req,res,next){
  if(!req.url?.startsWith('/api/'))return next();
  const host='127.0.0.2:'+req.socket.localPort,origin='http://'+host;
  const writes=!['GET','HEAD','OPTIONS'].includes(req.method);
  if(req.headers.host!==host || req.headers.origin&&req.headers.origin!==origin || req.headers['sec-fetch-site']==='cross-site' || writes&&req.headers.origin!==origin){
    res.writeHead(403,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:'Only same-origin loopback dashboard requests are allowed.'}));return;
  }
  if(/^\/api\/tools\/(?:execute_luau|share_capture)(?:[/?]|$)/.test(req.url)){
    res.writeHead(403,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:'The dashboard is read-only. Execution and sharing require explicit MCP authorization.'}));return;
  }
  next();
}

export function validateTarget(value){
  const url=new URL(value);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||!/^\d+$/.test(url.port)||Number(url.port)<1024||Number(url.port)>65535)throw new Error('RIFT_API_TARGET must be an http://127.0.0.1:PORT origin (1024–65535), without credentials, path or query.');
  return url.origin;
}
