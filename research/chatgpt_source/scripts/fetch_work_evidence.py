"""Cache current Wikipedia work pages by known page IDs; no fuzzy title joins."""
import argparse,json,time,urllib.parse,urllib.request,urllib.error
from pathlib import Path
from datetime import datetime,timezone

def fetch(params):
    url='https://en.wikipedia.org/w/api.php?'+urllib.parse.urlencode({'action':'query','format':'json',**params})
    req=urllib.request.Request(url,headers={'User-Agent':'ThatBook-CatalogPrep/1.1 (educational book metadata research)','Accept':'application/json'})
    with urllib.request.urlopen(req,timeout=45) as response:result=json.load(response)
    if 'error' in result:raise RuntimeError(result['error'])
    if 'continue' in result:raise RuntimeError('Unexpected pagination: preserve this result and resolve before labeling.')
    return result

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--root',type=Path,required=True);args=ap.parse_args();root=args.root
    cache=root/'data/current_work_sources';cache.mkdir(exist_ok=True)
    rows=[json.loads(s) for s in (root/'data/priority_500.jsonl').read_text().splitlines()]
    ids=[r['source_ids']['wikipedia_page_id'] for r in rows]
    for start in range(0,len(ids),40):
        batch=ids[start:start+40];path=cache/f'pages_{start:03d}.json'
        if path.exists():
            old=json.loads(path.read_text())
            if old.get('requested_ids')==batch:print(f'cached {start}-{start+len(batch)-1}',flush=True);continue
        data=fetch({'pageids':'|'.join(map(str,batch)),'prop':'info|pageprops|revisions','inprop':'url',
          'rvprop':'ids|timestamp|content','rvslots':'main'})
        path.write_text(json.dumps({'retrieved_at':datetime.now(timezone.utc).isoformat(),'requested_ids':batch,'response':data},ensure_ascii=False))
        print(f'fetched {start}-{start+len(batch)-1}; pages={len(data.get("query",{}).get("pages",{}))}',flush=True)
        time.sleep(.7)
    path=cache/'little_women_corrected.json'
    if not path.exists():
        data=fetch({'titles':'Little Women','redirects':1,'prop':'info|pageprops|revisions','inprop':'url',
          'rvprop':'ids|timestamp|content','rvslots':'main'})
        path.write_text(json.dumps({'retrieved_at':datetime.now(timezone.utc).isoformat(),'response':data},ensure_ascii=False))
        print('fetched correct Little Women novel source',flush=True)

if __name__=='__main__':main()
