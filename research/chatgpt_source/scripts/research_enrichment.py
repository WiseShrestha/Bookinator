"""Admit explicit current work metadata and closed-list Nobel lookups as AI drafts.

Sources are preserved with revision IDs. No narrative features come from edition dates.
"""
import argparse,copy,collections,hashlib,json,re,unicodedata
from pathlib import Path

LANGUAGE_QIDS={'Q1860':'English','Q9176':'Korean','Q5287':'Japanese','Q150':'French','Q1321':'Spanish',
 'Q188':'German','Q7737':'Russian','Q9027':'Swedish','Q5146':'Portuguese','Q652':'Italian','Q9043':'Norwegian'}
TARGET_LANGUAGES={'q57':'Korean','q58':'English','q59':'Japanese'}
DATE_KEYS=['publication_date','published','pub_date','release_date']
KNOWN_AUTHOR_ALIASES={'fyodordostoyevsky':'fyodordostoevsky','kenfollett':'kennethmartinfollett'}

def norm(value):
    return re.sub(r'[^a-z0-9]','',unicodedata.normalize('NFKD',value).encode('ascii','ignore').decode().lower())

def values(entity,prop):
    return [c.get('mainsnak',{}).get('datavalue',{}).get('value') for c in entity.get('claims',{}).get(prop,[])
      if c.get('rank')!='deprecated' and c.get('mainsnak',{}).get('snaktype')=='value']

def year_values(text):
    return sorted(set(map(int,re.findall(r'(?<!\d)(1[0-9]{3}|20[0-2][0-9])(?!\d)',text))))

def name_tokens(value):
    return re.findall('[a-z]+',unicodedata.normalize('NFKD',value).encode('ascii','ignore').decode().lower())

def same_person_name(a,b):
    aa=name_tokens(a);bb=name_tokens(b)
    if not aa or not bb or aa[-1]!=bb[-1]:return False
    if aa==bb:return True
    if aa[0]!=bb[0] and not (len(aa[0])==1 and bb[0].startswith(aa[0])) and not (len(bb[0])==1 and aa[0].startswith(bb[0])):return False
    # Same first and last name, compatible optional middle names/initials.
    short,long=(aa,bb) if len(aa)<=len(bb) else (bb,aa)
    return all(x==y or (len(x)==1 and y.startswith(x)) for x,y in zip(short[1:-1],long[1:-1]))

