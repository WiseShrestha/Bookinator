import copy, unittest
from build_catalog import classify, isbn13, norm, title_keys
from validate_matrix import validate

class CatalogTests(unittest.TestCase):
    def test_author_normalization(self):
        self.assertEqual(norm('J. R. R. Tolkien'),norm('J.R.R. Tolkien'))
        self.assertEqual(norm('García Márquez'),norm('Garcia Marquez'))
    def test_series_normalization_retains_subtitle(self):
        self.assertIn(norm('The Hunger Games'),title_keys('The Hunger Games (The Hunger Games, #1)'))
        self.assertNotIn(norm('Dune'),title_keys('Dune Messiah'))
    def test_isbn_rejects_rounded_scientific_notation(self):
        self.assertEqual(isbn13('9780306406157'),'9780306406157')
        self.assertIsNone(isbn13('9.78030640616e+12'))
        self.assertIsNone(isbn13('9780306406158'))
    def test_conflicting_genres_are_not_auto_accepted(self):
        self.assertEqual(classify(['Novel','Biography'])[0],'review_conflicting_form')
        self.assertEqual(classify(['Biography'])[0],'excluded_form_or_nonfiction')
        self.assertEqual(classify([])[0],'needs_form_review')
    def fixtures(self):
        book={'id':'b1','synopsis':{'text':'A school is the setting.','source_id':'s1'}}
        cell={'question_id':'q01','p_yes':.9,'status':'supported','source_id':'s1',
              'evidence_quote':'A school is the setting.','premise_safe':True,'reviewed':False}
        return {'books':[{'book_id':'b1','answers':[cell]}]},{'b1':book},[{'id':'q01'}]
    def test_quote_validation(self):
        m,c,q=self.fixtures();self.assertTrue(validate(m,c,q)['valid'])
        m['books'][0]['answers'][0]['evidence_quote']='Invented statement'
        self.assertFalse(validate(m,c,q)['valid'])
    def test_unknown_requires_null_evidence(self):
        m,c,q=self.fixtures();m['books'][0]['answers'][0]['p_yes']=.5
        self.assertFalse(validate(m,c,q)['valid'])
    def test_missing_and_duplicate_questions(self):
        m,c,q=self.fixtures();m['books'][0]['answers']*=2
        self.assertFalse(validate(m,c,q)['valid'])
        m['books'][0]['answers']=[]
        self.assertFalse(validate(m,c,q)['valid'])
    def test_review_and_coverage_gates(self):
        m,c,q=self.fixtures();self.assertFalse(validate(m,c,q,True)['valid'])
        self.assertFalse(validate(m,c,q,min_supported=2)['valid'])

if __name__=='__main__':unittest.main()
