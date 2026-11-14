#!/usr/bin/env python3
"""Reproducible conservative draft labels from the supplied synopsis text.

This is an evidence-extraction pass, not a human or model factual review. It
deliberately keeps unsupported negatives and external bibliography unknown.
"""
import argparse, collections, csv, hashlib, json, re
from pathlib import Path

# A matching phrase is only promoted in the limited narrative-premise region.
# Structure statements can be found anywhere, but remain marked for review.
RULES={
 1:[r'\b(?:teenage|teenager|adolescent)\b',r'\b(?:eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)[ -]+year[ -]+old\b',r'\b(?:1[0-9]|[5-9])[ -]+year[ -]+old\b'],
 2:[r'\b(?:young|teenage|adolescent|little) (?:girl|woman)\b',r'\b(?:protagonist|narrator|main character)[^.]{0,90}\b(?:girl|woman|her|she)\b'],
 3:[r'\b(?:young|teenage|adolescent|little) (?:boy|man)\b',r'\b(?:protagonist|narrator|main character)[^.]{0,90}\b(?:boy|man|his|he)\b'],
 4:[r'\b(?:three|four|five|several|multiple|two) (?:principal|main|central) (?:characters|storylines|protagonists)\b',r'\balternating (?:first.person )?perspectives\b'],
 6:[r'\b(?:attends|attending|enrolled (?:in|at)|student at|studying at) [^.]{0,70}\b(?:school|academy|college|university)\b'],
 7:[r'\b(?:police detective|private detective|private investigator|homicide detective|FBI (?:trainee|agent)|detective (?:Harry|Jane|Thomas|Rob|Cassie))\b'],
 8:[r'\b(?:he|she|Harry|Percy|Matilda) (?:is|was|has|can)[^.]{0,50}\b(?:wizard|witch|telepath|telekinetic|supernatural|powers)\b'],
 9:[r'\b(?:boarding school|school for wizards|Hogwarts School|magic school)\b'],
 11:[r'\b(?:set in|takes place in) (?:the |a )?(?:small |rural |remote )?(?:village|farm|countryside)\b'],
 12:[r'\b(?:set in|takes place in|living in) [^.]{0,65}\b(?:Korea|Seoul|Pyongyang)\b'],
 15:[r'\b(?:set in|takes place in) (?:an? |the )?(?:parallel|fictional|fantasy|invented|imaginary|secondary) world\b'],
 23:[r'\bafter (?:a |an |the )?(?:global (?:atomic|nuclear) war|nuclear (?:war|holocaust)|apocalyptic (?:event|disaster)|pandemic)\b',r'\bpost.apocalyptic\b'],
 24:[r'\b(?:set|takes place|during|midst of)[^.]{0,100}\b(?:World War (?:I|II|One|Two)|First World War|Second World War|American Civil War|Spanish Civil War)\b'],
 25:[r'\b(?:investigat\w*|solv\w*) [^.]{0,70}\b(?:murder|crime|killing|disappearance)\b',r'\b(?:serial killer|murder investigation|murder mystery|works the case)\b'],
 26:[r'\b(?:falls? in love|romantic relationship|love triangle|in love with)\b'],
 27:[r'\b(?:long journey|road trip|quest to|journey to (?:find|reach|save|deliver)|voyage to|trek across)\b'],
 28:[r'\b(?:fight to the death|struggle to survive|fighting for (?:his|her|their) life|must survive|survival)\b'],
 29:[r'\b(?:child.custody battle|abusive father|abusive mother|family (?:conflict|feud)|parents are divorced)\b'],
 30:[r'\b(?:rebellion against|rebels against|resistance (?:to|against)|overthrow (?:the |a )?(?:government|king|empire|ruler)|intellectual rebellion against)\b'],
 31:[r'\b(?:tournament|competition|contest|annual lottery)[^.]{0,80}\b(?:participat|fight|compete|champion|selected|games)\w*',r'\b(?:participat|fight|compete|champion|selected)\w*[^.]{0,80}\b(?:tournament|competition|contest|games)\b'],
 32:[r'\b(?:wizard|wizards|witchcraft|sorcerer|spellcasting|magick|magical school|magical powers|casting spells|casts a spell)\b'],
 33:[r'\b(?:time travel|time.traveling|time.travelling|travels? (?:back|forward) in time|time machine)\b'],
 34:[r'\b(?:spaceship|spacecraft|starship|star ship|interstellar|interplanetary|space travel|space flight)\b'],
 35:[r'\b(?:ghosts|spirits of the dead|a ghost|the ghost)\b'],
 37:[r'\b(?:prison camp|juvenile detention|concentration camp|imprisoned in|held captive|incarcerated in)\b'],
 38:[r'\b(?:works as|works at|working at|manager of) [^.]{0,70}\b(?:factory|shop|office|restaurant|magazine|newspaper|store|grill)\b'],
 39:[r'\b(?:terminal cancer|cancer|leukemia|epidemic|pandemic|Alzheimer.s|genetic disorder)\b'],
 40:[r'\b(?:immigrat\w*|emigrat\w*|refugee)\b'],
 43:[r'\b(?:coming.of.age|grows? up|growing up|maturation)\b'],
 44:[r'\b(?:social class|racial (?:inequality|segregation|discrimination)|class (?:conflict|division|inequality)|wealthy[^.]{0,60}poorer districts)\b'],
 46:[r'\b(?:loneliness|social isolation)\b'],
 49:[r'\b(?:first.person (?:narrat\w*|perspective|account)|narrat\w* in (?:the )?first person)\b'],
 50:[r'\b(?:alternating (?:first.person )?(?:perspectives|narrators|viewpoints)|(?:multiple|different|several) (?:narrators|viewpoints)|switches focus between)\b'],
 51:[r'\b(?:series of (?:journal|diary) entries|(?:presented|told|written) (?:through|as|in) letters|narration takes the form of letters|epistolary)\b'],
 52:[r'\b(?:alternates between[^.]{0,80}present[^.]{0,80}past|alternates between[^.]{0,80}present day|alternating[^.]{0,60}past[^.]{0,60}present)\b']
}
QID=lambda n:f'q{n:02d}'

