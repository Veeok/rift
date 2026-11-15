export function createDiagnosticsView(document,raw){
 const create=(tag,className,text)=>{const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;};
 const icon=name=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','od-icon');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','#i-'+name);svg.append(use);return svg;};
 const originalParent=raw.parentElement,banner=create('p','warning doctor-fail-banner'),summary=create('p','doctor-summary'),tiles=create('div','doctor-tiles'),details=create('details','disclosure doctor-raw'),heading=create('summary',null,'Raw JSON');
 banner.setAttribute('role','alert');heading.prepend(icon('terminal'));details.append(heading);raw.before(banner,summary,tiles,details);details.append(raw);
 for(const node of [banner,summary,tiles,details])node.hidden=true;
 return {
  render(result){
   const checks=Array.isArray(result.checks)?result.checks.slice(0,64):[];
   const verdict=c=>c.pass===false||c.ok===false||c.status==='fail'?'fail':c.pass===true||c.ok===true||c.status==='pass'?'pass':'unknown';
   const fail=checks.filter(c=>verdict(c)==='fail'),pass=checks.filter(c=>verdict(c)==='pass');
   banner.hidden=fail.length===0;banner.textContent=fail.length?`${fail.length} ${fail.length===1?'check needs':'checks need'} attention. Fix the problem, then run diagnostics again.`:'';
   summary.replaceChildren();for(const [kind,count,label]of [['pass',pass.length,'passed'],['fail',fail.length,'failed'],['unknown',checks.length-pass.length-fail.length,'unverified']]){
    if(!count)continue;const badge=create('span','doctor-count',count+' '+label);badge.dataset.verdict=kind;badge.prepend(icon(kind==='pass'?'check':kind==='fail'?'alert':'info'));summary.append(badge);
   }
   tiles.replaceChildren();
   for(const [key,value]of Object.entries(result).slice(0,32)){
    const tile=create('section','doctor-tile'),title=create('h3');tile.dataset.kind=['state','checks','session','build'].includes(key)?'identity':'source';
    title.textContent=key.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,x=>x.toUpperCase());
    title.prepend(icon(key==='checks'?'check':key==='state'?'gauge':key==='synthetic'?'tag':'info'));tile.append(title);
    if(key==='checks'){
     const list=create('ul','doctor-checks');for(const check of checks){const li=create('li');const v=verdict(check);li.dataset.verdict=v;li.append(icon(v==='pass'?'check':v==='fail'?'alert':'info'),create('span',null,String(check.name??check.id??'Unnamed check')),create('span',null,v));list.append(li);}tile.append(list);
    }else tile.append(create('p','doctor-value',typeof value==='object'&&value!==null?JSON.stringify(value).slice(0,2000):String(value)));
    tiles.append(tile);
   }
   summary.hidden=!checks.length;tiles.hidden=false;details.hidden=false;
  },
  reset(){for(const node of [banner,summary,tiles,details])node.hidden=true;tiles.replaceChildren();summary.replaceChildren();details.open=false;},
  dispose(){originalParent.append(raw);for(const node of [banner,summary,tiles,details])node.remove();},
 };
}
