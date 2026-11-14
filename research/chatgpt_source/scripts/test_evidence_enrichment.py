"""Regression checks for source boundaries and evidence-sensitive enrichment."""
import copy,json,subprocess,sys,tempfile,unittest
from pathlib import Path
from validate_evidence_matrix import validate

SCRIPT=Path(__file__).with_name('enrich_bibliography.py')
QUESTIONS=[{'id':f'q{i:02d}'} for i in range(1,65)]

def blank(bid):
    return {'book_id':bid,'answers':[{'question_id':q['id'],'p_yes':.5,
      'status':'insufficient_evidence','source_id':None,'evidence_quote':None,
      'premise_safe':False,'reviewed':False} for q in QUESTIONS]}

class EvidenceEnrichmentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory();cls.root=Path(cls.temp.name)
        (cls.root/'data').mkdir();(cls.root/'reports').mkdir()
        rows=[];raw=[]
        for i,(title,year) in enumerate([('One (Named Saga, #1)','1880.0'),
          ('Two (Named Saga, #2)','2001.0'),('Omnibus (Saga, #1-3)','1999.0'),
          ('Standalone','not-known'),('Prequel (Saga, #0.5)','1990.0')],1):
            rows.append({'id':f'b{i}','title':title,'source_ids':{'goodbooks_id':i},
              'synopsis':{'text':'The story takes place in 1950.','source_id':f'cmu:{i}'},
              'sources':[{'id':f'cmu:{i}'},{'id':f'goodbooks:{i}'}]})
            raw.append({'book_id':str(i),'work_id':str(10+i),'title':title,
              'authors':'Example Author','original_publication_year':year,'language_code':'eng'})
        (cls.root/'data/priority_500.jsonl').write_text('\n'.join(json.dumps(x) for x in rows))
        (cls.root/'data/core500_draft_labels.json').write_text(json.dumps({'books':[blank(r['id']) for r in rows]}))
        source=cls.root/'source.jsonl';source.write_text('\n'.join(json.dumps(x) for x in raw))
        subprocess.run([sys.executable,str(SCRIPT),'--root',str(cls.root),'--goodbooks',str(source)],check=True,capture_output=True)
        cls.payload=json.loads((cls.root/'data/core500_labels_with_metadata.json').read_text())
        cls.catalog={r['id']:r for r in [json.loads(s) for s in (cls.root/'data/priority_500_enriched.jsonl').read_text().splitlines()]}
    @classmethod
    def tearDownClass(cls):cls.temp.cleanup()
    def cell(self,bid,q):return next(c for b in self.payload['books'] if b['book_id']==bid for c in b['answers'] if c['question_id']==q)
    def test_first_and_later_volume_are_distinct(self):
        self.assertEqual(self.cell('b1','q54')['p_yes'],.7)
        self.assertEqual(self.cell('b2','q54')['p_yes'],.3)
        self.assertEqual(self.cell('b2','q53')['source_id'],'goodbooks:2')
    def test_omnibus_and_fractional_prequel_not_forced_into_volume_one(self):
        self.assertEqual(self.cell('b3','q54')['p_yes'],.5)
        self.assertEqual(self.cell('b5','q54')['p_yes'],.5)
        self.assertEqual(self.cell('b5','q53')['p_yes'],.7)
    def test_unverified_years_are_pending_not_supported(self):
        self.assertEqual(self.cell('b1','q60')['p_yes'],.5)
        self.assertEqual(self.cell('b2','q61')['p_yes'],.5)
        pending=json.loads((self.root/'data/pending_publication_year_claims.json').read_text())
        self.assertEqual(len(pending),8)
        self.assertTrue(all(p['verification_status']=='needs_independent_first_publication_check' for p in pending))
    def test_publication_year_and_edition_language_never_become_story_features(self):
        for q in ['q17','q18','q19','q20','q57','q58','q59']:
            self.assertEqual(self.cell('b2',q)['p_yes'],.5)
    def test_valid_metadata_quotes_and_registered_sources_pass(self):
        self.assertTrue(validate(self.payload,self.catalog,QUESTIONS)['valid'])
    def test_quote_from_another_book_fails(self):
        payload=copy.deepcopy(self.payload);payload['books'][0]['answers'][52]['evidence_quote']='title: Two (Named Saga, #2)'
        self.assertFalse(validate(payload,self.catalog,QUESTIONS)['valid'])
    def test_unregistered_source_and_false_review_fail(self):
        payload=copy.deepcopy(self.payload);c=payload['books'][0]['answers'][52]
        c['source_id']='unregistered';c['reviewed']=True
        self.assertFalse(validate(payload,self.catalog,QUESTIONS)['valid'])
    def test_duplicate_book_and_question_fail(self):
        payload=copy.deepcopy(self.payload);payload['books'].append(copy.deepcopy(payload['books'][0]))
        self.assertFalse(validate(payload,self.catalog,QUESTIONS)['valid'])
        payload=copy.deepcopy(self.payload);payload['books'][0]['answers'][1]=copy.deepcopy(payload['books'][0]['answers'][0])
        self.assertFalse(validate(payload,self.catalog,QUESTIONS)['valid'])
    def test_known_or_evidenced_unknown_is_rejected(self):
        payload=copy.deepcopy(self.payload);payload['books'][0]['answers'][0]['evidence_quote']='Invented quote'
        self.assertFalse(validate(payload,self.catalog,QUESTIONS)['valid'])

if __name__=='__main__':unittest.main()
