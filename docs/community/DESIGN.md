# That Book — 커뮤니티 기여 시스템 설계

상태: **설계 초안 + 백엔드·집계 구현 초안** (2026-11-14). 원격 Supabase 프로젝트(`jvfxqusmnfdvslrgbjyv`)에는 **아직 아무것도 적용하지 않았다.**
요구사항 원문은 「커뮤니티 기반 데이터 기여 시스템 설계 지침」(이하 *지침*)이고, 기존 명세는 `README.md`와 `CLAUDE.md`다.

| 산출물 | 위치 | 상태 |
| --- | --- | --- |
| 이 설계 문서 (지침 §11의 1–8단계) | `docs/community/DESIGN.md` | 초안 |
| PostgreSQL 스키마 · RLS · RPC | `supabase/migrations/20261114000000_community_contributions.sql` | PGlite에서 테스트됨, 원격 미적용 |
| 집단지성 집계 알고리즘 `crowd-v1` | `src/community/consensus.ts` | 구현 + 테스트 |
| 카탈로그 동기화 · 집계 실행 · 후보 카탈로그 생성 | `scripts/community.ts`, `scripts/community_lib.ts` | 구현 (원격 호출은 미실행) |
| 엔진·검증기의 `community_consensus` 상태 지원 | `src/engine/model.ts`, `scripts/validate_catalog.py`, `src/components/screens.tsx` | 구현 |
| 테스트 | `tests/consensus.test.ts`, `tests/community_export.test.ts`, `tests/db/schema.test.ts`, `tests/test_pipeline.py` | `npm run verify` 통과 |
| 기여 UI · 관리자 화면 | — | **미구현** (D1·D2·D7 결정 완료, 다음 단계) |

> **결정됨 (2026-11-14):** D1 = 익명 로그인 + CAPTCHA, D2 = 게임 종료 시마다 묻는 opt-in, D7 = 표지 업로드 받지 않음(Open Library 표지 링크만). 나머지 D#은 미정이다.
>
> 표기: **D#** = 아직 정해지지 않은 정책(§9). 코드에서는 기본값으로 동작하되 설정으로 바꿀 수 있게 했고, 확정된 요구사항처럼 굳히지 않았다.

---

## 1. 기존 명세와 신규 요구사항의 차이

### 1.1 그대로 재사용하는 것

| 기존 구조 | 커뮤니티 기능에서의 역할 |
| --- | --- |
| `src/engine/` 순수 TS 베이지안 엔진 | 변경 없음. 서버에 의존하지 않는다 (지침 §9, 제약 7). |
| 5지선다 채널 `DEFAULT_CHANNEL` (`P(답 \| 사실)`) | **집계에도 같은 채널을 쓴다.** "Probably"는 "Yes"보다 약한 증거이고, "Don't know"는 우도비가 1이다. 게임과 집계에서 답의 의미가 같아진다. |
| `Session` = append-only 이벤트 로그 | 원본 응답 저장 형식이다. `session_answers`의 `seq`는 묻는 순서 그대로다. |
| `CatalogBook`(작품) ⊃ `editions[]`(판본) | DB에서도 `books` / `editions`로 나눈다. 번역판·개정판은 새 책이 아니라 판본이다 (제약 6). |
| `p_yes ∈ {0.1, 0.3, 0.5, 0.7, 0.9}`, `status`, `reviewed`, `source_ids` | `book_features`와 집계 결과의 값 범위를 똑같이 맞춘다. |
| `validate_catalog.py`, `gate_catalog.ts`(엔진 게이트), `simulate.ts` | 커뮤니티 데이터가 들어간 후보 카탈로그도 같은 검증·게이트·시뮬레이션을 통과해야 배포된다. |
| `review.py`(사람 검수 CSV) | 출처 기반 라벨 검수 흐름은 그대로 둔다. 커뮤니티 검수는 DB의 `submission_reviews`로 한다. |
| 버전 관리되는 JSON 카탈로그 + `src/data/index.ts` | 정식 배포 수단으로 유지한다. DB는 JSON을 대체하지 않는다 (D8). |

### 1.2 새로 필요한 것

