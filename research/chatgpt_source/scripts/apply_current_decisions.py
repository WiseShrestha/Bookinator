"""Apply source-adjudicated current contexts and sound majority-era constraints."""
import argparse,collections,json,re
from pathlib import Path

def derive_era_negatives(cells):
    eras=['q17','q18','q19','q20'];yes=[q for q in eras if cells[q]['p_yes']>.5];updates=[]
    if len(yes)==1:
        source=yes[0]
        for q in eras:
            if q!=source and cells[q]['p_yes']==.5:updates.append((q,source))
    if cells['q21']['p_yes']>.5 and cells['q20']['p_yes']==.5 and not any(q=='q20' for q,_ in updates):updates.append(('q20','q21'))
    return updates

def main():
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True)
    p.add_argument('--panels',default='data/current_review_panels.json');p.add_argument('--decisions',default='data/current_semantic_decisions')
    p.add_argument('--audit',default='reports/current_context_review_audit.json');args=p.parse_args();root=args.root
    payload=json.loads((root/'data/core500_researched_labels.json').read_text());rows={r['book_id']:r for r in payload['books']}
    catalog=[json.loads(s) for s in (root/'data/priority_500_researched.jsonl').read_text().splitlines()];records={r['id']:r for r in catalog}
    panels={b['index']:b for b in json.loads((root/args.panels).read_text())}
    seen=set();audit=[];methods=json.loads((root/'data/research_label_methods.json').read_text())
    for path in sorted((root/args.decisions).glob('*.tsv')):
        for line in path.read_text().splitlines():
            if not line.strip() or line.startswith('#'):continue
            idx,selection=line.split('|',1);idx=int(idx)
            if idx in seen:raise ValueError(f'Duplicate current review for {idx}')
            seen.add(idx);panel=panels[idx];bid=panel['book_id'];cells={c['question_id']:c for c in rows[bid]['answers']}
            qs=set()
            for token in filter(None,selection.split(',')):
                if token.startswith('?'):
                    q=f'q{int(token[1:]):02d}';cells[q].update(p_yes=.5,status='insufficient_evidence',source_id=None,evidence_quote=None,premise_safe=False,reviewed=False)
                    audit.append({'book_id':bid,'question_id':q,'method':'retracted_insufficient_work_specific_evidence'});methods[bid].pop(q,None);continue
                m=re.fullmatch(r'(-?)(\d+)@(\d+)',token);assert m,token
                sign,n,passage=m.groups();q=f'q{int(n):02d}';assert q not in qs;qs.add(q)
                text=next(x['text'] for x in panel['passages'] if x['id']==int(passage))
                assert text in records[bid]['evidence_texts'][panel['source_id']]
                cells[q].update(p_yes=.3 if sign else .7,status='supported',source_id=panel['source_id'],evidence_quote=text,premise_safe=True,reviewed=False)
                methods[bid][q]={'method':'AI_current_source_adjudication','passage_id':int(passage),'review_required':True}
                audit.append({'book_id':bid,'question_id':q,'source_id':panel['source_id'],'evidence_quote':text,'method':'AI_current_source_adjudication'})
    for row in payload['books']:
        cells={c['question_id']:c for c in row['answers']}
        for q,source in derive_era_negatives(cells):
            cell=cells[source]
            cells[q].update(p_yes=round(1-cell['p_yes'],1),status='supported',source_id=cell['source_id'],evidence_quote=cell['evidence_quote'],premise_safe=True,reviewed=False)
            methods[row['book_id']][q]={'method':'derived_disjoint_majority_era' if source!='q21' else 'imagined_future_excluded_from_real_world_2000_question','derived_from_question':source,'review_required':True}
            audit.append({'book_id':row['book_id'],'question_id':q,'derived_from_question':source,'method':methods[row['book_id']][q]['method']})
    (root/'data/core500_researched_labels.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2))
    (root/'data/research_label_methods.json').write_text(json.dumps(methods,ensure_ascii=False,indent=2))
    (root/args.audit).write_text(json.dumps({'contexts_reviewed':len(seen),'contexts_available':len(panels),'updates':audit,'human_reviewed':False},ensure_ascii=False,indent=2))
    print(json.dumps({'panels_reviewed':len(seen),'panels_available':len(panels),'updates':len(audit),'methods':dict(collections.Counter(x['method'] for x in audit))}))

if __name__=='__main__':main()
