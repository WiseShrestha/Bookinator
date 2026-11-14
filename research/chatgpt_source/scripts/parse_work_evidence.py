"""Make auditable infobox fields and plaintext from cached work-page revisions."""
import argparse,json,re,html
from pathlib import Path
import mwparserfromhell

def plain(value):
    value=re.sub(r'<br\s*/?>','; ',value,flags=re.I)
    code=mwparserfromhell.parse(value)
    for tag in code.filter_tags(recursive=True):
        if str(tag.tag).strip().lower() in {'ref','gallery','math','timeline','score'}:
            try:code.remove(tag)
            except ValueError:pass
    # Keep list/date template values, rather than silently dropping them.
    text=code.strip_code(normalize=True,collapse=True,keep_template_params=True)
    return re.sub(r'[ \t]+',' ',html.unescape(text)).strip()

def parse_page(page,retrieved):
    revisions=page.get('revisions',[])
    if not revisions:return None
    rev=revisions[0];raw=rev.get('slots',{}).get('main',{}).get('*','')
    if not raw:return None
    code=mwparserfromhell.parse(raw);boxes=[]
    for t in code.filter_templates(recursive=False):
        name=str(t.name).strip().lower().replace('_',' ')
        if name.startswith('infobox'):
            fields={str(p.name).strip().lower():{'raw':str(p.value).strip(),'text':plain(str(p.value))} for p in t.params}
            boxes.append({'template':name,'fields':fields})
    # Remove infoboxes and lead-side metadata from narrative text.
    for t in list(code.filter_templates(recursive=False)):
        try:code.remove(t)
        except ValueError:pass
    text=plain(str(code));lead=re.split(r'\n\s*[^\n]+\n',text,maxsplit=1)[0]
    lead_code=mwparserfromhell.parse(raw).get_sections(include_lead=True,flat=True)[0]
    for t in list(lead_code.filter_templates(recursive=False)):
        try:lead_code.remove(t)
        except ValueError:pass
    lead_text=plain(str(lead_code))
    # Headings retained separately by the parser for metadata/plot review panels.
    sections=[]
    for section in mwparserfromhell.parse(raw).get_sections(include_lead=True,flat=True):
        heading=section.filter_headings()
        sections.append({'heading':plain(str(heading[0].title)) if heading else 'lead','text':plain(str(section))})
    field_lines=[]
    if boxes:
        for key,val in boxes[0]['fields'].items():
            if key in {'name','title','author','language','language_code','orig_lang_code','publication_date','pub_date','published','release_date','series','release_number','genre','set_in','preceded_by','followed_by','country','translator'}:
                field_lines.append(key+': '+val['text'])
    sid=f'enwiki:{page["pageid"]}:{rev["revid"]}'
    evidence='Article title: '+page['title']+'\n'+'\n'.join(field_lines)+'\n\n'+text
    return {'page_id':page['pageid'],'title':page['title'],'qid':page.get('pageprops',{}).get('wikibase_item'),
      'source_id':sid,'revision_id':rev['revid'],'revision_timestamp':rev.get('timestamp'),
      'retrieved_at':retrieved,'url':page.get('fullurl','https://en.wikipedia.org/?curid='+str(page['pageid'])),
      'revision_url':'https://en.wikipedia.org/w/index.php?oldid='+str(rev['revid']),
      'infoboxes':boxes,'sections':sections,'lead_text':lead_text,'evidence_text':evidence}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--root',type=Path,required=True);root=ap.parse_args().root
    sources={};corrected=None;overrides={}
    for path in sorted((root/'data/current_work_sources').glob('*.json')):
        d=json.loads(path.read_text())
        for page in d.get('response',{}).get('query',{}).get('pages',{}).values():
            out=parse_page(page,d['retrieved_at'])
            if out:
                sources[out['page_id']]=out
                if path.name=='little_women_corrected.json':corrected=out['page_id']
                if path.name=='silence_corrected.json':overrides['Silence']=out['page_id']
    result={'pages':sources,'corrected_little_women_page_id':corrected,'corrected_page_overrides':overrides,
      'transform':'mwparserfromhell 0.7.2: strip wiki markup, remove references/media, retain template values; explicit infobox fields rendered as name: value lines.'}
    (root/'data/current_work_evidence.json').write_text(json.dumps(result,ensure_ascii=False))
    rows=[json.loads(s) for s in (root/'data/priority_500.jsonl').read_text().splitlines()]
    out=[]
    for i,r in enumerate(rows):
        page=sources.get(corrected if r['title']=='Little Women' else r['source_ids']['wikipedia_page_id'])
        if not page:out.append({'index':i,'title':r['title'],'missing':True});continue
        boxes=page['infoboxes'];fields=boxes[0]['fields'] if boxes else {}
        out.append({'index':i,'title':r['title'],'page_title':page['title'],'page_id':page['page_id'],
          'template':boxes[0]['template'] if boxes else None,
          **{k:fields.get(k,{}).get('text') for k in ['author','language','language_code','publication_date','pub_date','published','series','genre','translator']}})
    (root/'reports/current_metadata_inventory.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
    print(json.dumps({'pages':len(sources),'target_records':len(rows),'with_language':sum(bool(x.get('language')) for x in out),'with_pub_date':sum(bool(x.get('pub_date') or x.get('published')) for x in out)}))

if __name__=='__main__':main()