- 백엔드가 없다. 지금은 `server/library-proxy.mjs`만 있고 게임 세션은 `localStorage`에만 남는다. Supabase가 처음 들어오는 외부 저장소가 된다.
- 응답 원본을 수집하려면 게임 답변을 브라우저 밖으로 보내야 한다. 지금까지 "runs entirely in your browser"였으므로 **동의 절차가 필요하다** (D2).
- 피처 상태에 `community_consensus`를 추가한다. 출처 URL이 없는 대신, 사람이 승인한 집계 결과라는 출처 정보(`consensus: {algorithm_version, consensus_id, contributors}`)를 반드시 남긴다. 검증기가 이 조건을 강제한다.

### 1.3 충돌하거나 확인이 필요한 점

| # | 내용 | 처리 |
| --- | --- | --- |
| C1 | *지침*은 "약 200권 + 64문항"이라고 하지만, 실제 저장소는 **10권 fixture(기본, 64문항)** 와 **CMU 카탈로그(500권 수입, 27권 플레이 가능, 64문항 + 모티프 52문항 = 116문항)** 다 (2026-11-14 `35760b5` 기준). | 숫자를 가정하지 않았다. 스키마와 도구는 카탈로그 크기와 무관하다. |
| C2 | `CLAUDE.md` 규칙 "Don't add accounts, … online learning". Supabase Auth와 커뮤니티 집계가 여기에 걸릴 수 있다. | 계정 대신 **Supabase 익명 로그인**(가입 없음)을 기본안으로 제시한다 (D1). 집계 결과는 사람이 승인하고 새 JSON 릴리스로 배포될 때만 반영되므로 온라인 학습이 아니다. 그래도 **규칙 문구 수정 여부는 팀이 결정해야 한다.** |
| C3 | 제약 2 "외부 AI 서비스에 의존하는 데이터 생성 기능을 만들지 않는다". 그런데 기존 `scripts/prepare_catalog.py`는 Anthropic/OpenAI로 라벨을 만든다. | 새 기능에는 AI 호출이 전혀 없다. 기존 파이프라인을 남길지, 폐기할지, 오프라인 보조 도구로만 쓸지는 D10에서 결정한다. |
| C4 | 같은 질문 ID라도 은행마다 정의가 다르다. `data/question_bank.json`과 `data/cmu/question_bank_core.json`은 **64개 정의가 전부 다르고**, q08은 질문 문장까지 다르다. | 응답이 `(question_id, question_revision)`을 가리키게 했다. 릴리스마다 `release_questions`가 어떤 개정판을 썼는지 기록한다. |
| C5 | 두 카탈로그에 같은 작품이 다른 ID로 들어 있다 (예: *The Hunger Games* = `fx-hunger-games-1` / `cmu:enwiki:20128213`). | 미러에는 둘 다 들어간다. 작품 단위로 통합할지는 D8과 함께 정한다. 검색 결과에는 둘 다 후보로 나온다. |
| C6 | 필드 이름이 `title_en`이다. 한국어 원작이나 영어 제목이 없는 책은 넣을 자리가 애매하다. | 제출 단계에서는 `title`(원제)과 `title_ko`를 받는다. 내보낼 때는 `title → title_en`으로 넣고, 스키마 필드 이름 변경 여부는 남겨 둔다. |

---

## 2. 사용자 흐름

### 2.1 게임 실패 → 신규 도서 등록 (지침 §3)

```
게임 종료 (no_match: "None of these" 또는 2회 오답 후 목록에서 없음)
  └─ [기여 동의] "이번 답변을 데이터베이스 개선에 보낼까요?"  (D2 · 거절하면 아무것도 전송하지 않음)
       └─ 제목·저자 입력 ──► search_books(q)   제목/한국어 제목/별칭/저자 trigram + ISBN 정확 일치
            ├─ 결과 중 "이 책이에요" 선택 (정식 도서)
            │     submit_game_session({outcome:"no_match_exit", identified_book_id})
            │     → 카탈로그 실패 사례로 기록되고, 이번 답변은 그 책의 증거가 된다
            ├─ 결과 중 기존 제출(검수 대기) 선택
            │     submit_game_session(...) → submit_feature_answers({submission_id, …})
            └─ "목록에 없어요"
                  submit_game_session({outcome, …}) → session_id
                  submit_book({kind:"new_book", title, author, …, origin_session_id})
                    ├─ duplicate_book / duplicate_submission  (ISBN·OL work id 정확 일치) → 기존 항목으로 안내
                    ├─ possible_duplicates (유사도 ≥ 0.45)    → 후보를 보여주고 "그래도 다른 책" 확인을 받음
                    └─ created (status = pending)  게임 답변이 이 제출의 seed evidence로 연결됨
```

