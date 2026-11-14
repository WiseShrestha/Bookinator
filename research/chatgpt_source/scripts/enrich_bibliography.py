#!/usr/bin/env python3
"""Add cited bibliographic labels from explicitly named source fields.

Never infer setting year or original language from these metadata fields.
"""
import argparse,copy,csv,json,re
from decimal import Decimal,InvalidOperation
from pathlib import Path

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--root',type=Path,required=True)
    ap.add_argument('--goodbooks',type=Path,required=True);args=ap.parse_args();root=args.root
    if args.goodbooks.suffix=='.jsonl':
        gb={int(r['book_id']):r for r in [json.loads(s) for s in args.goodbooks.read_text().splitlines()]}
    else:gb={int(r['book_id']):r for r in csv.DictReader(args.goodbooks.open(encoding='utf-8'))}
    catalog=[json.loads(s) for s in (root/'data/priority_500.jsonl').read_text().splitlines()]
    plot=json.loads((root/'data/core500_draft_labels.json').read_text());out=copy.deepcopy(plot)
    label_by_id={r['book_id']:r for r in out['books']};audit=[];raw=[];flags=[];pending=[]
    for r in catalog:
        g=gb[r['source_ids']['goodbooks_id']];raw.append(g);sid='goodbooks:'+g['book_id']
        evidence='\n'.join(f'{k}: {g[k]}' for k in ['book_id','work_id','title','authors','original_publication_year'])
        r['evidence_texts']={sid:evidence}
        r['evidence_text_transform']='Exact source CSV field names and values rendered as lines; source claims, not independent verification.'
        cells={c['question_id']:c for c in label_by_id[r['id']]['answers']}
        def add(q,p,quote,field):
            assert quote in evidence and len(quote)<=220
            cells[q].update(p_yes=p,status='supported',source_id=sid,evidence_quote=quote,premise_safe=True,reviewed=False)
            audit.append({'book_id':r['id'],'question_id':q,'source_id':sid,'field':field,'raw_value':g[field],
              'source_url':'https://github.com/zygmuntz/goodbooks-10k','method':'explicit_bibliographic_field_comparison','human_reviewed':False})
        try:
            value=Decimal(g['original_publication_year'])
            year=int(value) if value.is_finite() and value==value.to_integral_value() else None
        except (InvalidOperation,ValueError):year=None
        if year is not None and -4000<=year<=2026:
            quote='original_publication_year: '+g['original_publication_year']
            # The question bank explicitly requires verified first-publication dates.
            # A community metadata field alone is a candidate, not that verification.
            for q,p in [('q60',.7 if year<1900 else .3),('q61',.7 if year>=2000 else .3)]:
                pending.append({'book_id':r['id'],'question_id':q,'proposed_p_yes':p,
                  'source_id':sid,'evidence_quote':quote,'verification_status':'needs_independent_first_publication_check',
                  'reason':'Explicit original_publication_year field, but no independent work/edition date verification.'})
        title=g['title']
        numbered=re.search(r'\(([^()]*)\s*,\s*#(\d+(?:\.\d+)?)\)\s*$',title)
        if numbered:
            volume=Decimal(numbered.group(2));quote='title: '+title
            if len(quote)<=220:
                add('q53',.7,quote,'title')
                if volume>=1:add('q54',.7 if volume==1 else .3,quote,'title')
        elif '#' in title:
            flags.append({'book_id':r['id'],'title':r['title'],'source_title':title,
              'reason':'Numbered title is not a simple individual volume; series position remains unresolved.'})
    with (root/'data/priority_500_enriched.jsonl').open('w',encoding='utf-8') as f:
        for r in catalog:f.write(json.dumps(r,ensure_ascii=False,separators=(',',':'))+'\n')
    with (root/'data/goodbooks_500_source_rows.jsonl').open('w',encoding='utf-8') as f:
        for r in raw:f.write(json.dumps(r,ensure_ascii=False,separators=(',',':'))+'\n')
    (root/'data/core500_labels_with_metadata.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
    (root/'data/pending_publication_year_claims.json').write_text(json.dumps(pending,ensure_ascii=False,indent=2))
    (root/'reports/bibliographic_label_audit.json').write_text(json.dumps({'labels_added':len(audit),'field_labels':audit,'unresolved_series':flags,
       'warning':'Source-field comparisons only. These dates are never used to infer narrative setting; edition language is not used as original language.'},ensure_ascii=False,indent=2))
    print(json.dumps({'bibliographic_cells_added':len(audit),'pending_date_claims':len(pending),'unresolved_series_rows':len(flags)}))

if __name__=='__main__':main()
