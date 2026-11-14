import copy,json,sys,tempfile,unittest
from pathlib import Path
from label_catalog import label_record,sentence_at
from merge_labels import merge,load_books

def book(text):
    return {'id':'b1','title':'Test','synopsis':{'text':text,'source_id':'s1'}}

class CompletionTests(unittest.TestCase):
    def test_quote_keeps_first_character(self):
        text='The story takes place in London.'
        self.assertEqual(sentence_at(text,0,3),text)
    def test_long_quote_is_exact(self):
        text='A'*300+' magic school '+'B'*300
        result=sentence_at(text,301,313)
        self.assertLessEqual(len(result),220);self.assertIn(result,text)
    def test_exact_64_unique_questions(self):
        row,_,_=label_record(book('No relevant evidence is available.'))
        self.assertEqual(len(row['answers']),64)
        self.assertEqual(len({c['question_id'] for c in row['answers']}),64)
    def test_no_absence_as_no(self):
        row,_,_=label_record(book('There is no useful information about the main story.'))
        self.assertTrue(all(c['p_yes']==.5 for c in row['answers']))
    def test_narration_is_not_inferred_from_summary_voice(self):
        row,_,_=label_record(book('She lives in a city and walks home.'))
        self.assertEqual(row['answers'][48]['p_yes'],.5)
    def test_no_language_inference(self):
        row,_,_=label_record(book('The story takes place in London and concerns a British family.'))
        self.assertTrue(all(row['answers'][q-1]['p_yes']==.5 for q in [57,58,59]))
    def test_gender_cue_is_only_a_candidate(self):
        row,_,candidates=label_record(book('His father appears briefly before the main story.'))
        self.assertEqual(row['answers'][2]['p_yes'],.5)
        self.assertTrue(any(c['question_id']=='q03' for c in candidates))
    def test_publication_date_is_not_extracted_as_setting(self):
        row,_,_=label_record(book('Published in 1922, this novel describes an unspecified setting.'))
        self.assertTrue(all(row['answers'][q-1]['p_yes']==.5 for q in [17,18,19,20]))
    def test_supported_cells_have_exact_source_quotes(self):
        record=book('The story is set in London. It involves time travel and a magical school for wizards.')
        row,_,_=label_record(record)
        for c in row['answers']:
            if c['p_yes']!=.5:
                self.assertIn(c['evidence_quote'],record['synopsis']['text'])
                self.assertEqual(c['source_id'],'s1');self.assertFalse(c['reviewed'])
    def test_merge_preserves_existing_rows_exactly(self):
        old={'x':{'book_id':'x','answers':[{'reviewed':True}]}}
        new={'x':{'book_id':'x','answers':[{'reviewed':False}]},'y':{'book_id':'y','answers':[]}}
        merged,report=merge(old,new)
        self.assertEqual(merged['x'],old['x']);self.assertEqual(report['new_rows_added'],1)
    def test_merge_is_idempotent(self):
        old={'x':{'book_id':'x','answers':[]}};new={'y':{'book_id':'y','answers':[]}}
        first,_=merge(old,new);second,report=merge(first,new)
        self.assertEqual(first,second);self.assertEqual(report['new_rows_added'],0)
    def test_conflicting_duplicate_input_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'a.json'
            path.write_text(json.dumps({'books':[{'book_id':'x','answers':[]},{'book_id':'x','answers':[1]}]}))
            with self.assertRaises(ValueError):load_books(path)

if __name__=='__main__':unittest.main()
