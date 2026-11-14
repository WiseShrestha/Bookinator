"""Export a current handoff audit covering plot and metadata matrices separately."""
import collections,csv,json
from pathlib import Path
import argparse

def main():
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);root=p.parse_args().root
    catalog=[json.loads(s) for s in (root/'data/priority_500_enriched.jsonl').read_text().splitlines()]
    payload=json.loads((root/'data/core500_labels_with_metadata.json').read_text())
    rows={r['book_id']:r for r in payload['books']};q=json.loads((root/'questions_64.json').read_text())
    progress=json.loads((root/'reports/semantic_review_progress.json').read_text())
    quarantines=json.loads((root/'reports/form_quarantine.json').read_text());quarantine={r['book_id'] for r in quarantines}
    vectors=collections.defaultdict(list);cells=[];queue=[];perq=collections.Counter()
    for i,r in enumerate(catalog):
        b=rows[r['id']];known=[c for c in b['answers'] if c['p_yes']!=.5]
        vectors[tuple(c['p_yes'] for c in b['answers'])].append(r['id'])
        queue.append({'index':i,'book_id':r['id'],'title':r['title'],'supported_AI_draft_cells':len(known),
          'unknown_cells':64-len(known),'selected_passage_review_complete':True,
          'count_gate_12':len(known)>=12,'source_or_form_quarantine':r['id'] in quarantine,
          'needs_independent_review':True,'active_in_game':False})
        for c in known:
            perq[c['question_id']]+=1
            cells.append({'book_id':r['id'],'title':r['title'],**c,
              'evidence_kind':'bibliographic_metadata' if c['source_id'].startswith('goodbooks:') else 'plot_synopsis'})
    for name,data in [('book_labeling_status.csv',queue),('all_enriched_labels.csv',cells)]:
        with (root/'reports'/name).open('w',encoding='utf-8-sig',newline='') as f:
            w=csv.DictWriter(f,fieldnames=list(data[0]));w.writeheader();w.writerows(data)
    groups=[v for v in vectors.values() if len(v)>1]
    (root/'reports/enriched_vector_collisions.json').write_text(json.dumps(groups,indent=2))
    plot=sum(c['evidence_kind']=='plot_synopsis' for c in cells)
    counts=[x['supported_AI_draft_cells'] for x in queue]
    known=len(cells)
    result={'books':len(catalog),'questions':len(q),'total_cells':len(catalog)*len(q),
      'books_with_selected_passage_review':progress['books_with_AI_passage_review'],
      'plot_cells':plot,'metadata_cells':known-plot,'total_non_unknown_cells':known,
      'unknown_cells':len(catalog)*len(q)-known,'books_with_at_least_one_label':sum(c>0 for c in counts),
      'count_gate_12_only':sum(c>=12 for c in counts),'count_gate_12_excluding_quarantines':sum(x['count_gate_12'] and not x['source_or_form_quarantine'] for x in queue),
      'form_or_source_quarantines':len(quarantine),'identical_vector_groups':len(groups),
      'books_in_identical_vectors':sum(len(g) for g in groups),'per_question_counts':dict(sorted(perq.items())),
      'pending_unverified_publication_year_claims':len(json.loads((root/'data/pending_publication_year_claims.json').read_text())),
      'human_reviewed_cells':0,'active_game_targets_claimed':0,
      'app_source_available':False,'app_simulator_or_browser_run':False,
      'scope':'All 500 selected passage panels reviewed by AI. Exact quotes and schemas validated. Full novel/source reading and independent factual/spoiler checks not complete. A count gate is not a gameplay result.'}
    (root/'reports/500_book_pass_summary.json').write_text(json.dumps(result,indent=2))
    runtime={'format':'thatbook-proposed-matrix-v1','candidate_only':True,'human_reviewed':False,
      'question_ids':[x['id'] for x in q],'books':[{'id':r['id'],'title':r['title'],'active_in_game':False,
        'source_or_form_quarantine':r['id'] in quarantine,'p_yes':[c['p_yes'] for c in rows[r['id']]['answers']]} for r in catalog]}
    (root/'data/core500_enriched_candidate_matrix.json').write_text(json.dumps(runtime,ensure_ascii=False,separators=(',',':')))
    print(json.dumps({k:v for k,v in result.items() if k!='per_question_counts'},indent=2))

if __name__=='__main__':main()