def sentence_at(text,start,end):
    dot=text.rfind('. ',0,start)
    left=max(dot+2 if dot>=0 else 0,text.rfind('\n',0,start)+1,0)
    right=text.find('. ',end)
    if right<0:right=len(text)
    quote=text[left:right+1].strip()
    if len(quote)>220:
        left=max(left,start-70);right=min(right,left+220)
        if right<end:left=max(0,end-220);right=end
        quote=text[left:right]
    return quote

def label_record(record):
    text=record['synopsis']['text'];source=record['synopsis']['source_id']
    cells={QID(i):{'question_id':QID(i),'p_yes':.5,'status':'insufficient_evidence',
           'source_id':None,'evidence_quote':None,'premise_safe':False,'reviewed':False} for i in range(1,65)}
    annotations={};candidates=[]
    # Maximum 1,800 characters / 30% of long texts. For short texts, avoid
    # declaring their entire ending a premise; permit an initial 550-char window.
    window=min(1800,max(550,int(len(text)*.30)))
    def add(q,match,rule,p=.7):
        quote=sentence_at(text,match.start(),match.end())
        if not quote or len(quote)>220:raise ValueError('Invalid quote window')
        cells[QID(q)]={'question_id':QID(q),'p_yes':p,'status':'supported','source_id':source,
          'evidence_quote':quote,'premise_safe':True,'reviewed':False}
        annotations[QID(q)]={'method':'rule_draft','rule':rule,'match_start':match.start(),
          'review_required':True,'premise_safe_is_unreviewed':True}
    for q,patterns in RULES.items():
        region=text[:min(window,550)] if q in {1,2,3} else text[:window]
        for pattern in patterns:
            matches=list(re.finditer(pattern,region,re.I))
            accepted=None
            for m in matches:
                # Suppress obvious negation and hypothetical phrases. This is
                # not a semantic proof; every accepted extraction stays draft.
                prefix=region[max(0,m.start()-45):m.start()]
                if re.search(r'\b(?:not|never|no|without|pretends to|imagines)\b',prefix,re.I):continue
                accepted=m;break
            if accepted:
                add(q,accepted,pattern);break
        if QID(q) not in annotations:
            # Full-source scan creates a review queue, not automatic labels.
            for pattern in patterns:
                m=re.search(pattern,text,re.I)
                if m:
                    candidates.append({'book_id':record['id'],'question_id':QID(q),
                      'suggested_p_yes':.7,'quote':sentence_at(text,m.start(),m.end()),
                      'match_start':m.start(),'reason':'outside_premise_window_or_negated; inspect context and spoilers'})
                    break
    # A short opening subject/pronoun span is a weak draft role cue, not a
    # human-verified assertion. It is logged separately for semantic review.
    lead=text[:500]
    for q,pattern in [(2,r'\b(?:she|her|herself|girl|woman|wife|mother|daughter)\b'),
                      (3,r'\b(?:he|his|himself|boy|man|husband|father|son)\b')]:
        if cells[QID(q)]['p_yes']==.5:
            m=re.search(pattern,lead,re.I)
            if m:
                candidates.append({'book_id':record['id'],'question_id':QID(q),'suggested_p_yes':.7,
                    'quote':sentence_at(text,m.start(),m.end()),'match_start':m.start(),
                    'reason':'opening role cue may describe a minor character; semantic adjudication required'})
    # Explicit narrative locations, rather than author nationality or edition.
    locator=r'\b(?:set|takes place|living|lives|residing|resides|moves|returns|arrives|arriving|staying|begins|opens)\b[^.]{0,110}\b'
    cities=r'(?:New York(?: City)?|London|Paris|Chicago|Seattle|Boston|Los Angeles|Tokyo|Moscow|Saint Petersburg|San Francisco|Brooklyn|Philadelphia)'
    uk=r'(?:London|England|Britain|Scotland|Edinburgh|Yorkshire|Hampshire)'
    usa=r'(?:United States|California|New York|Chicago|Seattle|Boston|Los Angeles|Alabama|Mississippi|Oklahoma|Texas|Virginia|North Carolina|South Carolina|Maine|Rhode Island|Pennsylvania|Tennessee|Georgia|Massachusetts|Connecticut|New Mexico)'
    for q,pattern in [(10,locator+cities+r'\b'),(13,locator+uk+r'\b'),(14,locator+usa+r'\b')]:
        m=re.search(pattern,text[:window],re.I)
        if m:add(q,m,'explicit_opening_location_needs_scope_review')
    # Use only explicit overall setting dates. Do not label from publication
    # dates, a character's birth, or an isolated historical flashback.
    date_pattern=r'\b(?:is set|set in|takes place|majority of the novel takes place)[^.]{0,65}\b(1[0-9]{3}|20[0-9]{2})\b'
    m=re.search(date_pattern,text[:window],re.I)
    if m:
        years=[int(y) for y in re.findall(r'\b(?:1[0-9]{3}|20[0-9]{2})\b',sentence_at(text,m.start(),m.end()))]
        bins={17 if y<1900 else 18 if y<=1945 else 19 if y<=1999 else 20 for y in years}
        if len(bins)==1:add(next(iter(bins)),m,'explicit_narrative_setting_year')
    return {'book_id':record['id'],'answers':list(cells.values())},annotations,candidates

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--catalog',type=Path,required=True)
    ap.add_argument('--out',type=Path,required=True);args=ap.parse_args();args.out.mkdir(parents=True,exist_ok=True)
    rows=[json.loads(s) for s in args.catalog.read_text(encoding='utf-8').splitlines() if s.strip()]
    labels=[];notes={};candidates=[]
    for r in rows:
        label,metadata,queue=label_record(r);labels.append(label);notes[r['id']]=metadata;candidates.extend(queue)
    (args.out/'core500_draft_labels.json').write_text(json.dumps({'books':labels},ensure_ascii=False,indent=2),encoding='utf-8')
    (args.out/'label_methods.json').write_text(json.dumps(notes,ensure_ascii=False,indent=2),encoding='utf-8')
    with (args.out/'additional_evidence_candidates.jsonl').open('w',encoding='utf-8') as f:
        for candidate in candidates:f.write(json.dumps(candidate,ensure_ascii=False)+'\n')
    print(json.dumps({'books':len(rows),'draft_supported_cells':sum(len(n) for n in notes.values()),
       'full_text_review_candidates':len(candidates),'human_reviewed_cells':0,
       'source_sha256':hashlib.sha256(args.catalog.read_bytes()).hexdigest()}))

if __name__=='__main__':main()
