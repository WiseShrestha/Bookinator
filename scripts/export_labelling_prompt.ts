// Writes docs/AI_LABELLING_PROMPT.md: ONE prompt every teammate pastes into their AI (ChatGPT, Gemini, Claude…)
// so that all label files come back in the same format and can be merged by scripts/import_ai_labels.ts.
// The question list is generated from the shipped research catalog, so it never drifts from the engine.
//
//   npx tsx scripts/export_labelling_prompt.ts

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Catalog } from "../src/engine/model.ts";
import cmu from "../src/data/cmu.catalog.json";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = cmu as unknown as Catalog;
/** Answered from sources (publication date, adaptations, Nobel), not by an AI. */
const SOURCED_ONLY = new Set(["q60", "q61", "q62", "q63", "q64"]);
const code = (id: string) => id.replace(/^q/, "");

const questions = catalog.questions
  .filter((q) => q.active !== false && !SOURCED_ONLY.has(q.id))
  .map((q) => `${code(q.id)} | ${q.text} | ${q.definition}`)
  .join("\n");

const prompt = `You are a careful data labeller for Bookinator, an Akinator-style game that finds a NOVEL from the player's
Yes/No answers. A local engine compares the player's answers with a table of facts per book. Fill in that table
for the books listed at the end, from your own knowledge of each NOVEL. Accuracy matters more than quantity:
a wrong answer makes the game miss the book; a missing answer only makes it slower.

ANSWER CODES (exactly one letter after each question code)
  Y = clearly yes      y = probably yes (partly true, or true for only part of the book)
  N = clearly no       n = probably no
  Leave a question OUT when you are not sure. Never guess. Leaving it out is always better than a wrong answer.

RULES
1. Answer about THIS novel only: not the film or TV version, not other books in the series.
2. Follow the DEFINITION of each question, not just its short text.
3. Firm NO answers are as valuable as YES answers ("no dragon", "not set in London"). Say N only when you know
   the book well enough to be sure the thing is absent.
4. For a book you know well, aim for 40–90 answers. For a book you only vaguely know, give the few answers you
   are sure of, or skip the book and list it under SKIPPED.
5. Cover these first, they tell books apart: 01–11 (who), 10–21 (where and when), 22–39 (story and premise),
   49–53 (narration, series) and the m-questions (concrete things in the story).
6. Do not reveal twist endings: if something is only a late twist, leave it out.

TRAPS
- 17–21 are about when the STORY happens, not when the book was published. An imagined future is 21, not 20.
- 57–59 are about the ORIGINAL language, not the author's nationality.
- 53 = Y if the book has a published sequel or prequel; 54 = Y only for volume one.
- 01–07 "central" = a main viewpoint or focal character, not a side character.
- m31–m33 = MUCH of the story is set there, not a passing mention. m10 = someone is deliberately killed.
- Codes 56 and 60–64 are not used here: never answer them.

OUTPUT FORMAT — exactly one line per book, plain text, nothing else on the line:
id | title | author | first published year | original language | answers
- id: copy it from my list if I gave one (e.g. cmu:enwiki:24162), otherwise write -
- title: the best-known ENGLISH title of the novel (add the original title in parentheses if it differs)
- author: full name as usually written in English
- first published year: four digits, or - if unsure
- original language: two-letter code (en, ko, ja, fr, de, es, ru, it, zh …), or - if unsure
- answers: question code immediately followed by Y, y, n or N, separated by single spaces, each code at most once
Example:
cmu:enwiki:24162 | Pride and Prejudice | Jane Austen | 1813 | en | 01n 02Y 03Y 13Y 14N 15N 17Y 26Y m01N m02N m20Y m33N
- | The Vegetarian (채식주의자) | Han Kang | 2007 | ko | 02Y 03Y 12Y 14N 15N 19N 20Y 29Y 39Y 46Y 57Y 58N m01N m30Y

After the book lines, write one line:  SKIPPED | title; title; …  (books you do not know well enough).

PROCESS
- Do 10–15 books per reply, in my order. I will say "continue".
- Before each reply, re-read your lines and delete any answer you are less than confident about.

QUESTIONS (code | question | definition)
${questions}

BOOKS TO LABEL
<paste the book list here: one per line, "id | title | author" if you have ids, otherwise just "title | author">`;

