#!/usr/bin/env python3
"""Create provider-neutral, resumable files for Claude or an LLM runner; no API calls."""
import argparse,json
from pathlib import Path

def read_records(path):
    if path.suffix=='.json':
        value=json.loads(path.read_text(encoding='utf-8'))
        return value['books'] if isinstance(value,dict) else value
    return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line.strip()]

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--catalog',type=Path,required=True)
    ap.add_argument('--questions',type=Path,default=Path('questions_64.json'))
    ap.add_argument('--prompt',type=Path,default=Path('MATRIX_LABELING_PROMPT.txt'))
    ap.add_argument('--out',type=Path,default=Path('jobs'));ap.add_argument('--batch-size',type=int,default=5)
    ap.add_argument('--limit',type=int,default=100)
    args=ap.parse_args()
    if args.batch_size<1 or args.limit<1:ap.error('batch-size and limit must be positive')
    rows=read_records(args.catalog)[:args.limit]
    questions=json.loads(args.questions.read_text(encoding='utf-8'))
    prompt=args.prompt.read_text(encoding='utf-8');args.out.mkdir(parents=True,exist_ok=True)
    with (args.out/'manifest.jsonl').open('w',encoding='utf-8') as manifest:
        for start in range(0,len(rows),args.batch_size):
            books=rows[start:start+args.batch_size]
            # Full evidence retained. A reader must not silently interpret truncated plots as No.
            payload={'job_id':f'books-{start:05d}-{start+len(books)-1:05d}',
                     'system_instruction':prompt,'question_definitions':questions,
                     'books':books,'output_contract':'matrix_response_schema.json'}
            name=payload['job_id']+'.json'
            (args.out/name).write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
            manifest.write(json.dumps({'job_id':payload['job_id'],'file':name,'book_ids':[b['id'] for b in books]})+'\n')
    print(json.dumps({'books':len(rows),'jobs':(len(rows)+args.batch_size-1)//args.batch_size,
                      'approx_input_characters':sum(len(b['synopsis']['text']) for b in rows),
                      'note':'No model calls made; no matrix generated.'}))

if __name__=='__main__':main()
