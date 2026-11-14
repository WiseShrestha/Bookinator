"""Display previously under-covered records with exact current lead/plot passages."""
import argparse,json
from pathlib import Path

def main():
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--start',type=int,default=0);p.add_argument('--count',type=int,default=20);a=p.parse_args();root=a.root
    path=root/'data/weak_record_review_panels.json'
    if path.exists():panels=json.loads(path.read_text())
    else:
        src=json.loads((root/'data/current_work_evidence.json').read_text());pages=src['pages']
        records=[json.loads(s) for s in (root/'data/priority_500_researched.jsonl').read_text().splitlines()]
        matrix={b['book_id']:b for b in json.loads((root/'data/core500_researched_labels.json').read_text())['books']}
        excluded={'A Midsummer Night\'s Dream','Goodnight Moon','The Lorax','Love You Forever','Fantastic Beasts and Where to Find Them','Quidditch Through the Ages','The True Story of the Three Little Pigs'}
        panels=[]
        for i,r in enumerate(records):
            cells={c['question_id']:c for c in matrix[r['id']]['answers']};n=sum(c['p_yes']!=.5 for c in cells.values())
            if n>=12 or r['title'] in excluded or r['title']=='Silence':continue
            page=pages.get(str(r['source_ids']['wikipedia_page_id']))
            if not page:continue
            passages=[]
            blocks=[('lead',page.get('lead_text',''))]
            plots=[s for s in page['sections'] if s['heading'].lower() in ['plot','plot summary','synopsis','premise']]
            if plots:blocks.append(('plot',plots[0]['text']))
            for kind,text in blocks:
                for start in range(0,min(len(text),420 if kind=='lead' else 620),200):
                    quote=text[start:start+220]
                    if quote in page['evidence_text']:passages.append({'id':len(passages),'scope':kind,'text':quote})
            if passages:panels.append({'index':i,'book_id':r['id'],'title':r['title'],'source_id':page['source_id'],
              'known_questions':[q for q,c in cells.items() if c['p_yes']!=.5],'passages':passages})
        path.write_text(json.dumps(panels,ensure_ascii=False,indent=2))
    print('Weak-record panels:',len(panels))
    for b in panels[a.start:a.start+a.count]:
        print(f'\n[{b["index"]}] {b["title"]}; known: '+','.join(b['known_questions']))
        for q in b['passages']:print(str(q['id'])+' '+q['scope']+': '+q['text'])

if __name__=='__main__':main()
