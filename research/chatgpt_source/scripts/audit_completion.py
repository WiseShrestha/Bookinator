#!/usr/bin/env python3
"""Audit every cell and export exact review work, without treating drafts as factual approval."""
import argparse, collections, csv, hashlib, json, sys
from pathlib import Path

QUARANTINE={
 'Little Women':'The supplied text contains Act I, musical song cues and Professor Bhaer; appears to describe the musical adaptation, not the novel.',
 "A Midsummer Night's Dream":'Shakespeare play, outside a novels-only catalog.',
 'Goodnight Moon':'Picture book, outside a novels-only catalog.',
 'The Lorax':'Illustrated verse/picture book; confirm whether scope deliberately includes it.',
 'Love You Forever':'Picture book; confirm scope.',
 'Fantastic Beasts and Where to Find Them':'Companion/reference-style fictional textbook; not a conventional narrative novel.',
 'Quidditch Through the Ages':'Companion/reference-style book; not a conventional narrative novel.'
}

def audit(payload,catalog,questions,validate):
    by_id={r['id']:r for r in catalog};qids={q['id'] for q in questions}
    result=validate(payload,by_id,questions)
    ids=[r['book_id'] for r in payload['books']]
    if set(ids)!=set(by_id):raise ValueError('Catalog ID coverage mismatch')
    if len(ids)!=len(set(ids)):raise ValueError('Duplicate book rows')
    if not result['valid']:raise ValueError(str(result['errors'][:10]))
    # The original validator checks semantics-sensitive fields structurally.
    # Enforce exact counts/types as an additional independent structural check.
    for row in payload['books']:
        if len(row['answers'])!=64:raise ValueError('Not exactly 64 cells')
        if {c['question_id'] for c in row['answers']}!=qids:raise ValueError('Question IDs mismatch')
        if any(c['reviewed'] is not False for c in row['answers']):raise ValueError('Draft falsely claims human review')
    return result

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--root',type=Path,required=True);args=ap.parse_args();root=args.root
    sys.path.insert(0,str(root/'core_tools'))
    from validate_matrix import validate
    catalog=[json.loads(line) for line in (root/'data/priority_500.jsonl').read_text(encoding='utf-8').splitlines()]
    questions=json.loads((root/'questions_64.json').read_text(encoding='utf-8'))
    payload=json.loads((root/'data/core500_draft_labels.json').read_text(encoding='utf-8'))
    methods=json.loads((root/'data/label_methods.json').read_text(encoding='utf-8'))
    checked=audit(payload,catalog,questions,validate)
    meta={b['id']:b for b in catalog};labels={b['book_id']:b for b in payload['books']}
    counts=checked['supported_cells_by_book'];known=sum(counts.values());total=500*64
    per_question=collections.Counter();all_cells=[];queue=[];vectors=collections.defaultdict(list)
    for order,record in enumerate(catalog):
        bid=record['id'];row=labels[bid];vector=[]
        for c in row['answers']:
            vector.append(c['p_yes'])
            if c['p_yes']!=.5:
                per_question[c['question_id']]+=1
                all_cells.append({'book_id':bid,'title':record['title'],'question_id':c['question_id'],
                    'p_yes':c['p_yes'],'evidence_quote':c['evidence_quote'],'reviewed':False,
                    'method':methods[bid][c['question_id']]['method']})
        vectors[tuple(vector)].append(bid)
        queue.append({'priority_index':order,'book_id':bid,'title':record['title'],'supported_draft_cells':counts[bid],
            'unknown_cells':64-counts[bid],'human_reviewed_cells':0,'count_gate_12_met':counts[bid]>=12,
            'form_quarantine':record['title'] in QUARANTINE,'form_reason':QUARANTINE.get(record['title'],''),
            'recommended_action':'semantic_review_required','active_in_game':False})
    def csv_write(path,rows):
        with path.open('w',encoding='utf-8-sig',newline='') as f:
            writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
    csv_write(root/'reports/book_review_queue.csv',queue)
    if all_cells:csv_write(root/'reports/all_proposed_cells.csv',all_cells)
    collisions=[{'book_ids':ids,'titles':[meta[i]['title'] for i in ids]} for ids in vectors.values() if len(ids)>1]
    (root/'reports/identical_feature_vectors.json').write_text(json.dumps(collisions,ensure_ascii=False,indent=2),encoding='utf-8')
    (root/'reports/form_quarantine.json').write_text(json.dumps([r for r in queue if r['form_quarantine']],ensure_ascii=False,indent=2),encoding='utf-8')
    report={'catalog_books':500,'matrix_rows':len(payload['books']),'question_ids':len(questions),'total_cells':total,
       'proposed_non_unknown_cells':known,'unknown_cells':total-known,'human_reviewed_cells':0,
       'core_validator_passed':True,'exact_500_ids_checked':True,'exact_64_cells_each_checked':True,
       'exact_quote_and_source_checks_passed':True,'count_gate_at_12':sum(c>=12 for c in counts.values()),
       'active_playable_books_claimed':0,'form_quarantines':sum(r['form_quarantine'] for r in queue),
       'indistinguishable_vector_groups':len(collisions),'books_in_indistinguishable_groups':sum(len(g['book_ids']) for g in collisions),
       'supported_cell_histogram':dict(sorted(collections.Counter(counts.values()).items())),
       'per_question_proposed_counts':dict(sorted(per_question.items())),
       'claude_existing_145_rows_available':False,'actual_app_source_available':False,
       'application_simulator_run':False,'human_playtest_run':False,'openai_api_calls':0,
       'research_checkpoint_is_complete':False,
       'qualification':'AI draft labels include a selected-passage semantic pass on all 500 records. No full-novel, independent factual, or human review. Unknown values are intentional. Do not claim 500 playable books.'}
    (root/'reports/validation_report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    # Data-only export; clear activation flag prevents accidental scope inflation.
    runtime={'format':'thatbook-proposed-matrix-v1','candidate_only':True,'human_reviewed':False,
       'question_ids':[q['id'] for q in questions],
       'books':[{'id':r['id'],'title':r['title'],'author':', '.join(r['authors']),
                 'library_search_url':r['library_search_url'],'active_in_game':False,
                 'p_yes':[c['p_yes'] for c in labels[r['id']]['answers']]} for r in catalog]}
    (root/'data/core500_candidate_matrix.json').write_text(json.dumps(runtime,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    (root/'data/after_145_draft_labels.json').write_text(json.dumps({'books':[labels[r['id']] for r in catalog[145:]]},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,indent=2))

if __name__=='__main__':main()
