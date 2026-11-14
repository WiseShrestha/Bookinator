#!/usr/bin/env python3
"""Replay the inspected subset of the incomplete external research checkpoint.

This does not promote any row to production or claim human review.
"""
import argparse,json
from pathlib import Path

WITHHELD={('cmu:enwiki:397398','q02'),('cmu:enwiki:42645','q11'),('cmu:enwiki:42645','q27'),
 ('cmu:enwiki:161446','q02'),('cmu:enwiki:161446','q43'),('cmu:enwiki:17253525','q02'),
 ('cmu:enwiki:17253525','q45'),('cmu:enwiki:17253525','q46')}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--root',type=Path,required=True)
    args=ap.parse_args();root=args.root
    raw=json.loads((root/'reports/research_agent_20_credit_checkpoint.json').read_text())
    catalog={r['id']:r for r in [json.loads(s) for s in (root/'data/priority_500.jsonl').read_text().splitlines()]}
    questions={q['id']:q for q in json.loads((root/'questions_64.json').read_text())}
    matrix=json.loads((root/'data/core500_draft_labels.json').read_text());rows={b['book_id']:b for b in matrix['books']}
    methods=json.loads((root/'data/label_methods.json').read_text());accepted=[];rejected=[]
    for book in raw.get('partial',{}).get('books',[]):
        bid=book['book_id'];record=catalog[bid];by_q={c['question_id']:c for c in rows[bid]['answers']}
        for cell in book.get('cells',[]):
            qid=cell['question_id'];quote=cell.get('evidence_quote','')
            if (bid,qid) in WITHHELD:
                rejected.append({'book_id':bid,'question_id':qid,'reason':'Narrative importance or theme too weakly supported.'});continue
            if qid not in questions or cell.get('question_text')!=questions[qid]['text']:
                rejected.append({'book_id':bid,'question_id':qid,'reason':'Question text/ID differs from canonical bank.'});continue
            if not quote or len(quote)>220 or quote not in record['synopsis']['text']:
                rejected.append({'book_id':bid,'question_id':qid,'reason':'Quote not an exact <=220-character source substring.'});continue
            by_q[qid].update(p_yes=cell['p_yes'],status='supported',source_id=record['synopsis']['source_id'],
                evidence_quote=quote,premise_safe=True,reviewed=False)
            methods[bid][qid]={'method':'AI_research_checkpoint_filtered_by_assistant','review_required':True,
                'human_reviewed':False,'research_run_status':'incomplete_credit_limit',
                'reason':cell['reason'],'match_start':record['synopsis']['text'].find(quote)}
            accepted.append({'book_id':bid,'question_id':qid})
    (root/'data/core500_draft_labels.json').write_text(json.dumps(matrix,ensure_ascii=False,indent=2))
    (root/'data/after_145_draft_labels.json').write_text(json.dumps({'books':matrix['books'][145:]},ensure_ascii=False,indent=2))
    (root/'data/label_methods.json').write_text(json.dumps(methods,ensure_ascii=False,indent=2))
    report={'research_status':raw.get('status'),'stop_reason':raw.get('stopReason'),'authorized_total_credit_cap':20,
      'reported_credits_used':raw.get('creditsUsed'),'agent_scope_books':5,
      'accepted_or_refined_cells':len(accepted),'withheld_cells':rejected,
      'completed_500_book_semantic_labeling':False,'human_reviewed_cells':0}
    (root/'reports/research_checkpoint_filter_report.json').write_text(json.dumps(report,indent=2))
    print(json.dumps({'accepted_or_refined':len(accepted),'withheld':len(rejected),'still_incomplete':True}))

if __name__=='__main__':main()
