#!/usr/bin/env python3
"""Backward-compatible quote validation supporting explicit metadata evidence registries."""
import argparse,json,sys
from pathlib import Path

def validate(payload,catalog,questions):
    errors=[];seen=set();qids={q['id'] for q in questions};known=0;counts={}
    for book in payload.get('books',[]):
        bid=book.get('book_id')
        if bid not in catalog:errors.append(f'Unknown book {bid}');continue
        if bid in seen:errors.append(f'Duplicate book {bid}')
        seen.add(bid);r=catalog[bid]
        texts={r['synopsis']['source_id']:r['synopsis']['text'],**r.get('evidence_texts',{})}
        sources={s['id'] for s in r['sources']};seen_q=set();count=0
        cells=book.get('answers',[])
        if len(cells)!=64:errors.append(f'{bid}: not exactly 64 cells')
        for c in cells:
            q=c.get('question_id');p=c.get('p_yes')
            if q in seen_q:errors.append(f'{bid}: duplicate {q}')
            seen_q.add(q)
            if isinstance(p,bool) or p not in {.1,.3,.5,.7,.9}:errors.append(f'{bid}/{q}: invalid p_yes');continue
            if c.get('reviewed') is not False:errors.append(f'{bid}/{q}: falsely promoted human review')
            if p==.5:
                if c.get('status') not in {'ambiguous','insufficient_evidence'} or c.get('source_id') is not None or c.get('evidence_quote') is not None or c.get('premise_safe') is not False:
                    errors.append(f'{bid}/{q}: malformed unknown')
            else:
                count+=1;sid=c.get('source_id');quote=c.get('evidence_quote')
                if sid not in sources or sid not in texts:errors.append(f'{bid}/{q}: source not registered')
                elif not isinstance(quote,str) or not quote or len(quote)>220 or quote not in texts[sid]:errors.append(f'{bid}/{q}: invalid quote')
                if c.get('status')!='supported' or c.get('premise_safe') is not True:errors.append(f'{bid}/{q}: malformed known')
        if seen_q!=qids:errors.append(f'{bid}: question coverage mismatch')
        counts[bid]=count;known+=count
    if seen!=set(catalog):errors.append('Book ID coverage mismatch')
    return {'valid':not errors,'errors':errors,'books':len(seen),'non_unknown_cells':known,
      'count_gate_12':sum(x>=12 for x in counts.values()),'counts_by_book':counts,
      'scope':'Source registration, exact quotes, fields and ID coverage. No human or independent factual approval.'}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--root',type=Path,required=True)
    ap.add_argument('--catalog',default='data/priority_500_researched.jsonl')
    ap.add_argument('--labels',default='data/core500_researched_labels.json')
    ap.add_argument('--report',default='reports/researched_validation_report.json')
    args=ap.parse_args();root=args.root
    records=[json.loads(s) for s in (root/args.catalog).read_text().splitlines()]
    catalog={r['id']:r for r in records}
    if len(catalog)!=len(records):raise ValueError('Duplicate catalog IDs')
    payload=json.loads((root/args.labels).read_text());questions=json.loads((root/'questions_64.json').read_text())
    result=validate(payload,catalog,questions)
    (root/args.report).write_text(json.dumps(result,indent=2))
    print(json.dumps({k:v for k,v in result.items() if k!='counts_by_book'},indent=2))
    sys.exit(0 if result['valid'] else 1)

if __name__=='__main__':main()
