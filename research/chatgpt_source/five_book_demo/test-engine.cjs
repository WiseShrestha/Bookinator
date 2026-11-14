'use strict';
const assert=require('node:assert/strict');
const E=require('./engine.cjs'),D=require('./fixture.json');
let checks=0;const check=(f)=>{f();checks++;};
check(()=>assert.deepEqual(E.posterior(D,[]),[.2,.2,.2,.2,.2]));
check(()=>assert.deepEqual(E.posterior(D,[{kind:'answer',q:0,answer:2}]),[.2,.2,.2,.2,.2]));
check(()=>{const p=E.posterior(D,[{kind:'answer',q:0,answer:0}]);assert(p.every(x=>x>0));});
check(()=>{const p=E.posterior(D,[{kind:'answer',q:0,answer:0}]);const pp=E.posterior(D,[{kind:'answer',q:0,answer:1}]);assert(p[1]>pp[1]);});
check(()=>assert(E.informationGain(D,E.posterior(D,[]),0)>0));
check(()=>{const p=E.posterior(D,[{kind:'reject',book:0}]);assert.equal(p[0],0);assert.equal(p.reduce((a,b)=>a+b,0),1);});
check(()=>assert.equal(E.posterior(D,D.books.map((_,book)=>({kind:'reject',book}))),null));
check(()=>{const events=[{kind:'answer',q:0,answer:0}];events.pop();assert.deepEqual(E.posterior(D,events),[.2,.2,.2,.2,.2]);});
check(()=>{let events=[];for(let i=0;i<10;i++){let a=E.next(D,events);if(a.type!=='ask')break;events.push({kind:'answer',q:a.q,answer:2});}assert.equal(E.next(D,events).type,'shortlist');});
const clean=[];
for(let target=0;target<5;target++){
 const events=[];let outcome=null;
 for(let i=0;i<15;i++){
  const a=E.next(D,events);
  if(a.type==='ask'){
   const x=D.questions[a.q].p_yes[target];events.push({kind:'answer',q:a.q,answer:x>.5?0:x<.5?4:2});
  }else{outcome=a;break;}
 }
 const correct=outcome?.type==='guess'&&outcome.book===target;
 check(()=>assert(correct,`clean game failed for ${D.books[target].title}`));
 clean.push({title:D.books[target].title,questions:events.length,first_guess_correct:correct});
}
check(()=>{const events=[{kind:'reject',book:1}];const p=E.next(D,events);assert(p.type==='ask');assert.equal(p.p[1],0);});
console.log(JSON.stringify({checks_passed:checks,clean_fixture_games:clean,note:'Self-consistency against a five-book AI-curated fixture; not factual validation, human accuracy, or a test of Claude\'s actual app.'},null,2));
