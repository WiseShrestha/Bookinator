/* Deterministic self-consistency audit using the independent demo's response model.
   No target-ID leakage, human benchmark, or original Claude app test is claimed. */
'use strict';
const fs=require('fs'),path=require('path'),E=require('../five_book_demo/engine.cjs');
const root=path.resolve(__dirname,'..');
const scoreArg=process.argv.find(x=>x.startsWith('--min-score='));
const minScore=scoreArg?Number(scoreArg.split('=')[1]):.008;
const reportArg=process.argv.find(x=>x.startsWith('--report='));
const report=reportArg?reportArg.split('=')[1]:'catalog_engine_self_consistency.json';
const matrix=JSON.parse(fs.readFileSync(path.join(root,'data/core500_researched_candidate_matrix.json')));
const questions=JSON.parse(fs.readFileSync(path.join(root,'questions_64.json')));
const books=matrix.books.filter(b=>!b.form_quarantine);
const data={books,questions:questions.map((q,i)=>({id:q.id,group:q.category,weight:q.recallability,p_yes:books.map(b=>b.p_yes[i])}))};
// H(A)-E_b[H(A|b)] equals the demo's H(B)-E_a[H(B|a)].
// Cache conditional entropies; this avoids many temporary arrays on 492 targets.
const cond=data.questions.map(q=>q.p_yes.map(x=>E.entropy([0,1,2,3,4].map(a=>E.likelihood(x,a)))));
function gain(p,i){let mean=0,expected=0;const xs=data.questions[i].p_yes,hs=cond[i];for(let b=0;b<p.length;b++){mean+=p[b]*xs[b];expected+=p[b]*hs[b];}return E.entropy([0,1,2,3,4].map(a=>E.likelihood(mean,a)))-expected;}
const uniform=books.map(()=>1/books.length);
for(const i of [0,16,20,52,56,63])if(Math.abs(gain(uniform,i)-E.informationGain(data,uniform,i))>1e-10)throw Error('Information-gain equivalence failed');
function next(events){
 const p=E.posterior(data,events),ranked=p.map((prob,b)=>({b,p:prob})).sort((a,b)=>b.p-a.p||a.b-b.b);
 const informative=events.filter(e=>e.answer!==2).length,top=ranked[0],second=ranked[1];
 if(informative>=3&&top.p>=.8&&top.p/second.p>=4)return{type:'guess',p,ranked};
 if(events.length>=18)return{type:'shortlist',p,ranked};
 const asked=new Set(events.map(e=>e.q)),groups=new Set(events.map(e=>data.questions[e.q].group));let best={i:-1,score:-Infinity};
 for(let i=0;i<data.questions.length;i++){if(asked.has(i))continue;const q=data.questions[i],score=gain(p,i)*(q.weight??1)*(groups.has(q.group)?.3:1);if(score>best.score)best={i,score};}
 return best.i<0||best.score<minScore?{type:'shortlist',p,ranked}:{type:'ask',q:best.i,p,ranked};
}
// Verify the optimized selector against the existing engine at several states.
for(const events of (minScore===.008?[[],[{kind:'answer',q:0,answer:0}],[{kind:'answer',q:0,answer:0},{kind:'answer',q:16,answer:2},{kind:'answer',q:56,answer:4}]]:[])){
 const a=next(events),b=E.next(data,events,{minInformative:3,maxQuestions:18});
 if(a.type!==b.type||(a.type==='ask'&&a.q!==b.q))throw Error('Question-selector equivalence failed');
}
const games=[];
for(let target=0;target<books.length;target++){
 const events=[];let state;
 while((state=next(events)).type==='ask'){
  const x=data.questions[state.q].p_yes[target];events.push({kind:'answer',q:state.q,answer:x>.5?0:x<.5?4:2});
 }
 const rank=state.ranked.findIndex(r=>r.b===target)+1;
 games.push({book_id:books[target].id,title:books[target].title,known_count:books[target].known_count,questions:events.length,result:state.type,target_rank:rank,top1:rank===1,top3:rank<=3,confident_correct:state.type==='guess'&&rank===1,confident_wrong:state.type==='guess'&&rank!==1,answers:events.map(e=>({question_id:data.questions[e.q].id,answer:E.ANSWERS[e.answer]}))});
 if((target+1)%100===0)process.stdout.write(`Audited ${target+1}/${books.length} targets\n`);
}
const sum=(key,rows=games)=>rows.filter(x=>x[key]).length;
const summary={scope:'Deterministic fixture self-consistency with independent five-book demo response model; not the Claude app, human factual accuracy, or playtest.',
 candidate_pool:books.length,question_limit:18,minimum_weighted_information_gain:minScore,response_policy:'Known qualified Yes becomes Yes; qualified No becomes No; unknown becomes Don\'t know. Equal book prior.',
 games:games.length,top1:sum('top1'),top3:sum('top3'),confident_correct:sum('confident_correct'),confident_wrong:sum('confident_wrong'),shortlists:games.filter(x=>x.result==='shortlist').length,
 average_questions:games.reduce((s,x)=>s+x.questions,0)/games.length,
 count_gate_subset:{targets:games.filter(x=>x.known_count>=12).length,top1:sum('top1',games.filter(x=>x.known_count>=12)),top3:sum('top3',games.filter(x=>x.known_count>=12))},
 limitation:'Sparse and correlated features can leave ambiguous shortlists; probability values are not calibrated. Do not activate all candidates based on this audit.'};
fs.writeFileSync(path.join(root,'reports',report),JSON.stringify({summary,games},null,2)+'\n');
process.stdout.write(JSON.stringify(summary,null,2)+'\n');
