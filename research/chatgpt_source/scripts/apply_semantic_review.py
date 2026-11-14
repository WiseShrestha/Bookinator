#!/usr/bin/env python3
"""Apply explicit AI passage selections; missing questions stay unknown.

TSV lines: index | q@passage,q@passage,... ; prefix '-' gives qualified No.
No human-review or activation flags are promoted by this script.
"""
import argparse,json,re
from pathlib import Path

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--root',type=Path,required=True)
    ap.add_argument('--only-adjudicated',action='store_true',help='Withhold older rule/refinement cells absent from this passage pass.')
    args=ap.parse_args();root=args.root
    panels={p['index']:p for p in json.loads((root/'data/semantic_review_passages.json').read_text())}
    catalog_by_id={r['id']:r for r in [json.loads(s) for s in (root/'data/priority_500.jsonl').read_text().splitlines()]}
    labels=json.loads((root/'data/core500_draft_labels.json').read_text());by_id={r['book_id']:r for r in labels['books']}
    methods=json.loads((root/'data/label_methods.json').read_text());seen=set();changes=0;records=[]
    for file in sorted((root/'data/semantic_decisions').glob('*.tsv')):
        for line in file.read_text().splitlines():
            if not line.strip() or line.startswith('#'):continue
            index_s,selection=line.split('|',1);index=int(index_s)
            if index in seen:raise ValueError(f'Duplicate semantic decision for index {index}')
            seen.add(index);b=panels[index];bid=b['book_id'];cells={c['question_id']:c for c in by_id[bid]['answers']}
            covered=[]
            for token in selection.strip().split(','):
                if not token.strip():continue
                if token.startswith('?'):
                    qid=f'q{int(token[1:]):02d}'
                    if qid not in cells or qid in covered:raise ValueError(f'Invalid retraction {token}')
                    cells[qid].update(p_yes=.5,status='insufficient_evidence',source_id=None,
                      evidence_quote=None,premise_safe=False,reviewed=False)
                    methods[bid].pop(qid,None)
                    covered.append(qid)
                    continue
                m=re.fullmatch(r'(-?)(\d+)@(\d+)',token.strip())
                if not m:raise ValueError(f'Invalid selection {token!r}')
                negative,q,p=m.groups();qid=f'q{int(q):02d}';pid=int(p)
                if not 1<=int(q)<=64:raise ValueError('Question out of range')
                if qid in covered:raise ValueError(f'Duplicate {qid} on {bid}')
                passage=next(x for x in b['passages'] if x['id']==pid)
                quote=passage['text']
                # Every panel is an exact span from this same CMU synopsis.
                original=catalog_by_id[bid]
                assert quote in original['synopsis']['text'] and len(quote)<=220
                cells[qid].update(p_yes=.3 if negative else .7,status='supported',source_id=original['synopsis']['source_id'],
                  evidence_quote=quote,premise_safe=True,reviewed=False)
                methods[bid][qid]={'method':'AI_semantic_passage_adjudication','passage_id':pid,'match_start':passage['start'],
                   'source_scope':passage['scope'],'human_reviewed':False,'review_required':True}
                covered.append(qid);changes+=1
            records.append({'book_id':bid,'index':index,'questions_considered_or_retracted':covered,
              'scope':'AI review of selected exact passages; not a full-novel factual or human review.'})
    if args.only_adjudicated:
        withheld=[]
        for row in labels['books']:
            for cell in row['answers']:
                method=methods[row['book_id']].get(cell['question_id'],{})
                if cell['p_yes']!=.5 and method.get('method')!='AI_semantic_passage_adjudication':
                    withheld.append({'book_id':row['book_id'],'cell':dict(cell),'method':method,
                      'reason':'Not explicitly retained in the selected-passage semantic pass. Legacy candidates need fresh review.'})
                    cell.update(p_yes=.5,status='insufficient_evidence',source_id=None,evidence_quote=None,premise_safe=False,reviewed=False)
                    methods[row['book_id']].pop(cell['question_id'],None)
        if withheld:
            (root/'reports/withheld_legacy_cells.json').write_text(json.dumps(withheld,ensure_ascii=False,indent=2))
    (root/'data/core500_draft_labels.json').write_text(json.dumps(labels,ensure_ascii=False,indent=2))
    (root/'data/label_methods.json').write_text(json.dumps(methods,ensure_ascii=False,indent=2))
    (root/'reports/semantic_review_progress.json').write_text(json.dumps({'books_with_AI_passage_review':len(seen),
       'selected_or_refined_cells':changes,'review_records':records,'human_reviewed_cells':0},ensure_ascii=False,indent=2))
    print(json.dumps({'books_with_AI_passage_review':len(seen),'selected_or_refined_cells':changes}))

if __name__=='__main__':main()
