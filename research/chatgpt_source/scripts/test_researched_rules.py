"""Regression tests for source identity and safe logical derivations."""
import unittest
from research_enrichment import same_person_name,setting_features,year_values
from apply_current_decisions import derive_era_negatives

def era_cells(**overrides):
    return {f'q{i:02d}':{'p_yes':overrides.get(f'q{i:02d}',.5)} for i in range(17,22)}

class ResearchRulesTests(unittest.TestCase):
    def test_nobel_middle_initial_resolves_full_middle_name(self):
        self.assertTrue(same_person_name('Pearl S. Buck','Pearl Sydenstricker Buck'))
    def test_shared_surname_does_not_match_different_author(self):
        self.assertFalse(same_person_name('E. B. White','Patrick White'))
        self.assertFalse(same_person_name('Lane Smith','Jon Scieszka'))
    def test_explicit_setting_has_geographic_mapping(self):
        self.assertEqual(setting_features('London, England'),{'q13':.7,'q10':.7,'q15':.3})
    def test_secondary_world_with_earth_locations_not_forced_to_earth(self):
        self.assertNotIn('q15',setting_features('England and Narnia'))
        self.assertEqual(setting_features('Middle-earth'),{})
    def test_missing_setting_does_not_infer_geography(self):
        self.assertEqual(setting_features(''),{})
        self.assertEqual(setting_features('Giant Country'),{})
    def test_future_not_disjoint_from_historical_calendar(self):
        updates=derive_era_negatives(era_cells(q21=.7))
        self.assertEqual(updates,[('q20','q21')])
    def test_majority_calendar_eras_are_mutually_exclusive(self):
        self.assertEqual(derive_era_negatives(era_cells(q18=.7)),[('q17','q18'),('q19','q18'),('q20','q18')])
    def test_conflicting_positive_eras_cannot_generate_more_negatives(self):
        self.assertEqual(derive_era_negatives(era_cells(q18=.7,q19=.7)),[])
    def test_derivation_never_overwrites_supported_answers(self):
        self.assertEqual(derive_era_negatives(era_cells(q18=.7,q17=.3,q19=.3,q20=.3)),[])
    def test_multiple_publication_dates_preserve_ambiguity(self):
        self.assertEqual(year_values('1890 (serial); 1891 (book)'),[1890,1891])
        self.assertEqual(year_values('September 3, 1947'),[1947])

if __name__=='__main__':unittest.main()
