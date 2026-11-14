"""Cache structured work-entity claims using exact current page-to-item mappings."""
import argparse,json,time,urllib.request,urllib.parse
from pathlib import Path
from datetime import datetime,timezone

def main():
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);root=p.parse_args().root
    sources=json.loads((root/'data/current_work_evidence.json').read_text())['pages']
    qids=sorted({x['qid'] for x in sources.values() if x.get('qid')})
    cache=root/'data/current_work_sources';entities={}
    for i in range(0,len(qids),40):
        batch=qids[i:i+40];path=cache/f'entities_{i:03d}.json'
        if path.exists():
            data=json.loads(path.read_text())
            if data.get('requested_ids')!=batch:raise RuntimeError('Changed source mapping; use a fresh cache path.')
        else:
            url='https://www.wikidata.org/w/api.php?'+urllib.parse.urlencode({'action':'wbgetentities','format':'json',
              'ids':'|'.join(batch),'props':'labels|claims','languages':'en|ko'})
            req=urllib.request.Request(url,headers={'User-Agent':'ThatBook-CatalogPrep/1.1 (educational book metadata research)','Accept':'application/json'})
            with urllib.request.urlopen(req,timeout=45) as response:result=json.load(response)
            if 'error' in result:raise RuntimeError(result['error'])
            data={'retrieved_at':datetime.now(timezone.utc).isoformat(),'requested_ids':batch,'response':result}
            path.write_text(json.dumps(data,ensure_ascii=False))
            time.sleep(.7)
        entities.update(data['response'].get('entities',{}));print(f'entities {i}-{i+len(batch)-1}',flush=True)
    (root/'data/current_work_entities.json').write_text(json.dumps(entities,ensure_ascii=False))
    print(f'Cached {len(entities)} exact work entities',flush=True)

if __name__=='__main__':main()