- 한 게임에서 나오는 새 책 제출은 1개다 (`book_submissions_one_per_session`).
- 답변을 "어떤 책에 대한 증거"로 볼지는 이렇게 정한다:
  - **확정된 책**(게임에서 맞춘 책, 실패 후 사용자가 지목한 책, 새로 제출한 책)의 증거로만 쓴다.
  - **거절된 추측**의 증거로는 쓰지 않는다. 그 답변들은 "이 책이 아니다"라는 뜻일 뿐, 어느 질문이 어긋났는지는 알 수 없기 때문이다.
- 판본과 시리즈: 번역 제목은 `title_ko`·`aliases`로, ISBN은 판본으로 받는다. 시리즈는 `series_title` + `series_number`로 받는다. 검색에는 별칭과 한국어 제목도 들어간다(테스트: "상실의 시대" → *Norwegian Wood*).

### 2.2 직접 기여 (지침 §4)

| 기능 | 흐름 | RPC |
| --- | --- | --- |
| 4.1 도서 등록 제안 | 검색 → 없으면 `submit_book(new_book)` (2.1과 같은 중복 처리) | `search_books`, `submit_book` |
| 4.1 정보 수정 제안 | 도서 화면 → "정보가 틀렸어요" → 바꿀 필드 입력. 허용 필드: 제목, 한국어 제목, 별칭, 저자, 원어, 연도, 시리즈, 판본 | `submit_book(correction)` |
| 4.2 특성 데이터 기여 | 도서 하나를 고른다 → 질문을 몇 개 보여준다 (D11: 질문 고르는 방식) → 5지선다로 답한다 | `submit_feature_answers` |
| 4.3 질문 제안 | 키워드 입력 → `search_questions` → 비슷한 질문이 있으면 그 질문으로 4.2 기여 / 없으면 문장·정의·이유 제출 | `search_questions`, `submit_question` |
| 4.4 표지 이미지 | 권리 근거 선택(D7) → 비공개 버킷 `cover-submissions/<uid>/…`에 업로드 → 메타데이터 제출 | Storage + `submit_image` |

### 2.3 상태 흐름

```
pending ──► collecting ──► review ──(approve: 승인 기록, 상태 유지)──► published   ← 릴리스 동기화 때만
   │            │            │  ▲
   │            │            │  └── rejected ─(reopen)─┘
   └────────────┴────────────┴──► rejected
  (모든 상태) ──► archived (병합·삭제·비활성화)  ── archived ─► review (복구)
```

- `published`로는 **관리자 함수가 아니라 릴리스 동기화(`community.ts sync`)만** 바꿀 수 있다. "승인"과 "정식 카탈로그 반영"을 분리하려는 것이다 (D4).
- 지침 §6에 따라, 응답이 충분히 모여도 자동으로 다음 단계로 넘어가지 않는다. 사람이 상태를 바꾼다.

---

## 3. PostgreSQL 스키마

전체 정의는 마이그레이션 파일에 있다. 데이터는 세 층으로 나누고 서로 섞지 않는다 (지침 §7 "반드시 분리").

| 층 | 테이블 | 쓰는 쪽 |
| --- | --- | --- |
| **① 정식 카탈로그 미러** | `catalog_releases`, `books`, `editions`, `sources`, `questions`, `question_revisions`, `release_books`, `release_questions`, `book_features`, `book_images` | service role의 `tb_sync_release(카탈로그 JSON)`만. 클라이언트는 읽기만 한다. |
| **② 사용자 원본** | `game_sessions`, `session_answers`, `book_submissions`, `submission_answers`, `question_submissions`, `image_submissions` | `submit_*` RPC로 insert만 한다. 수정·삭제 경로가 없다. |
| **③ 파생·검수** | `consensus_runs`, `feature_consensus`, `answer_exclusions`, `submission_reviews`, `contributor_status` | 집계 결과는 실행마다 새 행으로 쌓인다(덮어쓰지 않음). 검수 기록은 append-only 트리거로 보호한다. |
| 설정 | `community_settings`, `app_admins` | service role만 |

*지침* §7 표와의 대응:

