#!/usr/bin/env python3
"""Build a source-evidence catalog, not a verified question matrix. Standard library only."""
import argparse, collections, csv, hashlib, io, json, re, tarfile, unicodedata
from decimal import Decimal, InvalidOperation
from pathlib import Path

CMU_URL = 'https://www.cs.cmu.edu/~dbamman/booksummaries.html'
GB_URL = 'https://github.com/zygmuntz/goodbooks-10k'
BLOCKED = {'non-fiction','biography','autobiography','memoir','essays','essay',
           'short story','short story collection','anthology','poetry','play',
           'picture book','comic book','graphic novel','role-playing game',
           'reference','textbook','cookbook','self-help','travel literature'}
FICTION = {'fiction','speculative fiction','science fiction','fantasy','mystery',
           'crime fiction','detective fiction','thriller','horror','historical fiction',
           'young adult literature','dystopia','adventure','gothic fiction'}

def norm(s):
    return ''.join(c for c in unicodedata.normalize('NFKD', s).casefold()
                   if c.isalnum() and not unicodedata.combining(c))

def title_keys(s):
    # Only remove parenthetical SERIES markers. Keep volume names and subtitles.
    return {norm(s), norm(re.sub(r'\s*\([^)]*#\s*\d[^)]*\)\s*$', '', s))} - {''}

def isbn13(raw):
    # Several source values use rounded scientific notation. Never fabricate digits.
    try:
        value = Decimal(raw)
        if 'e' in raw.casefold() and len(value.as_tuple().digits)<13: return None
        if value != value.to_integral_value(): return None
        s = str(int(value))
    except (InvalidOperation, ValueError): return None
    if len(s) != 13 or not s.isdigit(): return None
    return s if sum(int(c)*(1 if i%2==0 else 3) for i,c in enumerate(s)) % 10 == 0 else None

def classify(genres):
    g = {x.casefold() for x in genres}
    novel = any('novel' in x for x in g) or 'novella' in g
    blocked = sorted(g & BLOCKED)
    if blocked:
        return 'review_conflicting_form' if novel else 'excluded_form_or_nonfiction', blocked
    if novel: return 'novel_candidate', []
    if g & FICTION: return 'fiction_candidate_form_unverified', []
    return 'needs_form_review', []

