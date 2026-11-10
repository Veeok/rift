// Synthetic reader at the existing WebSocket boundary; never a real client compatibility claim.
import {WebSocket} from 'ws';
export async function until(predicate,timeoutMs=4000){const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){const value=await predicate();if(value)return value;await new Promise(r=>setTimeout(r,10));}throw new Error('Fixture condition timed out');}
export async function connectReader({port,token,build,session='client-fixture-one',name='Synthetic Rift Client',handler=()=>({}),capabilities=['getscripts','decompile','exec']}){
 const ws=new WebSocket(`ws://127.0.0.1:${port}/volt`);let executions=0,authenticated=false;
 const closed=new Promise(resolve=>ws.once('close',resolve));
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{ws.terminate();reject(new Error('Synthetic reader authentication timed out'));},5000);
  ws.once('error',error=>{clearTimeout(timer);reject(error);});
  ws.on('message',async raw=>{
   const message=JSON.parse(raw);
   if(message.type==='hello')ws.send(JSON.stringify({v:1,type:'auth',nonce:message.nonce,token,reader:{session,readerBuild:build,readerVersion:'1',generation:1,placeId:0,capabilities,executor:{name,version:'fixture'}}}));
   if(message.type==='auth_ok'){authenticated=true;clearTimeout(timer);resolve();}
   if(message.type==='auth_fail'){clearTimeout(timer);reject(new Error('Synthetic reader authentication refused'));}
   if(message.type==='ping'&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({v:1,type:'pong',t:message.t}));
   if(message.type==='req'){
    if(message.op==='exec')executions++;
    try{const result=await handler(message);if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({v:1,type:'res',id:message.id,ok:true,result}));}
    catch(error){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({v:1,type:'res',id:message.id,ok:false,error:{code:'fixture_failure',message:String(error)}}));}
   }
  });
  ws.once('close',()=>{if(!authenticated){clearTimeout(timer);reject(new Error('Synthetic reader closed before authentication'));}});
 });
 return{ws,session,get executions(){return executions;},log(message,level='info'){ws.send(JSON.stringify({v:1,type:'log',message,level}));},async close(){if(ws.readyState!==WebSocket.CLOSED)ws.terminate();await closed;}};
}