| *지침* | 실제 | 비고 |
| --- | --- | --- |
| `books`, `editions`, `sources`, `book_features` | 같음 | 기존 JSON 계약의 필드를 그대로 쓴다. `book_features`는 `(catalog_version, book_id, question_id)` 키를 쓴다. |
| `questions` | `questions` + `question_revisions` + `release_questions` | C4 때문 |
| `game_sessions`, `session_answers` | 같음 | `consent_version`, `identified_book_id`를 추가했다 |
| `book_submissions`, `submission_answers`, `question_submissions`, `image_submissions` | 같음 | `submission_answers`는 정식 도서(4.2)와 제출 도서(3.7)를 모두 대상으로 한다 |
| `submission_reviews` | 같음 | 모든 관리자 행동(승인, 반려, 병합, 수정, 응답 제외, 차단, 집계 수락)을 기록한다 |
| `feature_consensus` | `consensus_runs` + `feature_consensus` | 실행별 이력을 남겨 재계산 결과를 비교할 수 있다 |
| — | `feature_evidence` (view) | 게임 응답과 기여 응답을 집계 입력 형태 하나로 합친다. `security_invoker`로 동작한다 |
| — | `answer_exclusions` | 부정확한 응답을 원본은 그대로 두고 제외만 한다. 제외는 되돌릴 수 있다 |

응답 상태 구분 (지침 §5):

| 상태 | 저장 방식 |
| --- | --- |
| Yes / No | `answer_kind` 값 그대로 |
| Probably / Probably not | `answer_kind` 값 그대로 (Yes/No로 바꾸지 않음) |
| Don't know | `answer_kind = 'dont_know'` 행으로 남김 |
| 질문하지 않음 | **행 없음** |

---

## 4. RLS 정책

| 대상 | anon | authenticated (익명 로그인 포함) | admin (`is_admin()`) | service role |
| --- | --- | --- | --- | --- |
| ① 정식 카탈로그 미러 | 읽기 | 읽기 | 읽기 | 읽기·쓰기 |
| ② 원본 테이블 | — | **자기 행만 읽기**. 직접 insert/update/delete 정책 없음 → `submit_*` RPC로만 쓴다 | 전체 읽기 | 전체 |
| ③ 집계·검수·제외·차단 | — | — | 읽기. 쓰기는 `admin_review` RPC로만 | 전체 |
| `app_admins`, 설정 | — | — | 설정 읽기 | 전체 |
| Storage `cover-submissions` | — | 자기 폴더(`<uid>/`)에만 업로드·읽기 (차단된 사용자는 업로드 불가) | 전체 읽기 | 전체 |
| Storage `covers` (공개) | 읽기 | 읽기 | 읽기 | 쓰기 |

- **관리자 권한은 클라이언트가 스스로 줄 수 없다.** `app_admins`에는 RLS가 켜져 있고 정책이 하나도 없다. 그래서 행 추가는 SQL Editor나 service role로만 할 수 있다. `is_admin()`은 `auth.uid()`로 이 테이블을 조회하는 security definer 함수다 (D5).
- 모든 `submit_*` 함수는 `auth.uid()`를 요구하고 차단 여부를 확인한다. 시간당 한도는 `community_settings`에서 바꿀 수 있다.
- 이번 마이그레이션이 만든 함수에서는 `PUBLIC/anon/authenticated`의 EXECUTE 권한을 회수하고, 필요한 함수에만 명시적으로 다시 부여했다. 프로젝트의 다른 함수는 건드리지 않는다.
- 테스트로 확인한 것 (`tests/db/schema.test.ts`):
  - 클라이언트는 카탈로그를 수정·추가할 수 없다.
  - 원본 테이블에 직접 insert하면 거부된다.
  - 다른 사용자의 세션과 제출은 보이지 않는다.
  - 관리자가 아니면 `admin_review`가 거부된다.
  - 검수 로그는 삭제할 수 없다.

---

## 5. 제출 API (PostgREST RPC)

모든 함수는 `POST /rest/v1/rpc/<name>`로 호출하고, 입력은 `jsonb` 하나다. 클라이언트는 `supabase-js`의 `rpc()`를 쓴다.