def write_jsonl(path, records):
    with path.open('w', encoding='utf-8') as f:
        for r in records: f.write(json.dumps(r, ensure_ascii=False, separators=(',',':'))+'\n')

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--raw',type=Path,required=True)
    ap.add_argument('--out',type=Path,required=True)
    args=ap.parse_args(); args.out.mkdir(parents=True,exist_ok=True)
    gb=list(csv.DictReader((args.raw/'goodbooks_books.csv').open(encoding='utf-8')))
    idx=collections.defaultdict(list)
    for r in gb:
        for key in title_keys(r['title']) | title_keys(r['original_title']): idx[key].append(r)
    with tarfile.open(args.raw/'booksummaries.tar.gz','r:gz') as tar:
        member=next(m for m in tar.getmembers() if m.name=='booksummaries/booksummaries.txt')
        # Read the exact known member; never extract paths from the archive.
        raw_text=tar.extractfile(member).read().decode('utf-8')
    records=[]; matches=[]; issues=[]
    for line_no,line in enumerate(raw_text.splitlines(),1):
        columns=line.split('\t',6)
        if len(columns)!=7: raise ValueError(f'Invalid TSV at line {line_no}')
        wp,fb,title,author,date,genre_json,summary=columns
        genres=list(json.loads(genre_json or '{}').values())
        status,reasons=classify(genres)
        candidates={r['book_id']:r for k in title_keys(title) for r in idx.get(k,[])}
        candidates=[r for r in candidates.values() if author and norm(author) in
                    {norm(a.strip()) for a in r['authors'].split(',')}]
        exact=candidates[0] if len(candidates)==1 else None
        record={
            'id':'cmu:enwiki:'+wp, 'title':title, 'title_ko':None,
            'authors':[author] if author else [], 'aliases':[],
            'source_publication_date':date or None,
            'first_publication_year':None,
            'original_language':None, 'genres':genres,
            'source_ids':{'wikipedia_page_id':int(wp),'freebase_id':fb or None},
            'synopsis':{'text':summary.strip(),'source_id':'cmu:'+wp,
                        'snapshot_date':'2012-11-02','contains_spoilers':True},
            'sources':[{'id':'cmu:'+wp,'url':CMU_URL,
                        'article_url':'https://en.wikipedia.org/?curid='+wp,
                        'license':'CC-BY-SA-3.0-US',
                        'attribution':'Wikipedia contributors; CMU Book Summary Corpus, David Bamman and Noah Smith (2013)',
                        'source_row':line_no}],
            'eligibility':{'status':status,'reasons':reasons,'human_reviewed':False},
            'quality':{'missing_author':not bool(author),'missing_date':not bool(date),
                       'missing_genres':not bool(genres),'short_synopsis':len(summary.strip())<200},
            'popularity':None, 'editions':[],
            'library_search_url':'https://openlibrary.org/search?'+__import__('urllib.parse',fromlist=['urlencode']).urlencode({'title':title,'author':author}),
            'readiness':'evidence_only', 'active_in_game':False
        }
        if len(candidates)>1: issues.append({'book_id':record['id'],'issue':'ambiguous_title_author_join','goodbooks_ids':[r['book_id'] for r in candidates]})
        if exact:
            record['aliases']=list(dict.fromkeys(x for x in [exact['title'],exact['original_title']] if x and x!=title))
            record['popularity']={'source':'goodbooks-10k','ratings_count_2017':int(exact['ratings_count']),
                                  'goodbooks_id':int(exact['book_id']),'goodreads_book_id':exact['goodreads_book_id']}
            record['sources'].append({'id':'goodbooks:'+exact['book_id'],'url':GB_URL,
                                     'record_url':'https://www.goodreads.com/book/show/'+exact['goodreads_book_id'],
                                     'license':'CC-BY-SA-4.0','attribution':'Zygmunt Zając, goodbooks-10k (2017)',
                                     'join_rule':'unique normalized title + exact normalized author token'})
            record['source_ids']['goodreads_work_id']=exact['work_id']
            record['source_ids']['goodbooks_id']=int(exact['book_id'])
            valid_isbn=isbn13(exact['isbn13'])
            record['editions']=[{'isbn13':valid_isbn,'language_code_source':exact['language_code'],
                                'source_id':'goodbooks:'+exact['book_id'],'identity_reviewed':False}] if valid_isbn else []
            if exact['isbn13'] and not valid_isbn:
                issues.append({'book_id':record['id'],'issue':'invalid_or_rounded_isbn13','raw':exact['isbn13']})
            matches.append({'cmu_id':record['id'],'goodbooks_id':int(exact['book_id']),'title':title,'author':author})
        records.append(record)
    # One goodbooks work must never silently enrich multiple CMU records.
    reverse=collections.Counter(x['goodbooks_id'] for x in matches)
    collisions={k for k,v in reverse.items() if v>1}
    for r in records:
        gid=r['source_ids'].get('goodbooks_id')
        if gid in collisions:
            issues.append({'book_id':r['id'],'issue':'nonunique_goodbooks_work_join','goodbooks_id':gid})
            r['popularity']=None; r['editions']=[]
            r['sources']=[s for s in r['sources'] if not s['id'].startswith('goodbooks:')]
            r['aliases']=[]
            r['source_ids'].pop('goodbooks_id',None);r['source_ids'].pop('goodreads_work_id',None)
    matches=[x for x in matches if x['goodbooks_id'] not in collisions]
    records.sort(key=lambda r:r['source_ids']['wikipedia_page_id'])
    eligible=[r for r in records if r['eligibility']['status'] in {'novel_candidate','fiction_candidate_form_unverified'}
              and r['authors'] and len(r['synopsis']['text'])>=200]
    ranked=sorted((r for r in eligible if r['popularity']),key=lambda r:(-r['popularity']['ratings_count_2017'],r['id']))
    write_jsonl(args.out/'catalog_all_cmu.jsonl',records)
    (args.out/'fiction_candidate_ids.json').write_text(json.dumps([r['id'] for r in eligible]),encoding='utf-8')
    for n in [100,300,500]:
        subset=ranked[:n]
        write_jsonl(args.out/f'priority_{n}.jsonl',subset)
        (args.out/f'priority_{n}.json').write_text(json.dumps({'schema_version':'1.0','status':'evidence_only','books':subset},ensure_ascii=False),encoding='utf-8')
    write_jsonl(args.out/'join_audit.jsonl',matches)
    write_jsonl(args.out/'quality_issues.jsonl',issues)
    review_queue=sorted((r for r in records if r['popularity'] and r not in eligible),
                        key=lambda r:-r['popularity']['ratings_count_2017'])
    write_jsonl(args.out/'priority_form_review.jsonl',review_queue[:100])
    with (args.out/'catalog_index.csv').open('w',encoding='utf-8-sig',newline='') as f:
        fields=['id','title','authors','eligibility','summary_chars','ratings_count_2017','readiness']
        w=csv.DictWriter(f,fieldnames=fields);w.writeheader()
        for r in records:w.writerow({'id':r['id'],'title':r['title'],'authors':'; '.join(r['authors']),
           'eligibility':r['eligibility']['status'],'summary_chars':len(r['synopsis']['text']),
           'ratings_count_2017':r['popularity']['ratings_count_2017'] if r['popularity'] else '',
           'readiness':'evidence_only'})
    counts={'cmu_records':len(records),'fiction_candidates_with_author_and_200char_summary':len(eligible),
            'safe_title_author_joins':len(matches),'popular_fiction_candidates':len(ranked),
            'eligibility_counts':dict(collections.Counter(r['eligibility']['status'] for r in records)),
            'missing_author':sum(r['quality']['missing_author'] for r in records),
            'missing_date':sum(r['quality']['missing_date'] for r in records),
            'missing_genres':sum(r['quality']['missing_genres'] for r in records),
            'short_synopsis':sum(r['quality']['short_synopsis'] for r in records),
            'goodbooks_records':len(gb),'reviewed_question_matrices':0,
            'input_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [args.raw/'booksummaries.tar.gz',args.raw/'goodbooks_books.csv']}}
    (args.out/'catalog_stats.json').write_text(json.dumps(counts,indent=2),encoding='utf-8')
    print(json.dumps(counts,indent=2))

if __name__=='__main__':main()
