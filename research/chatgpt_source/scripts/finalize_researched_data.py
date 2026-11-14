"""Correct final audit findings and write measured, inactive import artifacts."""
import argparse,collections,csv,json,re
from pathlib import Path
from apply_current_decisions import derive_era_negatives
from validate_evidence_matrix import validate

FORMS={141:'Play; excluded from the default novels-only scope.',
199:'Illustrated bedtime/children\'s book; excluded pending a broader form-scope decision.',
216:'Illustrated children\'s fable; excluded pending a broader form-scope decision.',
256:'Fictional textbook/guide, rather than a conventional narrative novel.',
300:'Children\'s picture book; excluded from the default novels-only scope.',
337:'Illustrated children\'s retelling; excluded pending a broader form-scope decision.',
356:'Collection of myths and stories; excluded pending a broader form-scope decision.',
494:'Fictional companion/reference book, rather than a conventional narrative novel.'}

def unknown(cell):
    cell.update(p_yes=.5,status='insufficient_evidence',source_id=None,evidence_quote=None,premise_safe=False,reviewed=False)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--root',type=Path,required=True);root=ap.parse_args().root
    load=lambda f:json.loads((root/f).read_text())
    write=lambda f,x:(root/f).write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')
    catalog=[json.loads(s) for s in (root/'data/priority_500_researched.jsonl').read_text().splitlines()]
    original=[json.loads(s) for s in (root/'data/priority_500.jsonl').read_text().splitlines()]
    payload=load('data/core500_researched_labels.json');rows={r['book_id']:r for r in payload['books']}
    prior={r['book_id']:r for r in load('data/core500_labels_with_metadata.json')['books']}
    methods=load('data/research_label_methods.json');questions=load('questions_64.json')
    fixes=load('reports/final_corrections.json') if (root/'reports/final_corrections.json').exists() else []
    for r in catalog:
        bid=r['id'];cs={c['question_id']:c for c in rows[bid]['answers']}
        if 'first_publication_year_claim' in r:
            r['publication_period_year_evidence']={'corroborated_candidate_year':r.pop('first_publication_year_claim'),
              'scope':'Supports q60/q61 period predicates; unique first-publication year not independently resolved.'}
        c=cs['q53']
        if methods[bid].get('q53',{}).get('method')=='explicit_named_series_field' and not re.search('[A-Za-z]',c['evidence_quote'].partition(': ')[2]):
            old=dict(c);fallback=next(x for x in prior[bid]['answers'] if x['question_id']=='q53')
            c.clear();c.update(fallback);methods[bid].pop('q53',None)
            fixes.append({'book_id':bid,'question_id':'q53','old':old,'replacement':dict(c),'reason':'Numeric infobox series field is not a named series; restore prior source-supported value or unknown.'})
        if bid=='cmu:enwiki:64029' and cs['q19']['p_yes']>.5:
            old=dict(cs['q19']);unknown(cs['q19']);methods[bid].pop('q19',None)
            fixes.append({'book_id':bid,'question_id':'q19','old':old,'reason':'The Green Mile framing scenes in 1996 do not establish a majority 1946-1999 setting; principal death-row story is in 1932.'})
        for q,source in derive_era_negatives(cs):
            c=cs[source];cs[q].update(p_yes=round(1-c['p_yes'],1),status='supported',source_id=c['source_id'],evidence_quote=c['evidence_quote'],premise_safe=True,reviewed=False)
            methods[bid][q]={'method':'derived_disjoint_majority_era' if source!='q21' else 'imagined_future_excluded_from_real_world_2000_question','derived_from_question':source,'review_required':True}
        r['active_in_game']=False;r['readiness']='AI_researched_draft'
    assert len(catalog)==500 and [r['id'] for r in catalog]==[r['id'] for r in original]
    assert all(r['synopsis']==o['synopsis'] for r,o in zip(catalog,original)), 'Original text changed'
    write('data/core500_researched_labels.json',payload);write('data/research_label_methods.json',methods)
    (root/'data/priority_500_researched.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False,separators=(',',':'))+'\n' for r in catalog))
    write('reports/final_corrections.json',fixes)
    result=validate(payload,{r['id']:r for r in catalog},questions);write('reports/researched_validation_report.json',result)
    if not result['valid']:raise ValueError(result['errors'][:10])
    stats=[];vectors=[];cells=[];quarantine=[];vector_groups=collections.defaultdict(list);source_counts=collections.Counter();method_counts=collections.Counter();qs=collections.Counter()
    for i,r in enumerate(catalog):
        row=rows[r['id']];known=[c for c in row['answers'] if c['p_yes']!=.5];cs={c['question_id']:c for c in row['answers']}
        yes=[q for q in ['q17','q18','q19','q20'] if cs[q]['p_yes']>.5]
        assert len(yes)<=1 and not(cs['q20']['p_yes']>.5 and cs['q21']['p_yes']>.5),r['title']
        s={'priority_index':i,'book_id':r['id'],'title':r['title'],'authors':'; '.join(r['authors']),
          'supported_draft_cells':len(known),'unknown_cells':64-len(known),'human_reviewed_cells':sum(c['reviewed'] for c in row['answers']),
          'count_gate_12_met':len(known)>=12,'form_quarantine':i in FORMS,'form_reason':FORMS.get(i,''),'active_in_game':False}
        stats.append(s)
        if i in FORMS:
            sid=next((src['id'] for src in r['sources'] if src['id'].startswith('enwiki:')),None)
            quarantine.append({**s,'evidence_source_id':sid,'note':'Form screening is an AI scope judgment; retain row and revisit if the game includes non-novel forms.'})
        vec=[cs[q['id']]['p_yes'] for q in questions];vector_groups[tuple(vec)].append({'book_id':r['id'],'title':r['title']})
        vectors.append({'id':r['id'],'title':r['title'],'authors':r['authors'],'p_yes':vec,'active':False,'form_quarantine':i in FORMS,'known_count':len(known)})
        for c in row['answers']:
            method=methods[r['id']].get(c['question_id'],{}).get('method','AI_previous_source_adjudication' if c['p_yes']!=.5 else 'unknown')
            cells.append({'book_id':r['id'],'title':r['title'],**c,'method':method})
            if c['p_yes']!=.5:
                source_counts[c['source_id'].split(':')[0]]+=1;method_counts[method]+=1;qs[c['question_id']]+=1
    def csvout(name,records):
        with (root/name).open('w',newline='') as f:
            w=csv.DictWriter(f,fieldnames=list(records[0]));w.writeheader();w.writerows(records)
    csvout('reports/researched_book_status.csv',stats);csvout('reports/all_researched_labels.csv',cells)
    write('reports/form_quarantine.json',quarantine)
    collisions=[{'books':items,'count':len(items)} for items in vector_groups.values() if len(items)>1]
    write('reports/researched_vector_collisions.json',collisions)
    write('data/core500_researched_candidate_matrix.json',{'format':'inactive-candidate-v1','question_ids':[q['id'] for q in questions],'books':vectors,'warning':'Coverage vectors only. No target has been activated or human-reviewed.'})
    ids={r['id'] for r in catalog[145:]};write('data/after_145_researched_labels.json',{'books':[r for r in payload['books'] if r['book_id'] in ids]})
    audit=load('reports/research_enrichment_audit.json');issues=audit['issues'];conflicts=[x for x in issues if x['issue'].startswith('exact year')]
    summary={'status':'Completed AI evidence-research pass; ready for controlled import and app integration, not human-approved production data.',
      'books':500,'questions_per_book':64,'matrix_cells':32000,'non_unknown_cells':result['non_unknown_cells'],'unknown_cells':32000-result['non_unknown_cells'],
      'count_gate_12':sum(s['count_gate_12_met'] for s in stats),'form_quarantines':len(FORMS),
      'in_scope_records':500-len(FORMS),'in_scope_at_count_gate_12':sum(s['count_gate_12_met'] and not s['form_quarantine'] for s in stats),
      'human_reviewed_cells':0,'active_game_targets':0,'remaining_publication_period_predicates':len(load('data/still_pending_publication_year_claims.json')),
      'exact_year_discrepancy_records':len(conflicts),'identical_vector_groups':len(collisions),'records_in_identical_vector_groups':sum(x['count'] for x in collisions),
      'admitted_cells_by_source_family':dict(source_counts),'admitted_cells_by_method':dict(method_counts),'known_by_question':dict(sorted(qs.items())),
      'current_context_panels':load('reports/current_context_review_audit.json')['contexts_reviewed'],'additional_weak_context_panels':load('reports/weak_record_review_audit.json')['contexts_reviewed'],
      'under_12':[s for s in stats if not s['count_gate_12_met']],
      'unresolved_language':[{'book_id':r['id'],'title':r['title'],'question_ids':[c['question_id'] for c in rows[r['id']]['answers'] if c['question_id'] in ['q57','q58','q59'] and c['p_yes']==.5]} for r in catalog if any(c['question_id'] in ['q57','q58','q59'] and c['p_yes']==.5 for c in rows[r['id']]['answers'])],
      'exact_year_issues':conflicts,'series_order_issues':[x for x in issues if x['issue'].startswith('conflicting series')],
      'limitations':['AI interpretation of selected source contexts, not full-novel reading or exhaustive factual verification.','Derived Nobel closed-list lookups and era constraints are labeled in research_label_methods.json.','Count coverage is not a game performance measure.','Original Claude app and claimed 145-row checkpoint unavailable; no original-app integration or browser test claimed.']}
    write('reports/500_book_researched_summary.json',summary)
    print(json.dumps({k:v for k,v in summary.items() if isinstance(v,(int,str))},indent=2))

if __name__=='__main__':main()
