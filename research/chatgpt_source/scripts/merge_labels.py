#!/usr/bin/env python3
"""Merge completion rows into Claude's label file without overwriting its work."""
import argparse, json
from pathlib import Path

def load_books(path):
    files=sorted(path.glob('*.json')) if path.is_dir() else [path]
    result={}
    for file in files:
        data=json.loads(file.read_text(encoding='utf-8'))
        if not isinstance(data,dict) or 'books' not in data:continue
        for row in data['books']:
            bid=row.get('book_id')
            if not isinstance(bid,str):raise ValueError(f'{file}: missing book_id')
            if bid in result and result[bid]!=row:raise ValueError(f'{file}: conflicting duplicate book {bid}; resolve explicitly')
            result[bid]=row
    return result

def merge(existing,incoming):
    merged=dict(existing);added=[];overlap=[]
    for bid,row in incoming.items():
        if bid in merged:overlap.append(bid)
        else:merged[bid]=row;added.append(bid)
    return merged,{'existing_books_preserved':len(existing),'new_rows_added':len(added),
                   'overlapping_rows_preserved':len(overlap),'overlap_ids':overlap}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--existing',type=Path,required=True)
    ap.add_argument('--incoming',type=Path,required=True);ap.add_argument('--out',type=Path,required=True)
    args=ap.parse_args()
    if args.out.resolve() in {args.existing.resolve(),args.incoming.resolve()}:
        ap.error('Choose a new output path; do not overwrite an input file')
    existing=load_books(args.existing);incoming=load_books(args.incoming)
    combined,report=merge(existing,incoming)
    args.out.parent.mkdir(parents=True,exist_ok=True)
    args.out.write_text(json.dumps({'books':list(combined.values())},ensure_ascii=False,indent=2),encoding='utf-8')
    args.out.with_suffix('.merge_report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k!='overlap_ids'}))

if __name__=='__main__':main()