| 함수 | 권한 | 입력 | 출력 · 검증 |
| --- | --- | --- | --- |
| `search_books(q, max)` | anon+ | 검색어 | 정식 도서와 검수 대기 중인 제출을 함께 반환. 제출은 제목·저자·연도·상태만 노출하고 제출자 정보는 숨긴다. |
| `search_questions(q, max)` | anon+ | 키워드 | 현재 개정판 질문과 검수 대기 중인 질문 제안 |
| `submit_game_session(p)` | auth | `{catalog_version, outcome, confirmed_book_id?, identified_book_id?, rejected_book_ids?, film_memory_mode, consent_version, answers:[{question_id, answer}]}` | `session_id`. 확인 사항: 릴리스 존재, 질문과 책이 그 릴리스에 속하는지, 답변 1–18개(설정값), outcome과 확정 도서의 일관성, 동의 버전 필수 |
| `submit_book(p)` | auth | `new_book`이면 제목·저자 등 / `correction`이면 `target_book_id`, `proposed_changes` | `created` / `duplicate_book` / `duplicate_submission` / `possible_duplicates`(후보 목록, 저장하지 않음). `confirm_not_duplicate: true`이면 중복 의심 표시를 달고 저장한다 |
| `submit_feature_answers(p)` | auth | `{catalog_version, book_id \| submission_id, answers[]}` (호출당 최대 128개, research 카탈로그는 116문항) | 저장된 개수. 제출자가 자기 제출에 답하면 origin이 `submission_seed`, 아니면 `contribution_form` |
| `submit_question(p)` | auth | `{keyword, text, definition?, category?, rationale?, similar_question_ids?}` | `id` |
| `submit_image(p)` | auth | 업로드 경로(자기 폴더), 권리 근거, 라이선스, 출처 | `id` |
| `admin_review(p)` | admin | `{subject_type, subject_id, action, to_status?, reason?, details?}` | `review_id`. 상태 전이 검증, 반려·병합·제외·차단에는 사유 필수, 같은 트랜잭션에서 상태 변경과 기록을 함께 처리 |
| `tb_sync_release(cat)` | service | 카탈로그 JSON | 미러 적재. 같은 릴리스를 다시 넣으면 거부(불변) |

**Edge Functions 필요성:** 지금 범위는 Postgres 함수로 충분하다. 트랜잭션 하나로 처리되고, 마이그레이션 한 번에 배포되고, PGlite로 테스트할 수 있기 때문이다. Edge Function은 다음 경우에만 추가를 권장한다.
- 익명 로그인 시 CAPTCHA 서버 검증. 다만 Supabase Auth 자체 CAPTCHA 설정으로 대체할 수 있다.
- 이미지 검사(크기, EXIF 제거)
- 집계를 서버에서 정기 실행할 때. `consensus.ts`는 순수 TS라 Deno에서도 그대로 쓸 수 있다.

---

## 6. 집단지성 집계 알고리즘 `crowd-v1`

구현: `src/community/consensus.ts` (순수 TS, 테스트 `tests/consensus.test.ts`). 집계는 `(대상 도서, 질문)`마다 한다.

1. **입력:** `feature_evidence`의 행. 제외된 응답과 차단된 사용자의 응답은 `excluded = true`로 오고, 계산에서 빠진다.
2. **반복 제출 정규화:** 같은 사용자가 같은 도서·질문에 여러 번 답했으면 **가장 최근 답 하나만** 센다. 50번 반복해도 1표다 (지침 §5-5).
3. **증거:** 각 표의 로그우도비는 `ln(채널[a].givenYes / 채널[a].givenNo)`다.
   - 값: Yes +2.40, Probably +0.69, Don't know 0, Probably not −0.69, No −2.40
   - 여기에 `tempering`(기본 0.5)과 출처별 가중치(기본 모두 1)를 곱해서 더한다. 사전확률은 0.5에서 시작한다.
   - `tempering`은 응답자가 완전히 독립이 아니라는 점(같은 영화를 봤거나 같은 요약을 읽음)을 반영한다 (지침 §5-3).
4. **사후확률:** `posterior = σ(Σ)`
5. **합의도:** 긍정(Yes+Probably)과 부정(No+Probably not) 중 다수 쪽의 비율. "Don't know"는 합의도 계산에서 빠진다.
6. **제안값.** 조건을 만족하지 못하면 0.5다.

   | 제안 | 조건 |
   | --- | --- |
   | 0.9 / 0.1 | 정보성 응답자 ≥ 5, 합의도 ≥ 0.85, 사후확률 ≥ 0.95 / ≤ 0.05 |
   | 0.7 / 0.3 | 정보성 응답자 ≥ 3, 합의도 ≥ 0.7, 사후확률 ≥ 0.7 / ≤ 0.3 |
   | 0.5 | 그 외 |