const doc = `# 통합 AI 라벨링 프롬프트 (팀원용)

> 이 파일은 \`npx tsx scripts/export_labelling_prompt.ts\`로 생성됩니다. 질문 목록은 게임 엔진이 쓰는 연구용
> 카탈로그(\`${catalog.catalog_version}\`)에서 그대로 가져오므로, 질문이 바뀌면 이 명령을 다시 실행하세요.

## 왜 필요한가
팀원마다 다른 AI·다른 형식·다른 질문 번호로 라벨을 만들면 합칠 때 번호가 어긋나고(예: Gemini 파일의 q03은 우리
질문 은행의 q05였습니다) 같은 책이 여러 번 들어갑니다. 아래 프롬프트 **하나**만 쓰면 모든 결과가 같은 형식으로
돌아오고, \`scripts/import_ai_labels.ts\`가 검증·중복 제거·병합을 자동으로 합니다.

## 사용 순서
1. 아래 "붙여 넣을 프롬프트" 블록 전체를 AI 대화창에 붙여 넣습니다. (ChatGPT, Gemini, Claude 모두 가능)
2. 맨 끝 \`BOOKS TO LABEL\` 아래에 책 목록을 넣습니다.
   - **기존 후보 책**: \`data/ai_recall/worklists/new_books.csv\`에서 \`id | title | author\` 형태로 복사 (id가 있으면 중복 판정이 정확해집니다)
   - **새 책**: \`제목 | 작가\`만 적으면 됩니다. id는 AI가 \`-\`로 둡니다.
3. AI가 10–15권씩 답하면 "continue"로 이어 갑니다. 답변 전체를 텍스트 파일 하나에 그대로 붙여 넣어 저장합니다
   (예: \`labels_영찬.txt\`). 설명 문장이 섞여도 괜찮습니다. 형식에 맞는 줄만 읽습니다.
4. 저장소에서 검사·병합합니다. \`--name\`은 사람 이름이 아니라 **사용한 AI 이름**으로 해 주세요
   (같은 AI 결과끼리 합쳐야 서로 다른 AI 간의 교차 검증이 의미가 있습니다).
   \`\`\`bash
   npx tsx scripts/import_ai_labels.ts --name gpt   labels_영찬.txt labels_민수.txt
   npx tsx scripts/import_ai_labels.ts --name gemini labels_지은.txt
   \`\`\`
5. 담당자가 카탈로그에 반영합니다 (버전은 매번 올립니다. Supabase에 같은 버전을 다시 올릴 수 없습니다):
   \`\`\`bash
   npx tsx scripts/apply_ai_recall.ts --version cmu-priority500-v3
   npx tsx scripts/gate_catalog.ts
   npm run verify
   npm run community -- sync --catalog src/data/cmu.catalog.json
   \`\`\`

## 병합 규칙 (\`import_ai_labels.ts\`)
- **형식 검사**: 줄마다 질문 코드·답 글자·중복 코드를 검사하고, 틀린 줄은 번호와 함께 알려 주고 건너뜁니다.
- **같은 책 판정**: id가 있으면 id로, 없으면 정규화한 제목(별칭 포함) + 작가 성으로 연구용 후보 500권·두 서가의 책과 대조합니다.
- **같은 AI 안에서 중복**: 같은 책이 여러 번 나오면 합치되, 같은 질문에 **방향이 다른 답**(Y/y vs N/n)은 버립니다.
  방향이 같으면 강한 쪽(Y, N)을 남깁니다.
- **다른 AI와의 관계**: 파일은 AI별로 따로 저장되고(\`data/ai_recall/<name>.txt\`), 반영할 때 AI끼리 엇갈리는 칸은
  '모름', 출처 있는 라벨과 엇갈리는 칸도 '모름'이 됩니다. 사람이 검토한 라벨은 아닙니다.
- **후보 500권 밖의 새 책**: 지금 빌드에는 들어가지 않고 \`data/ai_recall/extra/<name>_new_books.json\`에 메타데이터와 함께
  모아 둡니다. 여러 팀원이 같은 새 책을 넣었으면 하나로 합쳐집니다. 게임에 넣으려면 후보 목록을 넓히는 작업이 따로 필요합니다.

## 붙여 넣을 프롬프트

\`\`\`text
${prompt}
\`\`\`
`;

writeFileSync(resolve(ROOT, "docs/AI_LABELLING_PROMPT.md"), doc);
console.log(`docs/AI_LABELLING_PROMPT.md written (${catalog.questions.length} questions in the bank, ${questions.split("\n").length} in the prompt)`);
