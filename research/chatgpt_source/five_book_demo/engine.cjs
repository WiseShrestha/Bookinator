/* Local Bayesian demonstration; no network, model API, or stored target choice. */
'use strict';
const ThatBookEngine=(()=>{
 const CHANNEL_Y=[.55,.20,.10,.10,.05],CHANNEL_N=[.05,.10,.10,.20,.55];
 const ANSWERS=['Yes','Probably',"Don't know",'Probably not','No'];
 const entropy=p=>-p.reduce((s,x)=>s+(x>0?x*Math.log2(x):0),0);
 function likelihood(x,a){return x*CHANNEL_Y[a]+(1-x)*CHANNEL_N[a];}
 function posterior(data,events){
  const rejected=new Set(events.filter(e=>e.kind==='reject').map(e=>e.book));
  const logs=data.books.map((_,b)=>{
   if(rejected.has(b))return -Infinity;
   return events.reduce((s,e)=>e.kind==='answer'?s+Math.log(likelihood(data.questions[e.q].p_yes[b],e.answer)):s,0);
  });
  const mx=Math.max(...logs);if(!Number.isFinite(mx))return null;
  const p=logs.map(l=>Math.exp(l-mx));const total=p.reduce((a,b)=>a+b,0);
  return p.map(x=>x/total);
 }
 function informationGain(data,p,qi){
  const q=data.questions[qi];let after=0;
  for(let a=0;a<5;a++){
   const joint=p.map((x,b)=>x*likelihood(q.p_yes[b],a));const mass=joint.reduce((x,y)=>x+y,0);
   if(mass>0)after+=mass*entropy(joint.map(x=>x/mass));
  }
  return entropy(p)-after;
 }
 function next(data,events,options={}){
  const minimum=options.minInformative??3,maximum=options.maxQuestions??10;
  const p=posterior(data,events);if(!p)return {type:'none',reason:'All five titles were rejected.'};
  const ranked=p.map((x,b)=>({b,p:x})).filter(x=>x.p>0).sort((x,y)=>y.p-x.p||x.b-y.b);
  const answered=events.filter(e=>e.kind==='answer'),asked=new Set(answered.map(e=>e.q));
  const informative=answered.filter(e=>e.answer!==2).length;
  const top=ranked[0],second=ranked[1];
  if((informative>=minimum&&top.p>=.80&&(!second||top.p/second.p>=4))||(!second&&informative>0))
   return {type:'guess',book:top.b,p,ranked};
  const usedGroups=new Set(answered.map(e=>data.questions[e.q].group));
  const available=data.questions.map((q,i)=>({q,i})).filter(({i})=>!asked.has(i));
  if(answered.length>=maximum||!available.length)return {type:'shortlist',ranked:ranked.slice(0,3),p};
  // Soft group penalty limits near-duplicate questions without blocking recovery.
  const best=available.map(({q,i})=>({i,score:informationGain(data,p,i)*(q.weight??1)*(usedGroups.has(q.group)?.3:1)}))
   .sort((x,y)=>y.score-x.score||x.i-y.i)[0];
  if(best.score<.008)return {type:'shortlist',ranked:ranked.slice(0,3),p};
  return {type:'ask',q:best.i,p,ranked};
 }
 return {ANSWERS,posterior,informationGain,next,likelihood,entropy};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=ThatBookEngine;