7. **플래그:** `too_few_contributors`, `low_agreement`, `mostly_dont_know`, `conflicts_with_catalog`
   - `mostly_dont_know`는 질문이 그 책에 대해 기억하기 어렵다는 신호다. recallability 조정에 참고한다.
   - `conflicts_with_catalog`는 현재 정식 값과 방향이 반대일 때 붙는다. 정식 값은 **사전확률로 쓰지 않는다.** 검수자가 커뮤니티 의견만 따로 볼 수 있게 하려는 것이다.

**재계산 가능성:** 원본은 바뀌지 않고, 모든 실행이 `consensus_runs.config`(설정 전체)와 함께 새 행으로 쌓인다. 알고리즘을 바꾸면 `algorithmVersion`을 올리고 다시 실행하면 된다.

**한계 (검증되지 않음):**
- 위 수치는 모두 **플레이테스트 전 출발값**이다. `config.ts`의 임계값과 같은 성격이다.
- 게임에서 맞춘 책에 대한 답변에는 선택 편향이 있다. 엔진의 라벨과 맞았기 때문에 맞춘 것이므로, 기존 라벨을 확인하는 쪽으로 기운다.
- 그래서 4.2 기여 폼에서 질문을 어떻게 고를지(D11)가 중요하다. 정보이득 순으로 고르면 편향이 강화되고, 무작위나 커버리지 우선으로 고르면 완화된다.
- 같은 사람의 여러 계정이나 같은 기기의 여러 계정은 식별하지 않는다. 그러려면 IP나 기기 정보를 저장해야 하는데, 이는 개인정보 정책(D9)과 연결된다.

---

## 7. 관리자 검수 인터페이스 (설계만, 미구현)

별도 페이지 `/admin` 또는 별도 Vite 엔트리로 만든다. 로그인한 사용자가 `is_admin()`이 아니면 아무것도 보여주지 않는다. 모든 버튼은 `admin_review` 한 함수를 호출한다.

| 화면 | 보여줄 것 | 행동 |
| --- | --- | --- |
| 수신함 | 상태·종류별 개수, 오래된 순, 중복 의심 표시 | 필터 |
| 신규 도서 상세 | 제출 내용, `possible_duplicate_*` 후보 비교, 연결된 게임 답변, 질문별 집계(응답자 수, 분포, 합의도, 플래그), **엔진 게이트 미리보기** (`community.ts export` 보고서) | collecting / review / 승인 / 반려(사유) / 병합(대상 선택) / 필드 수정 |
| 수정 제안 | 현재 값과 제안 값 비교 | 승인 / 반려. 승인된 수정은 다음 릴리스에서 JSON에 반영 (D8) |
| 특성 데이터 | 셀별 집계 행, 정식 값과의 충돌, 원본 응답 목록 | 집계 수락 / 기각, 개별 응답 제외 / 복구 |
| 질문 제안 | 유사 질문, 정의의 명확성 체크리스트, 기존 도서 보완 계획 (§8.3) | 승인 / 반려 / 기존 질문과 중복 처리 |
| 이미지 | 미리보기(서명 URL), 권리 근거, 출처 | 승인 / 반려 |
| 기여자 | 제출량, 제외된 비율 | 차단 / 해제 (사유 필수) |
| 이력 | `submission_reviews` 전체 (누가, 언제, 무엇을, 왜) | 읽기 전용 |

"도서 비활성화·삭제"는 다음 릴리스 JSON에서 책을 빼는 방식으로 처리한다. 미러의 `books.status = archived`는 동기화 때 설정한다.

---

## 8. JSON 카탈로그 배포와 엔진 연동

```
 Supabase (원본·집계·검수)                    Git (정식 데이터)                    브라우저
 ─────────────────────────                    ─────────────────                    ────────
 feature_evidence ──community.ts consensus──► consensus_runs / feature_consensus
 admin_review(accept_consensus / approve)
        │
        └──community.ts export──► data/community/candidate.catalog.json + candidate.report.json
                                     │  사람: validate_catalog.py · simulate · 보고서(충돌·회귀) 확인
                                     ▼
                                  src/data/<catalog>.json 커밋 (catalog_version 증가) ──► vite build ──► 정적 배포
                                     │
        community.ts sync ◄──────────┘  릴리스를 미러에 적재하고, 포함된 tb:<uuid> 제출을 published로 표시
```

### 8.1 후보 카탈로그 규칙 (`scripts/community_lib.ts`, 테스트 `tests/community_export.test.ts`)

