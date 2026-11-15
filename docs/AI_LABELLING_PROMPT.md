# 통합 AI 라벨링 프롬프트 (팀원용)

> 이 파일은 `npx tsx scripts/export_labelling_prompt.ts`로 생성됩니다. 질문 목록은 게임 엔진이 쓰는 연구용
> 카탈로그(`cmu-priority500-v2`)에서 그대로 가져오므로, 질문이 바뀌면 이 명령을 다시 실행하세요.

## 왜 필요한가
팀원마다 다른 AI·다른 형식·다른 질문 번호로 라벨을 만들면 합칠 때 번호가 어긋나고(예: Gemini 파일의 q03은 우리
질문 은행의 q05였습니다) 같은 책이 여러 번 들어갑니다. 아래 프롬프트 **하나**만 쓰면 모든 결과가 같은 형식으로
돌아오고, `scripts/import_ai_labels.ts`가 검증·중복 제거·병합을 자동으로 합니다.

## 사용 순서
1. 아래 "붙여 넣을 프롬프트" 블록 전체를 AI 대화창에 붙여 넣습니다. (ChatGPT, Gemini, Claude 모두 가능)
2. 맨 끝 `BOOKS TO LABEL` 아래에 책 목록을 넣습니다.
   - **기존 후보 책**: `data/ai_recall/worklists/new_books.csv`에서 `id | title | author` 형태로 복사 (id가 있으면 중복 판정이 정확해집니다)
   - **새 책**: `제목 | 작가`만 적으면 됩니다. id는 AI가 `-`로 둡니다.
3. AI가 10–15권씩 답하면 "continue"로 이어 갑니다. 답변 전체를 텍스트 파일 하나에 그대로 붙여 넣어 저장합니다
   (예: `labels_영찬.txt`). 설명 문장이 섞여도 괜찮습니다. 형식에 맞는 줄만 읽습니다.
4. 저장소에서 검사·병합합니다. `--name`은 사람 이름이 아니라 **사용한 AI 이름**으로 해 주세요
   (같은 AI 결과끼리 합쳐야 서로 다른 AI 간의 교차 검증이 의미가 있습니다).
   ```bash
   npx tsx scripts/import_ai_labels.ts --name gpt   labels_영찬.txt labels_민수.txt
   npx tsx scripts/import_ai_labels.ts --name gemini labels_지은.txt
   ```
5. 담당자가 카탈로그에 반영합니다 (버전은 매번 올립니다. Supabase에 같은 버전을 다시 올릴 수 없습니다):
   ```bash
   npx tsx scripts/apply_ai_recall.ts --version cmu-priority500-v3
   npx tsx scripts/gate_catalog.ts
   npm run verify
   npm run community -- sync --catalog src/data/cmu.catalog.json
   ```

## 병합 규칙 (`import_ai_labels.ts`)
- **형식 검사**: 줄마다 질문 코드·답 글자·중복 코드를 검사하고, 틀린 줄은 번호와 함께 알려 주고 건너뜁니다.
- **같은 책 판정**: id가 있으면 id로, 없으면 정규화한 제목(별칭 포함) + 작가 성으로 연구용 후보 500권·두 서가의 책과 대조합니다.
- **같은 AI 안에서 중복**: 같은 책이 여러 번 나오면 합치되, 같은 질문에 **방향이 다른 답**(Y/y vs N/n)은 버립니다.
  방향이 같으면 강한 쪽(Y, N)을 남깁니다.
- **다른 AI와의 관계**: 파일은 AI별로 따로 저장되고(`data/ai_recall/<name>.txt`), 반영할 때 AI끼리 엇갈리는 칸은
  '모름', 출처 있는 라벨과 엇갈리는 칸도 '모름'이 됩니다. 사람이 검토한 라벨은 아닙니다.
- **후보 500권 밖의 새 책**: 지금 빌드에는 들어가지 않고 `data/ai_recall/extra/<name>_new_books.json`에 메타데이터와 함께
  모아 둡니다. 여러 팀원이 같은 새 책을 넣었으면 하나로 합쳐집니다. 게임에 넣으려면 후보 목록을 넓히는 작업이 따로 필요합니다.

## 붙여 넣을 프롬프트

