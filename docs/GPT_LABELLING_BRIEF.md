> **Superseded (15 Nov 2026):** use [`AI_LABELLING_PROMPT.md`](AI_LABELLING_PROMPT.md), one prompt for every AI and teammate,
> merged with `scripts/import_ai_labels.ts`. This brief is kept for the record of how `gpt.txt` was made.

# Brief for a second AI labeller (ChatGPT)

Folio does not learn from games. It gets better when its books have more **firm, distinguishing answers**.
Every book that is not playable yet fails the same way: with too few firm answers, the engine never becomes
confident within 18 questions. A second, independent labeller helps in two ways:

1. **New books**: answers for the 273 books nobody has labelled yet (`new_books.csv`).
2. **Second opinion**: an independent pass over the 219 books Claude labelled (`second_opinion.csv`). Where the
   two AIs agree, the answer is kept; where they disagree, it becomes unknown. Wrong answers hurt more than
   missing ones, so this makes the shelf more accurate.

## What to attach in ChatGPT

From `data/ai_recall/worklists/` (regenerate with `python3 scripts/export_worklists.py`):

- `questions.csv`: the 116 question codes with their exact definitions
- `new_books.csv`: Task 1, in priority order
- `second_opinion.csv`: Task 2

Do **not** attach `data/ai_recall/labels.txt` (Claude's answers): the second opinion must be independent.

## Prompt to paste

```text
You are helping build Bookinator, an Akinator-style game that guesses a novel from Yes/No answers. A local
engine compares the player's answers with a table of facts per book. I need you to fill in that table for
books you know well, from your own knowledge. Accuracy matters more than quantity: a wrong answer makes the
game miss the book, while a missing answer only makes it slower.

ATTACHED
- questions.csv: question codes (01–64, m01–m52) with exact definitions. Follow the definition, not just the
  short question. Code 56 is inactive: never answer it.
- new_books.csv: Task 1, books nobody has labelled. Work in the given priority order.
- second_opinion.csv: Task 2, books someone else labelled. Label them independently, exactly like Task 1.

WHAT TO ANSWER, per book
- Answer only about THIS novel: not the film, not the TV series, not other books in the series.
- Use 4 strengths:
    Y = clearly yes      y = probably yes (partly true, or true only for part of the book)
    N = clearly no       n = probably no
  Leave a question out if you are not sure. Never guess. "Don't know" is always better than a wrong answer.
- Firm NO answers are just as valuable as YES answers. "No dragon", "not set in London", "no vampires" are
  exactly what the game is missing. If you know the book well enough to be sure something is absent, say N.
- Aim for 40–80 answers per book you know well, and cover these first because they tell books apart:
  01–11 (who and where), 13–21 (country, invented world, era), 24–37 (main storylines and premise),
  49–53 (narration and series), and the m-questions (concrete elements: creatures, crimes, places, objects).
- If you only vaguely know a book, give the few answers you are sure of, or skip the book entirely.

TRAPS TO AVOID
- Setting era (17–21) means when the STORY happens, not when the book was published.
- 20 means real-world 2000s or later; an imagined future is 21, not 20.
- 57–59 are about the ORIGINAL language, not the author's nationality.
- 53/54: a book with a published sequel IS part of a series (53=Y); 54 only if it is volume one.
- Central character (01–07) means a main viewpoint or focal character, not a side character.
- m31–m33 mean MUCH of the story is set there, not a passing mention.
- m10 murder: only if someone is deliberately killed in the story. Don't reveal twist endings; if a fact is
  only a late twist, leave it out.
- Don't answer 60–64 (publication date, adaptations, Nobel); those already come from sources.

OUTPUT FORMAT (exactly; plain text, one book per line, nothing else)
book_id | title | tokens
where each token is the question code immediately followed by Y, y, n or N, separated by spaces. Example:
cmu:enwiki:24162 | Pride and Prejudice | 01n 02Y 03Y 13Y 14N 15N 17Y 26Y m01N m02N m20Y m33N

Use the book_id from the CSV unchanged. Each code at most once per line. No commentary inside the lines.

PROCESS
- Do 15 books per reply. Start with Task 1, then Task 2. After each reply I will say "continue".
- Before each reply, re-read your lines once and remove any answer you are less than confident about.
- At the very end, list books you skipped because you don't know them well enough.
```

## Bringing the answers back

Save everything ChatGPT returns, in one file, as **`data/ai_recall/gpt.txt`** (any `*.txt` in that folder is
read as one labeller, named after the file). Then the catalog is rebuilt:

```bash
npm run catalog:research
```

This needs the research packs next to the repo; Claude can run it. What happens on rebuild:

- **New books:** ChatGPT's answers fill unknown cells.
- **Books both AIs labelled:** answers they agree on keep the stronger value; answers they disagree on become unknown.
- **Any AI answer that contradicts a sourced label:** becomes unknown.
- **Reporting:** `data/cmu/coverage_report.json` (`ai_recall`) shows each labeller's agreement with the sourced
  labels and the agreement between the two AIs.

The engine gate then decides which books are playable. Nothing here counts as human review; the site keeps its
"unreviewed data" banner.