- 반영 대상은 **검수자가 수락한** 집계뿐이다. 0.5 제안은 반영하지 않는다.
- 커뮤니티 값이 채우는 셀: 비어 있는 셀, 0.5인 셀, 검수되지 않은 fixture/AI 라벨.
- 덮어쓰지 않는 셀: **출처로 확인된(`supported`) 셀과 사람이 검수한 셀.** 반대 방향이면 `conflicts`로 보고한다 (D6).
- 승인된 신규 도서는 `tb:<submission uuid>` ID로 추가한다. 다만 **자기 라벨로 답했을 때 엔진이 첫 추측으로 찾을 수 있을 때만** 넣는다. 기준은 `gate_catalog.ts`와 같다. 못 찾으면 넣지 않고 "응답을 더 모으세요"라는 사유를 남긴다 (지침 §9 "충분히 검증되지 않았다면 포함하지 않는다").
- 기존 책 중에 엔진이 더 이상 찾지 못하게 된 책이 있으면 `regressions`에 보고한다. 지침 §9의 "기존 도서 추론 정확도 변화"를 확인하는 장치다.
- 결과 파일의 `data_status`는 기준 카탈로그와 같다. 커뮤니티 데이터만으로 `production`이 되지는 않는다.

### 8.2 엔진 쪽 변경 (최소)

- `FeatureStatus`에 `community_consensus`를, `CatalogFeature`에 `consensus` 출처 정보를 추가했다. 엔진 계산은 바뀌지 않는다. `p_yes`만 사용하기 때문이다.
- 단서 카드에는 "from N readers' answers (reviewed)"라고 표시한다. 출처 확인된 라벨이 우선이라는 기존 규칙은 그대로다.
- Bayesian prior: 지금은 균등 사전확률이다. 새 책이 많아져도 바꾸지 않는 것을 기본으로 한다. 인기도 기반 사전확률은 정확도를 올릴 수 있지만 "숫자를 좋게 보이려고 조정하지 않는다"는 규칙과 부딪칠 수 있어 열어 둔다 (D12).

### 8.3 새 질문이 들어올 때

1. 승인된 질문에 다음 번호(`q65`…)를 붙이고 `group`과 `recallability`를 정한다. 기존 그룹과 상관이 있으면 같은 그룹에 넣는다.
2. 새 질문은 `active: false`로 카탈로그에 넣는다. 기존 질문 q56에 쓰는 것과 같은 방식이다. 그 상태에서 4.2 기여 폼이 기존 도서들에 대한 답을 모은다.
3. 도서별 셀이 충분히 채워지면 `active: true`로 바꾸고 시뮬레이션·게이트로 정보이득과 정확도 변화를 확인한 뒤 릴리스한다. 셀이 비어 있으면 0.5라 거의 질문되지 않지만, 확인 없이 켜지는 않는다.

---

## 9. 결정이 필요한 정책

