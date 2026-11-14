# Data attribution and reuse notes

This package reorganizes source data and adds identifiers, quality flags, join audits, and priority subsets. It does not claim to have verified every book fact. The supplied code and dataset text have different provenance; do not apply a code license to the imported text.

## CMU Book Summary Corpus

David Bamman and Noah Smith (2013), *New Alignment Methods for Discriminative Book Summarization*, and Wikipedia contributors.

- Provider: https://www.cs.cmu.edu/~dbamman/booksummaries.html
- Original download: https://www.cs.cmu.edu/~dbamman/data/booksummaries.tar.gz
- Provider-linked license: https://creativecommons.org/licenses/by-sa/3.0/us/legalcode
- Original README is included in `licenses/CMU_ORIGINAL_README.txt`.
- The README dates the Wikipedia source dump to **2 November 2012**.
- Each record preserves the original Wikipedia article ID and an article link. The original per-article revision IDs are not available in this dataset and have not been invented.
- Changes here: TSV-to-JSON conversion, whitespace trimming, quality/form flags, IDs, bibliographic matching, and selection. Plot text was not rewritten.

Preserve this attribution, source and license links, and the share-alike notice with redistributed source or adapted text. A book's own copyright status is separate from the license on a Wikipedia-derived summary.

## goodbooks-10k metadata

Zygmunt Zając, *goodbooks-10k* (2017).

- Repository: https://github.com/zygmuntz/goodbooks-10k
- License file: https://raw.githubusercontent.com/zygmuntz/goodbooks-10k/master/LICENSE
- Declared license: https://creativecommons.org/licenses/by-sa/4.0/
- Original license notice is included in `licenses/goodbooks_LICENSE.txt`.
- Changes here: conservative title/author joins, historical popularity ranking, and ISBN validation. User interaction and review datasets were not included.

The publisher's edition/contributor strings and old rating counts are not independently verified facts. Cover-image rights are not established by the metadata license; cover files are not included.

## Wikipedia supplement text and Wikidata labels

- Text attribution: Wikipedia contributors, per-record article/revision/history links.
- Text license information: https://en.wikipedia.org/wiki/Wikipedia:Copyrights
- License: https://creativecommons.org/licenses/by-sa/4.0/
- Changes: plain-text introduction and plot-related sections extracted; unrelated sections omitted. Some records have no retrieved text and are labeled metadata-only.
- Wikidata structured-data license: CC0, https://www.wikidata.org/wiki/Wikidata:Licensing

Do not extend the Wikipedia text license to cover images or quoted third-party material automatically. Do not treat Wikipedia text as CC0 merely because a record also contains a Wikidata identifier.

## Optional Best Books Ever pack — separate noncommercial source

Lorena Casanova Lozano and Sergio Costa Planells (2020), *Best Books Ever Dataset*, version 1.0.0, DOI:10.5281/zenodo.4265096.

- Deposit: https://zenodo.org/records/4265096
- Authoritative machine-readable deposit metadata: https://zenodo.org/api/records/4265096
- Declared license in `metadata.license.id`: `cc-by-nc-4.0`
- License: https://creativecommons.org/licenses/by-nc/4.0/
- Changes in the optional pack: CSV-to-JSONL conversion, safe list parsing, eligibility heuristics, ID disambiguation, and priority selection.

This source is kept in a separate archive. Its deposit license does not independently establish the rights to every scraped publisher blurb or cover. Cover files are not included. Do not represent the source as unrestricted for commercial use, or erase its source boundary when joining records.

## UI credits suggestion

“Book evidence: CMU Book Summary Corpus / Wikipedia contributors; metadata: goodbooks-10k / Wikidata. Source and license details.” Link this to your credits page and preserve record-level provenance. Add the Best Books Ever attribution and noncommercial notice if you actually use that source.
