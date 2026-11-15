export function validateEvidence(data,expected){
 const session=data?.session;
 const id=session?.readerSession??data?.sessionId;
 if(typeof id!=='string')throw new Error('Result session is unverified; refresh current evidence.');
 if(id!==expected.id)throw new Error('Result belongs to a different reader session; refresh current evidence.');
 const connection=session?.connectionId??data?.connectionId;
 if(connection!==undefined&&connection!==expected.connectionId)throw new Error('Reader connection changed; refresh current evidence.');
 return {connectionVerified:typeof connection==='string'};
}
export function mergeLogNotice(previous,page){
 const retained=previous?.match(/^Retention gap:[^\n]+/)?.[0];
 const gap=page.gap?`Retention gap: sequences ${page.gap.fromSeq}–${page.gap.toSeq} are unavailable.`:retained;
 return [gap,typeof page.notice==='string'?page.notice:null].filter(Boolean).join('\n');
}
export function sourceContinuation(metadata){
 if(metadata?.status==='pending'){
  if(typeof metadata.jobId!=='string'||!metadata.jobId)throw new Error('Pending source has no valid job reference.');
  return {kind:'pending',jobId:metadata.jobId};
 }
 const line=metadata?.source?.nextStartLine;
 return Number.isSafeInteger(line)&&line>0?{kind:'page',startLine:line}:null;
}
