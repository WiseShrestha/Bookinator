#!/usr/bin/env python3
"""Validate label structure and evidence quotes. This does NOT fact-check the labels."""
import argparse, json, sys
from pathlib import Path
from prepare_label_batches import read_records

VALUES={0.1,0.3,0.5,0.7,0.9}

def validate(matrix,catalog,questions,require_reviewed=False,min_supported=0):
    errors=[];seen_books=set();coverage={};qids={q['id'] for q in questions}
    for book in matrix.get('books',[]):
        bid=book.get('book_id')
        if bid not in catalog:errors.append(f'Unknown book: {bid}');continue
        if bid in seen_books:errors.append(f'Duplicate book: {bid}')
        seen_books.add(bid);seen_questions=set();supported=0
        record=catalog[bid]
        for cell in book.get('answers',[]):
            qid=cell.get('question_id');p=cell.get('p_yes')
            if qid not in qids:errors.append(f'{bid}: unknown question {qid}')
            if qid in seen_questions:errors.append(f'{bid}: duplicate {qid}')
            seen_questions.add(qid)
            if isinstance(p,bool) or p not in VALUES:errors.append(f'{bid}/{qid}: invalid p_yes {p}');continue
            if not isinstance(cell.get('reviewed'),bool):errors.append(f'{bid}/{qid}: reviewed must be boolean')
            if p==.5:
                if cell.get('status') not in {'ambiguous','insufficient_evidence'}:errors.append(f'{bid}/{qid}: unknown status invalid')
                if cell.get('source_id') is not None or cell.get('evidence_quote') is not None:errors.append(f'{bid}/{qid}: unknown must have null evidence')
                if cell.get('premise_safe') is not False:errors.append(f'{bid}/{qid}: unknown must be premise_safe=false')
            else:
                supported+=1
                if cell.get('status')!='supported':errors.append(f'{bid}/{qid}: known status must be supported')
                if cell.get('source_id')!=record['synopsis']['source_id']:errors.append(f'{bid}/{qid}: quote source is not supplied synopsis')
                quote=cell.get('evidence_quote')
                if not isinstance(quote,str) or not quote or len(quote)>220 or quote not in record['synopsis']['text']:
                    errors.append(f'{bid}/{qid}: quote missing, over 220 chars, or not exact evidence substring')
                if cell.get('premise_safe') is not True:errors.append(f'{bid}/{qid}: known label must be premise_safe=true')
                if require_reviewed and cell.get('reviewed') is not True:errors.append(f'{bid}/{qid}: human review missing')
        if seen_questions!=qids:errors.append(f'{bid}: question coverage mismatch; missing {sorted(qids-seen_questions)}')
        coverage[bid]=supported
        if supported<min_supported:errors.append(f'{bid}: only {supported} supported cells; minimum {min_supported}')
    if not seen_books:errors.append('No books supplied')
    return {'valid':not errors,'books':len(seen_books),'supported_cells_by_book':coverage,
            'errors':errors,'scope':'Structural and exact-quote validation only. No factual, spoiler, or accuracy validation.'}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--matrix',type=Path,required=True)
    ap.add_argument('--catalog',type=Path,required=True);ap.add_argument('--questions',type=Path,default=Path('questions_64.json'))
    ap.add_argument('--require-reviewed',action='store_true');ap.add_argument('--min-supported',type=int,default=0)
    args=ap.parse_args()
    report=validate(json.loads(args.matrix.read_text(encoding='utf-8')),
                    {r['id']:r for r in read_records(args.catalog)},
                    json.loads(args.questions.read_text(encoding='utf-8')),
                    args.require_reviewed,args.min_supported)
    print(json.dumps(report,indent=2));sys.exit(0 if report['valid'] else 1)

if __name__=='__main__':main()