| # | 질문 | 선택지 | 장단점 | 권장 |
| --- | --- | --- | --- | --- |
| **D1 ✅** | 누가 기여할 수 있나 | (a) Supabase **익명 로그인** + CAPTCHA (b) 이메일/소셜 계정 필수 (c) 로그인 없음(anon key만) | (a) 가입 없이 `auth.uid()` 단위로 중복 제거·한도·차단이 가능하다. 기기를 바꾸면 다른 사람으로 보인다. (b) 신뢰도가 가장 높지만 참여가 크게 줄고 CLAUDE.md "no accounts"와 정면으로 부딪친다. (c) 스팸을 막을 수단이 거의 없다. 현재 스키마는 (c)를 허용하지 않는다. | **결정: (a)**. 스키마는 (b)도 지원한다. Supabase Auth에서 Anonymous sign-ins와 CAPTCHA(Turnstile 또는 hCaptcha)를 켜야 한다. |
| **D2 ✅** | 게임 답변 전송 동의 | (a) 게임 끝에 매번 묻는 opt-in (b) 시작 화면에서 한 번 동의 (c) 기본 전송 + opt-out | (a) 가장 투명하지만 수집량이 적다. (c) "runs entirely in your browser" 문구와 충돌한다. | **결정: (a)**. 동의 문구에 버전을 붙여 `consent_version`에 저장한다. 거절하면 아무것도 전송하지 않는다. |
| **D3** | 기여 데이터의 라이선스 | CC0 / CC BY-SA 4.0 / 비공개 | CC BY-SA 출처와 섞어 재배포하기 쉬운 쪽은 CC0다. 법적 검토가 필요하다. | 팀 결정 |
| **D4** | 승인과 공개 사이에 상태를 하나 더 둘지 | (a) 6개 상태 유지, 승인은 기록으로만 (현재 구현) (b) `approved` 상태 추가 | (a) 지침의 상태 목록을 그대로 따른다. (b) 화면에서 더 명확하다. | (a). 필요하면 enum 값 하나만 추가하면 된다. |
| **D5** | 관리자 지정 방식 | (a) `app_admins` 테이블 (현재) (b) `app_metadata.role` JWT 클레임 | (a) SQL로 관리하기 쉽다. (b) 함수 호출 없이 RLS를 쓸 수 있지만 토큰을 갱신해야 반영된다. | (a) |
| **D6** | 커뮤니티와 출처 라벨이 충돌할 때 | (a) 출처 라벨 유지 + 보고 (현재) (b) 검수자가 셀 단위로 선택 | (b)는 관리자 UI 작업이 필요하다. | (a)로 시작 |
| **D7 ✅** | 표지 이미지를 받을지 | (a) 받지 않음, Open Library 표지 링크만 (b) 본인 촬영 사진만 (c) 출판사 허락 포함 | 표지는 저작물이다. `data/research/ATTRIBUTION.md`도 "cover-image rights are not established"라고 적고 있다. | **결정: (a)**. UI에 업로드 기능을 두지 않는다. `image_submissions`, `submit_image`, Storage 버킷은 나중을 위해 스키마에만 남긴다. |
| **D8** | 정식 카탈로그의 원본 위치 | (a) Git JSON이 원본, DB는 미러 (현재) (b) DB가 원본, JSON은 내보내기 결과 | (a) 기존 검증·게이트·리뷰 이력과 CI를 그대로 쓴다. (b) 관리자가 웹에서 바로 편집할 수 있지만 파이프라인을 새로 만들어야 한다. | 지금은 (a) |
| **D9** | 탈퇴·삭제 요청 시 원본 처리 | (a) 가명 ID만 남김 (현재: FK 없음) (b) 행 삭제 (c) 기간 후 익명화 | 원본 보존(제약 3)과 개인정보 요청 사이의 균형 문제다. | 법적 검토 후 결정 |
| D10 | 기존 LLM 라벨링 파이프라인 | 유지 / 오프라인 보조 도구로만 / 폐기 | 제약 2와의 관계 (C3) | 팀 결정 |
| D11 | 4.2 기여 폼의 질문 선택 | 정보이득 순 / 커버리지(빈 셀) 우선 / 무작위 | §6 선택 편향 | 커버리지 우선 + 일부 무작위 |
| D12 | 사전확률 | 균등 (현재) / 인기도 | §8.2 | 균등 유지 |
| D13 | 집계 수치 | §6의 출발값 | 플레이테스트로 조정 | — |

---

## 10. 다음 단계

1. ~~D1·D2·D7 결정~~ 완료 (2026-11-14). 업스트림의 Bookinator/Folio 프런트엔드 개편(`ec6fd9a`)도 병합했다.
2. Supabase 적용 (MCP 등록 완료, 세션 재시작과 인증 필요):
   - 개발 브랜치를 만들고 마이그레이션 적용
   - security / performance advisors 확인
   - 실제 Supabase에서 한국어 trigram 검색 확인. PGlite에서는 통과했지만 Supabase DB의 로케일 설정에 따라 결과가 달라질 수 있다.
   - 두 카탈로그 `sync`
3. 프런트엔드:
   - `@supabase/supabase-js` 추가, 익명 로그인
   - 게임 종료 화면에 동의와 "책 알려주기" 흐름 추가 (§2.1)
   - 환경 변수 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`가 없으면 기여 버튼을 숨긴다. 기존 정보나루 연동처럼 실패해도 게임에는 영향이 없어야 한다.
4. 관리자 화면 (§7)
5. 실제 플레이테스트 응답으로 §6 수치 조정

### 실행 방법

```bash
npm run verify                     # 기존 검사 + 집계·후보 카탈로그 테스트 + PGlite DB 테스트
npm run test:db                    # 마이그레이션 · RLS · RPC만
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run community -- sync --catalog src/data/fixture.catalog.json
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run community -- consensus --release fixture-2026-11-14b --dry-run
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run community -- export --base src/data/fixture.catalog.json --version fixture-2026-11-20-community1
```

service role 키는 브라우저 번들이나 `.env.local`의 `VITE_*` 변수에 넣지 않는다.
