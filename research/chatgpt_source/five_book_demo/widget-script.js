
  (()=>{
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

    const DEMO_DATA={
  "books": [
    {
      "id": "cmu:enwiki:20128213",
      "title": "The Hunger Games",
      "author": "Suzanne Collins",
      "library_url": "https://openlibrary.org/search?title=The+Hunger+Games&author=Suzanne+Collins"
    },
    {
      "id": "cmu:enwiki:48648",
      "title": "Harry Potter and the Philosopher's Stone",
      "author": "J. K. Rowling",
      "library_url": "https://openlibrary.org/search?title=Harry+Potter+and+the+Philosopher%27s+Stone&author=J.+K.+Rowling"
    },
    {
      "id": "cmu:enwiki:4451267",
      "title": "Twilight",
      "author": "Stephenie Meyer",
      "library_url": "https://openlibrary.org/search?title=Twilight&author=Stephenie+Meyer"
    },
    {
      "id": "cmu:enwiki:73408",
      "title": "To Kill a Mockingbird",
      "author": "Harper Lee",
      "library_url": "https://openlibrary.org/search?title=To+Kill+a+Mockingbird&author=Harper+Lee"
    },
    {
      "id": "cmu:enwiki:76033",
      "title": "The Great Gatsby",
      "author": "F. Scott Fitzgerald",
      "library_url": "https://openlibrary.org/search?title=The+Great+Gatsby&author=F.+Scott+Fitzgerald"
    }
  ],
  "questions": [
    {
      "id": "q08",
      "text": "Does a central character have supernatural abilities?",
      "p_yes": [
        0.1,
        0.9,
        0.9,
        0.1,
        0.1
      ],
      "group": "supernatural",
      "weight": 1
    },
    {
      "id": "q09",
      "text": "Is a school a major setting?",
      "p_yes": [
        0.1,
        0.9,
        0.9,
        0.1,
        0.1
      ],
      "group": "school",
      "weight": 1
    },
    {
      "id": "q13",
      "text": "Does much of the story take place in Britain?",
      "p_yes": [
        0.1,
        0.9,
        0.1,
        0.1,
        0.1
      ],
      "group": "location",
      "weight": 1
    },
    {
      "id": "q18",
      "text": "Is most of the story set between 1900 and 1945?",
      "p_yes": [
        0.1,
        0.1,
        0.1,
        0.9,
        0.9
      ],
      "group": "era",
      "weight": 0.85
    },
    {
      "id": "q21",
      "text": "Is the story set in an imagined future?",
      "p_yes": [
        0.9,
        0.1,
        0.1,
        0.1,
        0.1
      ],
      "group": "future",
      "weight": 1
    },
    {
      "id": "q23",
      "text": "Has a large disaster already changed society when the story begins?",
      "p_yes": [
        0.9,
        0.1,
        0.1,
        0.1,
        0.1
      ],
      "group": "future",
      "weight": 0.8
    },
    {
      "id": "q31",
      "text": "Is a competition or tournament central to the premise?",
      "p_yes": [
        0.9,
        0.1,
        0.1,
        0.1,
        0.1
      ],
      "group": "competition",
      "weight": 1
    },
    {
      "id": "q26",
      "text": "Is a romantic relationship a main storyline?",
      "p_yes": [
        0.7,
        0.1,
        0.9,
        0.1,
        0.9
      ],
      "group": "romance",
      "weight": 0.85
    },
    {
      "id": "q49",
      "text": "Is much of the book narrated using “I”?",
      "p_yes": [
        0.9,
        0.1,
        0.9,
        0.9,
        0.9
      ],
      "group": "narration",
      "weight": 0.8
    },
    {
      "id": "q01",
      "text": "Is a child or teenager a central character?",
      "p_yes": [
        0.9,
        0.9,
        0.9,
        0.9,
        0.1
      ],
      "group": "age",
      "weight": 1
    },
    {
      "id": "q14",
      "text": "Does much of the story take place in the United States?",
      "p_yes": [
        0.5,
        0.1,
        0.9,
        0.9,
        0.9
      ],
      "group": "location",
      "weight": 0.8
    },
    {
      "id": "q44",
      "text": "Does it strongly focus on social class or inequality?",
      "p_yes": [
        0.9,
        0.3,
        0.1,
        0.9,
        0.9
      ],
      "group": "theme",
      "weight": 0.6
    }
  ],
  "data_status": "AI-curated five-book demonstration fixture; not a human-reviewed 500-book matrix.",
  "production_catalog_coverage": false
};
    const root=document.getElementById('tb-five');
    const stage=root.querySelector('#tb-stage'),undo=root.querySelector('#tb-undo');
    const restart=root.querySelector('#tb-restart'),count=root.querySelector('#tb-count');
    const history=root.querySelector('#tb-history-list'),collection=root.querySelector('.tb-collection');
    const E=ThatBookEngine,D=DEMO_DATA;
    let events=[],outcome=null,confirmed=null,declinedShortlist=false;
    const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function render(){
      const answers=events.filter(e=>e.kind==='answer');
      count.textContent=answers.length+' answer'+(answers.length===1?'':'s');
      undo.disabled=events.length===0&&confirmed===null&&!declinedShortlist;
      history.innerHTML=events.map(e=>e.kind==='answer'
        ?'<li>'+esc(D.questions[e.q].text)+' <strong>'+esc(E.ANSWERS[e.answer])+'</strong></li>'
        :'<li>Ruled out: '+esc(D.books[e.book].title)+'</li>').join('')||'<li>No answers yet.</li>';
      if(confirmed!==null){
        const book=D.books[confirmed];
        stage.innerHTML='<span class="viz-badge">Found it</span><h3>'+esc(book.title)+'</h3><div class="tb-line">'+esc(book.author)+'</div><a class="btn" href="'+esc(book.library_url)+'" target="_blank" rel="noopener noreferrer">Find in Open Library</a>';
        return;
      }
      if(declinedShortlist){
        stage.innerHTML='<h3>We haven’t found it.</h3><div>Review your answers or start again with one of the five supported titles.</div>';
        return;
      }
      outcome=E.next(D,events);
      if(outcome.type==='ask'){
        stage.innerHTML='<span class="text-small text-muted">Question '+(answers.length+1)+'</span><h3>'+esc(D.questions[outcome.q].text)+'</h3><div class="viz-controls">'+E.ANSWERS.map((a,i)=>'<button type="button" class="btn" data-answer="'+i+'">'+esc(a)+'</button>').join('')+'</div>';
      }else if(outcome.type==='guess'){
        const book=D.books[outcome.book];
        stage.innerHTML='<span class="text-small text-muted">My best match</span><h3>Is it '+esc(book.title)+'?</h3><div>'+esc(book.author)+'</div><div class="tb-actions"><button type="button" class="btn btn-primary" data-confirm="'+outcome.book+'">Yes, that’s it</button><button type="button" class="btn" data-reject="'+outcome.book+'">Not this book</button></div>';
      }else if(outcome.type==='shortlist'){
        stage.innerHTML='<h3>Do you recognize your book?</h3><div class="tb-shortlist">'+outcome.ranked.map(({b})=>'<button type="button" class="btn btn-block" data-confirm="'+b+'">'+esc(D.books[b].title)+'</button>').join('')+'</div><div class="tb-actions"><button type="button" class="btn btn-ghost" data-no-match>None of these</button></div>';
      }else{
        stage.innerHTML='<h3>No title left in this test collection.</h3><div>Undo a rejection or start again.</div>';
      }
    }
    stage.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button||!stage.contains(button))return;
      if(button.hasAttribute('data-answer')&&outcome?.type==='ask'){
        events.push({kind:'answer',q:outcome.q,answer:Number(button.dataset.answer)});collection.open=false;
      }else if(button.hasAttribute('data-confirm'))confirmed=Number(button.dataset.confirm);
      else if(button.hasAttribute('data-reject'))events.push({kind:'reject',book:Number(button.dataset.reject)});
      else if(button.hasAttribute('data-no-match'))declinedShortlist=true;
      render();
    });
    undo.addEventListener('click',()=>{
      if(confirmed!==null)confirmed=null;
      else if(declinedShortlist)declinedShortlist=false;
      else events.pop();
      render();
    });
    restart.addEventListener('click',()=>{events=[];confirmed=null;declinedShortlist=false;collection.open=true;render();});
    render();
  })();
  