def setting_features(setting):
    """Only explicit narrative set_in fields, never publication country or author nationality."""
    out={};uk=r'United Kingdom|Great Britain|\bEngland\b|\bScotland\b|\bWales\b|Yorkshire|Hertfordshire|Derbyshire|Cornwall'
    us=r'United States|\bU\.S\.|California|Massachusetts|\bMaine\b|Wisconsin|New Jersey|New York City|Santa Clara Valley'
    cities=r'London|Paris|New York City|Manhattan|Chicago|San Francisco|Tokyo|Seoul|Hong Kong|Moscow|Saint Petersburg|Montreal|\bOran\b'
    if re.search(uk,setting,re.I):out['q13']=.7
    if re.search(us,setting,re.I):out['q14']=.7
    if re.search(cities,setting,re.I):out['q10']=.7
    if out or re.search(r'United Kingdom|\bEngland\b|\bGermany\b|\bAlgeria\b|\bChile\b|\bColombia\b|\bItaly\b|the Caribbean|the Pyrenees|the Yukon|Pepin County',setting,re.I):
        if not re.search(r'Narnia|Middle.earth|Pern|Faerie|Discworld',setting,re.I):out['q15']=.3
    return out

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--root',type=Path,required=True);root=ap.parse_args().root
    catalog=[json.loads(s) for s in (root/'data/priority_500_enriched.jsonl').read_text().splitlines()]
    payload=json.loads((root/'data/core500_labels_with_metadata.json').read_text());byid={r['book_id']:r for r in payload['books']}
    current=json.loads((root/'data/current_work_evidence.json').read_text());pages=current['pages']
    entities=json.loads((root/'data/current_work_entities.json').read_text())
    goodbooks={int(r['book_id']):r for r in [json.loads(s) for s in (root/'data/goodbooks_500_source_rows.jsonl').read_text().splitlines()]}
    nobel=json.loads((root/'data/current_work_sources/nobel_literature.json').read_text())
    prizes=[p for p in nobel['nobelPrizes'] if int(p['awardYear'])<=2026 and p.get('category',{}).get('en')=='Literature']
    assert len(prizes)==126 and {int(p['awardYear']) for p in prizes}==set(range(1901,2027))
    assert any(p['awardYear']=='2026' and p.get('dateAwarded','')<='2026-11-14' and p.get('laureates') for p in prizes)
    laureates=[{'year':int(p['awardYear']),'id':l['id'],'known_name':l.get('knownName',{}).get('en',''),
      'full_name':l.get('fullName',{}).get('en','')} for p in prizes for l in p.get('laureates',[])]
    audits=[];issues=[];resolved_dates=set();methods={};identity=[]
    for index,r in enumerate(catalog):
        bid=r['id'];cells={c['question_id']:c for c in byid[bid]['answers']};methods[bid]={}
        def add(q,p,sid,quote,method,**extra):
            assert sid in r['evidence_texts'] and quote in r['evidence_texts'][sid] and 0<len(quote)<=220
            old=dict(cells[q]);cells[q].update(p_yes=p,status='supported',source_id=sid,evidence_quote=quote,premise_safe=True,reviewed=False)
            audits.append({'book_id':bid,'index':index,'question_id':q,'old_p_yes':old['p_yes'],'p_yes':p,
              'source_id':sid,'evidence_quote':quote,'method':method,**extra})
            methods[bid][q]={'method':method,'review_required':True,**extra}
        pid=current['corrected_little_women_page_id'] if r['title']=='Little Women' else current.get('corrected_page_overrides',{}).get(r['title'],r['source_ids']['wikipedia_page_id'])
        page=pages.get(str(pid));fields={};wiki_sid=None
        if r['title']=='Silence' and page and page['title']!='Silence (Fitzpatrick novel)':
            issues.append({'book_id':bid,'issue':'Old article resolves to series; individual-book metadata withheld pending publisher check'})
            page=None
        if page:
            wiki_sid=page['source_id'];r['evidence_texts'][wiki_sid]=page['evidence_text']
            r['sources'].append({'id':wiki_sid,'url':page['url'],'revision_url':page['revision_url'],
              'revision_id':page['revision_id'],'retrieved_at':page['retrieved_at'],'license':'CC-BY-SA-4.0',
              'attribution':'Wikipedia contributors','modifications':current['transform']})
            fields=page['infoboxes'][0]['fields'] if page['infoboxes'] else {}
            if r['title']=='Little Women':
                r['source_ids']['previous_cmu_wikipedia_page_id']=r['source_ids']['wikipedia_page_id']
                r['source_ids']['wikipedia_page_id']=pid
                r['identity_correction']='Original CMU synopsis is of the musical. Use this current novel page for new work evidence; original synopsis remains archived and excluded.'
                identity.append({'book_id':bid,'correction':r['identity_correction'],'source_id':wiki_sid})
            if index==337:
                assert fields.get('author',{}).get('text')=='Jon Scieszka'
                r['previous_author_claim']=r['authors'];r['authors']=['Jon Scieszka'];r['illustrators']=['Lane Smith']
                identity.append({'book_id':bid,'correction':'Lane Smith is illustrator; Jon Scieszka is author.','source_id':wiki_sid})
            author=fields.get('author',{}).get('text','')
            if author and not any(KNOWN_AUTHOR_ALIASES.get(norm(a),norm(a)) in norm(author) or norm(author) in norm(a) for a in r['authors']):
                issues.append({'book_id':bid,'issue':'author identity mismatch','expected':r['authors'],'source_author':author})
                continue
            entity=entities.get(page.get('qid'),{})
            # Reject work/edition confusion instead of importing translated-edition language.
            types={v.get('id') for v in values(entity,'P31') if isinstance(v,dict)}
            if 'Q3331189' in types:
                issues.append({'book_id':bid,'issue':'Wikidata item is an edition; original-language inference withheld'});continue
            wd_sid='wikidata:'+str(page.get('qid'))+':'+str(entity.get('lastrevid'))
            wd_lines=[]
            for prop in ['P31','P364','P407','P577']:
                for v in values(entity,prop):wd_lines.append(prop+': '+json.dumps(v,ensure_ascii=False,sort_keys=True))
            r['evidence_texts'][wd_sid]='Entity: '+str(page.get('qid'))+'\n'+'\n'.join(wd_lines)
            r['sources'].append({'id':wd_sid,'url':'https://www.wikidata.org/wiki/'+str(page.get('qid')),
              'revision_url':'https://www.wikidata.org/w/index.php?oldid='+str(entity.get('lastrevid')),
              'license':'CC0-1.0','attribution':'Wikidata contributors','modifications':'Selected exact statement values rendered as property: JSON lines.'})
            lang=fields.get('language',{}).get('text','');lang_words=set(re.findall('[a-z]+',lang.lower()))
            known_language_names={'english','korean','japanese','french','spanish','german','russian','swedish','portuguese','italian','norwegian','lapine','american','language','with','some','and','occasionally'}
            if lang and lang_words<=known_language_names:
                quoted='language: '+lang
                if len(quoted)<=220:
                    for q,target in TARGET_LANGUAGES.items():add(q,.7 if target.lower() in lang_words else .3,wiki_sid,quoted,'explicit_work_language_field')
                    r['original_language_claim']=lang
            else:
                claims=values(entity,'P364') or values(entity,'P407')
                ids={v.get('id') for v in claims if isinstance(v,dict)}
                if ids and ids<=set(LANGUAGE_QIDS):
                    quoted=next((line for line in wd_lines if line.startswith('P364:') or line.startswith('P407:')),None)
                    if len(ids)==1 and quoted:
                        languages={LANGUAGE_QIDS[x] for x in ids}
                        for q,target in TARGET_LANGUAGES.items():add(q,.7 if target in languages else .3,wd_sid,quoted,'explicit_work_language_statement')
                        r['original_language_claim']='; '.join(sorted(languages))
                elif lang and 'english' in lang_words:
                    add('q58',.7,wiki_sid,'language: '+lang,'explicit_English_membership_with_other_languages_unresolved')
            # Dates are admitted only with current work-level corroboration, not the old CMU date alone.
            date_key=next((k for k in DATE_KEYS if fields.get(k,{}).get('text')),None)
            dates=year_values(fields[date_key]['text']) if date_key else []
            rawyear=goodbooks[r['source_ids']['goodbooks_id']]['original_publication_year']
            try:gbyear=int(float(rawyear))
            except ValueError:gbyear=None
            wd_dates=[int(v['time'][1:5]) for v in values(entity,'P577') if isinstance(v,dict) and re.match(r'^\+\d{4}-',v.get('time','')) and v.get('precision',0)>=9]
            if dates and gbyear in dates:
                quote=date_key+': '+fields[date_key]['text']
                if len(quote)>220:quote=quote[:220]
                if str(gbyear) in quote:
                    for q,p in [('q60',.7 if gbyear<1900 else .3),('q61',.7 if gbyear>=2000 else .3)]:
                        add(q,p,wiki_sid,quote,'current_work_publication_date_corroborates_original_year',corroborating_source='goodbooks:'+str(r['source_ids']['goodbooks_id']),year=gbyear)
                        resolved_dates.add((bid,q))
                    r['publication_period_year_evidence']={'corroborated_candidate_year':gbyear,'scope':'Supports q60/q61 period predicates; unique first-publication year not independently resolved.'}
            elif gbyear in wd_dates:
                quote=next(line for line in wd_lines if line.startswith('P577:') and f'+{gbyear:04d}-' in line)
                for q,p in [('q60',.7 if gbyear<1900 else .3),('q61',.7 if gbyear>=2000 else .3)]:
                    add(q,p,wd_sid,quote,'work_publication_statement_corroborates_original_year',corroborating_source='goodbooks:'+str(r['source_ids']['goodbooks_id']),year=gbyear)
                    resolved_dates.add((bid,q))
                r['publication_period_year_evidence']={'corroborated_candidate_year':gbyear,'scope':'Supports q60/q61 period predicates; unique first-publication year not independently resolved.'}
            elif (dates or wd_dates) and gbyear is not None and all((y<1900)==(gbyear<1900) and (y>=2000)==(gbyear>=2000) for y in dates+wd_dates):
                # Different exact years can still establish the same requested date predicates.
                if date_key:quote=(date_key+': '+fields[date_key]['text'])[:220];date_sid=wiki_sid
                else:quote=next(line for line in wd_lines if line.startswith('P577:'));date_sid=wd_sid
                for q,p in [('q60',.7 if gbyear<1900 else .3),('q61',.7 if gbyear>=2000 else .3)]:
                    add(q,p,date_sid,quote,'publication_period_corroborated_despite_exact_year_disagreement',
                      goodbooks_year=gbyear,current_work_years=dates,wikidata_years=wd_dates)
                    resolved_dates.add((bid,q))
                issues.append({'book_id':bid,'issue':'exact year disputed; requested before-1900/2000-onward predicates agree across all sources','goodbooks_year':gbyear,'current_work_years':dates,'wikidata_years':wd_dates})
            else:issues.append({'book_id':bid,'issue':'publication-year discrepancy or missing corroboration','goodbooks_year':gbyear,'current_work_years':dates,'wikidata_years':wd_dates})
            series=fields.get('series',{}).get('text','')
            if series and len(series)<180 and re.search(r'[A-Za-z]',series):
                add('q53',.7,wiki_sid,'series: '+series,'explicit_named_series_field')
                position=fields.get('release_number',{}).get('text','')
                pos=re.match(r'^(\d+)(?:st|nd|rd|th)?(?:\s+in series)?$',position)
                if pos:
                    p=.7 if int(pos[1])==1 else .3
                    if cells['q54']['p_yes'] not in [.5,p]:
                        issues.append({'book_id':bid,'issue':'conflicting series ordering; first-volume answer withheld','prior_p_yes':cells['q54']['p_yes'],'current_position':position})
                        cells['q54'].update(p_yes=.5,status='ambiguous',source_id=None,evidence_quote=None,premise_safe=False,reviewed=False)
                    else:add('q54',p,wiki_sid,'release_number: '+position,'explicit_series_position')
            setting=fields.get('set_in',{}).get('text','')
            if setting and len('set_in: '+setting)<=220:
                for q,p in setting_features(setting).items():
                    add(q,p,wiki_sid,'set_in: '+setting,'explicit_narrative_setting_field_with_geographic_mapping')
            genre=fields.get('genre',{}).get('text','')
            for q,pattern in [('q26',r'romance'),('q41',r'horror'),('q42',r'satir|comedy|comic novel|humou?r'),
              ('q43',r'coming.of.age|bildungsroman'),('q48',r'philosophical'),('q33',r'time.travel'),('q51',r'epistolary')]:
                if re.search(pattern,genre,re.I) and len('genre: '+genre)<=220:
                    add(q,.7,wiki_sid,'genre: '+genre,'explicit_work_genre_classification')
            lead=page.get('lead_text','')
            novella=re.match(r'^.{0,180}?\b(?:is|was)\b[^.]{0,150}\b(?:novella|short novel)\b[^.]*\.',lead,re.I|re.S)
            if novella:
                quote=novella[0][:220]
                if quote in page['evidence_text']:add('q56',.7,wiki_sid,quote,'explicit_lead_novella_classification')
        if index==248:
            facts=json.loads((root/'data/current_work_sources/publisher_silence_facts.json').read_text())
            assert facts['name']=='Silence' and facts['datePublished']=='2011-10-04' and '62751281' in facts['author']
            sid='publisher:Silence:9781442426641';quote='datePublished: '+facts['datePublished']
            r['evidence_texts'][sid]='Title: Silence\nAuthor: Becca Fitzpatrick\nISBN: 9781442426641\n'+quote
            r['sources'].append({'id':sid,'url':facts['url'],'retrieved_date':facts['retrieved_date'],
              'license':'Factual bibliographic metadata only; publisher page copyright is not relicensed.',
              'attribution':'Simon & Schuster','modifications':'Only factual catalog fields retained; prose description, excerpt and images omitted.'})
            add('q60',.3,sid,quote,'publisher_original_hardcover_date_corroborates_original_year',corroborating_source='goodbooks:'+str(r['source_ids']['goodbooks_id']))
            add('q61',.7,sid,quote,'publisher_original_hardcover_date_corroborates_original_year',corroborating_source='goodbooks:'+str(r['source_ids']['goodbooks_id']))
            resolved_dates.update([(bid,'q60'),(bid,'q61')])
        # Nobel facts use a complete, current, authoritative list; absence here is a closed-list lookup.
        matches=[]
        for author in r['authors']:
            matches.extend(l for l in laureates if same_person_name(author,l['known_name']) or same_person_name(author,l['full_name']))
        nobel_sid='nobel:literature:1901-2026';names='; '.join(r['authors'])
        summary='Author(s): '+names+'\nNobel Literature complete list: 1901-2026\nMatch: '+('; '.join(f'{m["known_name"]} ({m["year"]})' for m in matches) if matches else 'none')+'\nLookup as of: 2026-11-14'
        r['evidence_texts'][nobel_sid]=summary
        r['sources'].append({'id':nobel_sid,'url':'https://api.nobelprize.org/2.1/nobelPrizes?nobelPrizeCategory=lit&limit=200',
          'license':'CC0-1.0 under Nobel API terms','attribution':'Nobel Prize Outreach; Nobel Prize API',
          'terms_url':'https://www.nobelprize.org/about/terms-of-use-for-api-nobelprize-org-and-data-nobelprize-org/',
          'modifications':'Deterministic author-name comparison against all 126 annual literature prize records, including no-award years; full source cached. This is a derived lookup, not a verbatim source quote.'})
        add('q64',.7 if matches else .3,nobel_sid,summary,'closed_complete_official_laureate_list_lookup',derived_evidence=True)
        r['readiness']='AI_researched_draft';r['active_in_game']=False
    (root/'data/core500_researched_labels.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2))
    (root/'data/priority_500_researched.jsonl').write_text('\n'.join(json.dumps(r,ensure_ascii=False,separators=(',',':')) for r in catalog)+'\n')
    pending=json.loads((root/'data/pending_publication_year_claims.json').read_text())
    pending=[c for c in pending if (c['book_id'],c['question_id']) not in resolved_dates]
    (root/'data/still_pending_publication_year_claims.json').write_text(json.dumps(pending,ensure_ascii=False,indent=2))
    (root/'reports/research_enrichment_audit.json').write_text(json.dumps({'updates':audits,'issues':issues,'identity_corrections':identity,
      'remaining_date_claims':len(pending),'human_reviewed':False},ensure_ascii=False,indent=2))
    (root/'data/research_label_methods.json').write_text(json.dumps(methods,ensure_ascii=False,indent=2))
    print(json.dumps({'updates':len(audits),'date_claims_resolved':len(resolved_dates),'date_claims_pending':len(pending),'issues':len(issues),'identities_corrected':len(identity),'per_question_updates':dict(collections.Counter(x['question_id'] for x in audits))}))

if __name__=='__main__':main()
