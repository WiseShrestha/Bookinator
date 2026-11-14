"""Select exact current-source contexts for human-readable AI adjudication."""
import argparse,json,re
from pathlib import Path

def main():
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--start',type=int,default=0);p.add_argument('--count',type=int,default=30);a=p.parse_args();root=a.root
    evidence=json.loads((root/'data/current_work_evidence.json').read_text());pages=evidence['pages']
    rows=[json.loads(s) for s in (root/'data/priority_500.jsonl').read_text().splitlines()];panels=[]
    for i,b in enumerate(rows):
        pid=evidence['corrected_little_women_page_id'] if b['title']=='Little Women' else evidence.get('corrected_page_overrides',{}).get(b['title'],b['source_ids']['wikipedia_page_id'])
        page=pages.get(str(pid))
        if not page:continue
        if b['title']=='Silence':continue # Current page redirects to the series; do not label a single volume from another volume's adaptations.
        text=page['evidence_text'];snippets=[]
        for q,pattern in [('q62',r'\bfilm\b|\bmovie\b'),('q63',r'television|\bTV\b|miniseries'),('q49',r'first.person|third.person')]:
            candidates=[]
            for m in re.finditer(pattern,text,re.I):
                start=max(0,m.start()-85);quote=text[start:start+220];lo=quote.lower();score=0
                if q=='q49':
                    if not re.search(r'narrat|perspective|point.of.view|told',lo):continue
                    score+=3
                    if 'category:' in lo:score-=2
                else:
                    if 'adapt' in lo:score+=4
                    if re.search(r'was released|were released|premiered|broadcast|aired|released in|released on',lo):score+=6
                    if re.search(r'\b(?:19|20)\d{2}\b',lo):score+=2
                    if 'novel' in lo or 'book' in lo:score+=1
                    if re.search(r'rights|planned|upcoming|announced|in development|attempted|inspired',lo):score-=4
                    if 'category:' in lo:
                        if 'adapted into' in lo:score+=1
                        else:continue
                    if score<4:continue
                candidates.append((score,-start,start,quote))
            if candidates:
                _,_,start,quote=max(candidates)
                snippets.append({'id':len(snippets),'question_hint':q,'start':start,'text':quote})
        if snippets:panels.append({'index':i,'book_id':b['id'],'title':b['title'],'source_id':page['source_id'],'passages':snippets})
    (root/'data/current_review_panels.json').write_text(json.dumps(panels,ensure_ascii=False,indent=2))
    print(f'Current-source panels: {len(panels)}; showing panel positions {a.start}-{a.start+a.count-1}')
    for b in panels[a.start:a.start+a.count]:
        print(f'\n[{b["index"]}] {b["title"]}')
        for x in b['passages']:print(f'{x["id"]} ({x["question_hint"]}): {x["text"]}')

if __name__=='__main__':main()
