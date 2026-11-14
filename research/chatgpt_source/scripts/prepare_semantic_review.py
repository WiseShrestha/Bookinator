#!/usr/bin/env python3
"""Build bounded, exact source passages for an AI semantic review, without model calls."""
import argparse,json,re
from pathlib import Path

GROUPS=[
 r'first.person|narrat\w*|diary|journal entr|viewpoints|perspectives|letters to|epistolary',
 r'\bmagic\w*\b|\bwizard\w*\b|\bvampire\w*\b|\bghost\w*\b|time.travel|spaceship|telepath',
 r'falls? in love|romantic|love triangle|marriage|family conflict|child.custody|murder investigation|detective|investigat\w*',
 r'(?:set in|takes place|primarily set|school|academy|prison|epidemic|journey|quest|tournament)'
]

def build(rows):
    out=[]
    for i,r in enumerate(rows):
        t=r['synopsis']['text'];evidence=[]
        # Exact overlapping 220-character spans; no normalization or paraphrasing.
        for start in range(0,min(640,len(t)),200):
            evidence.append({'start':start,'text':t[start:min(start+220,len(t))],'scope':'opening'})
        for pattern in GROUPS:
            matches=[m for m in re.finditer(pattern,t,re.I) if m.start()>=640]
            if not matches:continue
            m=matches[0];start=max(0,m.start()-65)
            if any(abs(start-e['start'])<120 for e in evidence):continue
            evidence.append({'start':start,'text':t[start:min(start+220,len(t))],'scope':'later_context_review_spoilers'})
            if len(evidence)>=7:break
        out.append({'index':i,'book_id':r['id'],'title':r['title'],
          'passages':[{**e,'id':n} for n,e in enumerate(evidence)]})
    return out

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--root',type=Path,required=True)
    ap.add_argument('--start',type=int);ap.add_argument('--count',type=int,default=25)
    args=ap.parse_args();root=args.root;cache=root/'data/semantic_review_passages.json'
    if cache.exists():panels=json.loads(cache.read_text())
    else:
        rows=[json.loads(s) for s in (root/'data/priority_500.jsonl').read_text().splitlines()]
        panels=build(rows);cache.write_text(json.dumps(panels,ensure_ascii=False,indent=2))
    if args.start is not None:
        for b in panels[args.start:args.start+args.count]:
            print(f'\n[{b["index"]}] {b["title"]}')
            for p in b['passages']:print(f'{p["id"]}: {p["text"]}')
    else:print('Review panels:',len(panels))

if __name__=='__main__':main()