```text
You are a careful data labeller for Bookinator, an Akinator-style game that finds a NOVEL from the player's
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
01 | Is a child or teenager a central character? | A principal viewpoint or focal character is under 20 during the main story; childhood flashbacks alone do not count.
02 | Is a woman or girl a central character? | At least one principal viewpoint or focal character is female. This is not the complement of q03.
03 | Is a man or boy a central character? | At least one principal viewpoint or focal character is male. This is not the complement of q02.
04 | Does the story follow several equally important characters? | The narrative has multiple principal characters rather than one dominant protagonist.
05 | Is a nonhuman character central to the story? | A principal focal character is an animal, artificial intelligence, or other nonhuman being; an incidental creature does not count.
06 | Is a student a central character? | A principal focal character attends a school or university during the main story.
07 | Is a detective or investigator a central character? | A principal focal character performs sustained crime investigation; an incidental mystery does not count.
08 | Does a central character have supernatural abilities openly established in the premise? | Abilities must be established in the premise, not revealed in a later twist.
09 | Is a school a major setting? | A substantial part of the main story takes place at a school or university.
10 | Does much of it take place in a large city? | An urban setting dominates a substantial part of the main narrative.
11 | Does much of it take place in a village or rural area? | A village, farm, or countryside dominates a substantial part of the main narrative.
12 | Does much of it take place in Korea? | A substantial part of the story is geographically set on the Korean peninsula; author nationality is irrelevant.
13 | Does much of it take place in Britain? | A substantial part of the story is set in Great Britain; author nationality is irrelevant.
14 | Does much of it take place in the United States? | A substantial part of the story is set in the USA; author nationality is irrelevant.
15 | Is it mainly set in an invented world? | An invented secondary world, rather than recognizable real-world Earth, is the primary setting.
16 | Does a major part take place aboard a ship or at sea? | A substantial part of the narrative takes place at sea or aboard a waterborne ship.
17 | Is most of the story set before 1900? | More than half of the main narrative is set before 1900. Publication year is not setting year.
18 | Is most of it set between 1900 and 1945? | More than half of the main narrative is set in 1900 through 1945 inclusive.
19 | Is most of it set between 1946 and 1999? | More than half of the main narrative is set in 1946 through 1999 inclusive.
20 | Is most of it set in the 2000s or later, excluding an imagined future? | Most of the main narrative is set in real-world 2000 or later and is not speculative future fiction.
21 | Is it set in an imagined future? | A speculative future society or future era is the primary setting, relative to the work when written.
22 | Does it take place across multiple historical periods? | Substantial narrative spans distinctly different historical periods, not merely a brief flashback.
23 | Has a large disaster already changed society when the story begins? | The main story starts after a society-altering disaster; a disaster late in the story does not count.
24 | Is a real historical war a major part of the setting? | An identifiable real historical war substantially shapes the main setting.
25 | Is solving a crime a main storyline? | Crime investigation is a central ongoing plot, rather than an incidental event.
26 | Is a romantic relationship a main storyline? | Developing or sustaining a romantic relationship is a central plot.
27 | Is a long journey a main storyline? | A sustained journey or quest drives a substantial part of the plot.
28 | Is surviving physical danger a main storyline? | Survival under ongoing physical threat is a central plot.
29 | Is conflict within a family a main storyline? | Relationships or conflict among family members drive a main plot.
30 | Is resisting a government or authority a main storyline? | Opposition to a governing or institutional power is central to the premise.
31 | Is a competition or tournament central to the premise? | An organized contest, tournament, or competitive selection is central to the advertised premise.
32 | Does the story prominently involve magic? | Overt magic materially shapes the main narrative; a metaphor alone does not count.
33 | Is time travel part of the premise? | Literal movement through time is established in the premise; ordinary flashbacks do not count.
34 | Is space travel part of the premise? | Travel beyond Earth is established in the premise.
35 | Are ghosts or spirits openly part of the premise? | Ghosts or spirits are openly established, rather than a concealed ending or figurative reference.
36 | Are animals that speak or behave like people prominent? | Anthropomorphized animals are prominent characters, not a single incidental pet.
37 | Is a prison or confinement a major setting? | Prison, detention, captivity, or comparable forced confinement is a substantial setting.
38 | Is a shop or workplace a major setting? | A shop, office, factory, or comparable workplace is a substantial setting.
39 | Is illness a major part of the premise? | An illness or epidemic is openly central to the premise.
40 | Does the story prominently involve moving to another country? | Immigration, exile, or relocation across countries is substantial; tourism alone is insufficient.
41 | Is the story intended to be frightening? | Horror, sustained fear, or deliberate frightening effects are prominent; subjective label, use conservative confidence.
42 | Is humor a major part of it? | Comedy or satire is a sustained defining effect, rather than occasional jokes.
43 | Does it strongly focus on growing up? | Maturation or coming of age is a major theme.
44 | Does it strongly focus on social class or inequality? | Class, wealth disparity, or social inequality is a major theme.
45 | Does it strongly focus on friendship? | Friendship is a major thematic focus, not merely the presence of friends.
46 | Does it strongly focus on loneliness or isolation? | Loneliness or social isolation is a major thematic focus.
47 | Does it strongly focus on grief or loss? | Grieving or loss is a major thematic focus; do not expose a death revealed only in a twist.
48 | Does it strongly focus on moral or philosophical questions? | Explicit ethical or philosophical inquiry is a sustained major theme.
49 | Is much of it narrated using “I”? | First-person narration constitutes a substantial part of the novel; a quote in a synopsis is not evidence.
50 | Does it switch between different characters’ viewpoints? | The novel uses multiple focal viewpoints; a synopsis describing several characters does not prove this.
51 | Is much of it presented as letters or diary entries? | Epistolary or diary form constitutes a substantial part of the work.
52 | Does it frequently move between past and present? | Repeated nonlinear switching between time periods is a defining structural feature.
53 | Is it part of a named series? | This individual work belongs to an explicitly named series; a film franchise alone is insufficient.
54 | Is it the first book in that series? | The source establishes it as volume one in a named series; do not infer from a familiar title.
55 | Does it follow a family across more than one generation? | The main story substantially follows successive generations of one family.
57 | Was it originally written in Korean? | Original composition language, not the language of this edition or author nationality.
58 | Was it originally written in English? | Original composition language, not the language of this edition or author nationality.
59 | Was it originally written in Japanese? | Original composition language, not the language of this edition or author nationality.
m01 | Does a dragon appear? | A dragon is part of the story.
m02 | Are there vampires? | Vampires are characters in the story.
m03 | Are there werewolves or shape-shifters? | Characters who turn into animals (werewolves, shape-shifters) appear.
m04 | Are there wizards or witches? | Wizards, witches, sorcerers or warlocks are characters.
m05 | Are there angels or demons? | Angels, demons or devils appear as beings in the story.
m06 | Are there elves, dwarves, fairies or goblins? | Folklore beings such as elves, dwarves, fairies, goblins or trolls appear.
m07 | Do gods from mythology appear? | Gods or demigods from a mythology (Greek, Norse, ...) are characters.
m08 | Are there aliens from another world? | Extraterrestrial beings appear.
m09 | Are there robots or artificial intelligences? | Robots, androids or AIs are characters.
m10 | Is there a murder? | Someone is murdered or killed deliberately in the story.
m11 | Is there a serial killer? | A serial killer is part of the story.
m12 | Is someone kidnapped? | A character is kidnapped, abducted or held captive.
m13 | Is there a courtroom trial? | A trial, lawyer or court case is part of the story.
m14 | Are there spies or secret agents? | Spying or secret agents are part of the story.
m15 | Is there an assassin? | An assassin or an assassination plot is part of the story.
m16 | Is there a robbery or a thief? | A theft, robbery or a thief is part of the story.
m17 | Is a main character an orphan? | A central character's parents are dead or unknown.
m18 | Are there twins? | Twins are characters in the story.
m19 | Does someone become pregnant? | A pregnancy is part of the story.
m20 | Is there a wedding or engagement? | A wedding, engagement or marriage proposal happens.
m21 | Is there an affair? | Infidelity or an affair is part of the story.
m22 | Is there a divorce? | A divorce or separation of a married couple is part of the story.
m23 | Is there a dog? | A dog plays a part in the story.
m24 | Are there horses? | Horses play a part in the story.
m25 | Is there a cat? | A cat plays a part in the story.
m26 | Do wild beasts like wolves, bears or big cats feature? | Wolves, bears, lions, tigers, sharks or whales play a part.
m27 | Is a train journey part of it? | Trains or a railway play a part in the story.
m28 | Is much of it on an island? | An island is a major place in the story.
m29 | Is there a desert? | A desert is a place in the story.
m30 | Is there a hospital? | A hospital or asylum is a place in the story.
m31 | Is much of it set in New York? | New York City is a major setting.
m32 | Is much of it set in London? | London is a major setting.
m33 | Is much of it set in Paris or France? | Paris or France is a major setting.
m34 | Is there a castle or palace? | A castle or palace is a place in the story.
m35 | Are there kings, queens or princes? | Royalty are characters in the story.
m36 | Is there a battle or an army? | Battles, armies or soldiers are part of the story.
m37 | Is there a curse or a prophecy? | A curse or a prophecy drives part of the story.
m38 | Does someone hide their identity? | A character uses a disguise, false identity or impersonation.
m39 | Does a sport or game play a part? | A sport or game (football, chess, Quidditch, racing, ...) matters in the story.
m40 | Is there a hunt for treasure? | A treasure or hidden fortune is sought.
m41 | Does someone lose their memory? | Amnesia or erased memories are part of the story.
m42 | Are there clones or genetic engineering? | Cloning or genetic engineering is part of the story.
m43 | Is there cancer? | Cancer is part of the story.
m44 | Do drugs or drinking problems feature? | Alcoholism, drunkenness or drug use is part of the story.
m45 | Is music important? | A musician, singer, band or instrument matters in the story.
m46 | Is a writer or journalist a character? | A writer, novelist, poet or journalist is a character.
m47 | Is a teacher or professor a character? | A teacher, tutor, governess or professor is a character.
m48 | Is a doctor or nurse a character? | A doctor, nurse or surgeon is a character.
m49 | Is slavery part of it? | Slavery or enslaved people are part of the story.
m50 | Is there a circus, theatre or show? | A circus, carnival, theatre or performers are part of the story.
m51 | Is there a farm? | A farm or ranch is a place in the story.
m52 | Is there a secret society or cult? | A secret society, cult, order or brotherhood is part of the story.

BOOKS TO LABEL
<paste the book list here: one per line, "id | title | author" if you have ids, otherwise just "title | author">
```
