-- That Book — community contribution schema (DRAFT, see docs/community/DESIGN.md)
--
-- Three layers that must never be mixed:
--   1. Published catalog mirror  : catalog_releases, books, editions, sources, questions, question_revisions,
--                                  release_books, release_questions, book_features, book_images
--                                  Read-only for clients. Written only by scripts/community/sync (service role)
--                                  from the versioned JSON catalog, which stays the source of truth.
--   2. Raw contributions         : game_sessions, session_answers, book_submissions, submission_answers,
--                                  question_submissions, image_submissions
--                                  Insert-only through the submit_* functions below. Never edited in place.
--   3. Derived / review data     : consensus_runs, feature_consensus, answer_exclusions, submission_reviews,
--                                  contributor_status
--                                  Recomputable (consensus) or append-only (reviews).
--
-- Policy choices that are NOT decided yet are marked "DECISION D#" and kept configurable.
-- Every client write needs auth.uid(): either Supabase anonymous sign-in or a real account (DECISION D1).

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Same five answers as src/engine/model.ts ANSWERS. "Not asked" is the absence of a row.
create type public.answer_kind as enum ('yes', 'probably', 'dont_know', 'probably_not', 'no');
create type public.lifecycle_status as enum ('pending', 'collecting', 'review', 'published', 'rejected', 'archived');
create type public.feature_status as enum
  ('supported', 'ambiguous', 'insufficient_evidence', 'unreviewed_fixture', 'community_consensus');
create type public.answer_origin as enum ('game_session', 'contribution_form', 'submission_seed');
create type public.session_outcome as enum ('found_guess', 'found_shortlist', 'no_match_exit', 'no_match_all_rejected');
create type public.submission_kind as enum ('new_book', 'correction');
create type public.submission_origin as enum ('game_miss', 'direct');
create type public.review_subject as enum
  ('book_submission', 'question_submission', 'image_submission', 'answer', 'contributor', 'feature_consensus');
create type public.review_action as enum
  ('approve', 'reject', 'set_status', 'merge', 'edit', 'exclude_answer', 'restore_answer',
   'block_contributor', 'unblock_contributor', 'accept_consensus', 'dismiss_consensus');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Lowercase, punctuation/whitespace collapsed. Used for duplicate search on titles, authors, aliases.
create or replace function public.tb_normalize(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select btrim(regexp_replace(lower(coalesce(t, '')), '[[:punct:][:space:]]+', ' ', 'g'))
$$;

-- Same checksum rule as scripts/validate_catalog.py isbn13_ok.
create or replace function public.tb_isbn13_ok(isbn text) returns boolean
language plpgsql immutable parallel safe set search_path = '' as $$
declare total int := 0;
begin
  if isbn is null then return true; end if;
  if isbn !~ '^97[89][0-9]{10}$' then return false; end if;
  for i in 1..12 loop
    total := total + substr(isbn, i, 1)::int * (case when i % 2 = 1 then 1 else 3 end);
  end loop;
  return (10 - total % 10) % 10 = substr(isbn, 13, 1)::int;
end $$;

create or replace function public.tb_touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

-- ---------------------------------------------------------------------------
-- Admins (DECISION D5). Rows are added only with the service role / SQL editor, never by a client.
-- ---------------------------------------------------------------------------

create table public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now(),
  note text
);
alter table public.app_admins enable row level security;
-- No policies: invisible and unwritable for anon/authenticated.

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_admins a where a.user_id = auth.uid())
$$;

-- Tunable limits (rate limits, max answers per session). Admin-readable, service-role-writable.
create table public.community_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.community_settings enable row level security;
create policy "admins read settings" on public.community_settings for select to authenticated using (public.is_admin());
insert into public.community_settings (key, value) values
  ('max_session_answers', '18'),          -- engine maxQuestions (src/engine/config.ts)
  ('rate_sessions_per_hour', '30'),
  ('rate_book_submissions_per_hour', '10'),
  ('rate_feature_answers_per_hour', '300'),
  ('rate_question_submissions_per_hour', '10'),
  ('rate_image_submissions_per_hour', '5'),
  ('duplicate_score_threshold', '0.45');

create or replace function public.tb_setting_int(k text, fallback int) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce((select (value #>> '{}')::int from public.community_settings where key = k), fallback)
$$;
create or replace function public.tb_setting_real(k text, fallback real) returns real
language sql stable security definer set search_path = '' as $$
  select coalesce((select (value #>> '{}')::real from public.community_settings where key = k), fallback)
$$;

-- Blocked contributors' answers are skipped by the aggregation; their rows stay stored.
create table public.contributor_status (
  user_id uuid primary key,
  blocked boolean not null default false,
  reason text,
  updated_at timestamptz not null default now()
);
alter table public.contributor_status enable row level security;
create policy "admins read contributor status" on public.contributor_status for select to authenticated using (public.is_admin());

create or replace function public.tb_require_contributor() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'sign-in required (anonymous sign-in is enough)' using errcode = '28000';
  end if;
  if exists (select 1 from public.contributor_status s where s.user_id = uid and s.blocked) then
    raise exception 'contributions from this user are blocked' using errcode = '42501';
  end if;
  return uid;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Published catalog mirror (mirrors src/engine/model.ts Catalog; work vs edition kept apart)
-- ---------------------------------------------------------------------------

create table public.catalog_releases (
  version text primary key,                          -- Catalog.catalog_version
  data_status text not null check (data_status in ('development_fixture', 'machine_labelled_unreviewed', 'production')),
  notice text,
  released_at timestamptz not null default now(),
  git_commit text,
  meta jsonb not null default '{}'                   -- the JSON's other top-level keys (credits, coverage, …)
);

-- A work. Editions (translations, revisions) live in public.editions, never as separate books.
create table public.books (
  id text primary key,                               -- "fx-the-hobbit", "cmu:enwiki:…", "tb:<uuid>"
  title_en text not null,
  title_ko text,
  aliases text[] not null default '{}',
  author text not null,
  original_language text not null,
  first_publication_year int check (first_publication_year between -3000 and 2100),
  series_id text,
  series_number numeric,
  openlibrary_work_id text unique check (openlibrary_work_id ~ '^OL[0-9]+W$'),
  status public.lifecycle_status not null default 'published' check (status in ('published', 'archived')),
  merged_into text references public.books (id),
  search_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (series_number is null or series_id is not null)
);
create index books_search_trgm on public.books using gin (search_text extensions.gin_trgm_ops);

create table public.editions (
  id bigint generated always as identity primary key,
  book_id text not null references public.books (id),
  isbn13 text unique check (public.tb_isbn13_ok(isbn13)),
  language text,
  title text,
  source_id text
);

create table public.sources (
  book_id text not null references public.books (id),
  id text not null,                                  -- source ids are scoped per book, as in the JSON
  url text not null check (url like 'https://%'),
  license text not null check (btrim(license) <> ''),
  attribution text,
  position int not null default 0,                   -- order in the book's sources list
  primary key (book_id, id)
);

create table public.questions (
  id text primary key,                               -- "q01" … ; new ones get the next free id
  status public.lifecycle_status not null default 'published' check (status in ('published', 'archived'))
);

-- The two shipped banks already define the same ids differently (all 64 definitions differ between
-- data/question_bank.json and data/cmu/question_bank_core.json), so answers point at a revision.
create table public.question_revisions (
  question_id text not null references public.questions (id),
  revision int not null check (revision >= 1),
  text text not null,
  definition text not null,
  category text,
  group_key text not null,
  recallability numeric not null check (recallability > 0 and recallability <= 1),
  adaptation_sensitive boolean not null default false,
  active boolean not null default true,
  inactive_reason text,
  primary key (question_id, revision)
);

create table public.release_books (
  catalog_version text not null references public.catalog_releases (version),
  book_id text not null references public.books (id),
  position int not null,                             -- order in the shipped JSON
  primary key (catalog_version, book_id)
);

create table public.release_questions (
  catalog_version text not null references public.catalog_releases (version),
  question_id text not null,
  revision int not null,
  position int not null,
  primary key (catalog_version, question_id),
  foreign key (question_id, revision) references public.question_revisions (question_id, revision)
);

-- Published feature cells, exactly as shipped in a release.
create table public.book_features (
  catalog_version text not null references public.catalog_releases (version),
  book_id text not null references public.books (id),
  question_id text not null references public.questions (id),
  p_yes numeric not null check (p_yes in (0.1, 0.3, 0.5, 0.7, 0.9)),
  status public.feature_status not null,
  source_ids text[] not null default '{}',
  reviewed boolean not null default false,
  note text,
  consensus_id bigint,                               -- feature_consensus.id when the cell came from community consensus
  consensus jsonb,                                   -- the JSON's provenance object for community_consensus cells
  position int not null,
  primary key (catalog_version, book_id, question_id)
);

create table public.book_images (
  id uuid primary key default gen_random_uuid(),
  book_id text not null references public.books (id),
  storage_path text not null,                        -- bucket "covers" (public, service-role writes)
  source_url text,
  license text not null,
  attribution text,
  from_submission_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index book_images_one_active on public.book_images (book_id) where active;

create or replace function public.tb_books_search_text() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.search_text := public.tb_normalize(
    concat_ws(' ', new.title_en, new.title_ko, array_to_string(new.aliases, ' '), new.author));
  return new;
end $$;
create trigger books_search_text before insert or update on public.books
  for each row execute function public.tb_books_search_text();
create trigger books_updated_at before update on public.books
  for each row execute function public.tb_touch_updated_at();

-- Read access: everyone may read the published catalog; nobody but the service role writes it.
do $$
declare t text;
begin
  foreach t in array array['catalog_releases', 'books', 'editions', 'sources', 'questions', 'question_revisions',
                           'release_books', 'release_questions', 'book_features', 'book_images'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Raw contributions (insert-only through submit_* functions)
-- ---------------------------------------------------------------------------

create table public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  contributor_id uuid not null,                      -- auth.uid(); no FK so raw data outlives the account (DECISION D9)
  catalog_version text not null references public.catalog_releases (version),
  film_memory_mode boolean not null default false,
  outcome public.session_outcome not null,
  confirmed_book_id text references public.books (id),   -- accepted from a guess or the shortlist
  identified_book_id text references public.books (id),  -- named by the reader after a miss (catalog failure!)
  rejected_book_ids text[] not null default '{}',
  consent_version text not null,                     -- which consent text the reader agreed to (DECISION D2)
  created_at timestamptz not null default now(),
  check ((outcome in ('found_guess', 'found_shortlist')) = (confirmed_book_id is not null)),
  check (identified_book_id is null or outcome in ('no_match_exit', 'no_match_all_rejected'))
);
create index game_sessions_contributor on public.game_sessions (contributor_id, created_at);

create table public.session_answers (
  session_id uuid not null references public.game_sessions (id) on delete restrict,
  seq smallint not null check (seq >= 1),
  question_id text not null,
  question_revision int not null,
  answer public.answer_kind not null,
  primary key (session_id, seq),
  unique (session_id, question_id),
  foreign key (question_id, question_revision) references public.question_revisions (question_id, revision)
);

create table public.book_submissions (
  id uuid primary key default gen_random_uuid(),
  kind public.submission_kind not null,
  status public.lifecycle_status not null default 'pending',
  origin public.submission_origin not null,
  origin_session_id uuid references public.game_sessions (id),
  target_book_id text references public.books (id),  -- correction: the book to change
  title text,
  author text,
  title_ko text,
  aliases text[] not null default '{}',
  original_language text,
  first_publication_year int check (first_publication_year between -3000 and 2100),
  series_title text,
  series_number numeric,
  isbn13 text check (public.tb_isbn13_ok(isbn13)),
  openlibrary_work_id text check (openlibrary_work_id ~ '^OL[0-9]+W$'),
  proposed_changes jsonb,                            -- correction: {field: new value}
  reason text check (length(reason) <= 2000),
  possible_duplicate_book_ids text[] not null default '{}',
  possible_duplicate_submission_ids uuid[] not null default '{}',
  merged_into_book_id text references public.books (id),
  merged_into_submission_id uuid references public.book_submissions (id),
  approved_review_id bigint,                         -- approval recorded; "published" only after release (DECISION D4)
  published_book_id text references public.books (id),
  submitted_by uuid not null,
  search_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'new_book' or (title is not null and author is not null)),
  check (kind <> 'correction' or (target_book_id is not null and proposed_changes is not null)),
  check (origin <> 'game_miss' or origin_session_id is not null),
  check (num_nonnulls(merged_into_book_id, merged_into_submission_id) <= 1)
);
create index book_submissions_search_trgm on public.book_submissions using gin (search_text extensions.gin_trgm_ops);
create index book_submissions_by_user on public.book_submissions (submitted_by, created_at);
-- One new-book submission per game, so a game's answers seed exactly one target.
create unique index book_submissions_one_per_session on public.book_submissions (origin_session_id)
  where origin_session_id is not null and kind = 'new_book';
create unique index book_submissions_open_isbn on public.book_submissions (isbn13)
  where isbn13 is not null and status in ('pending', 'collecting', 'review');

create or replace function public.tb_submissions_search_text() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.search_text := public.tb_normalize(
    concat_ws(' ', new.title, new.title_ko, array_to_string(new.aliases, ' '), new.author));
  return new;
end $$;
create trigger book_submissions_search_text before insert or update on public.book_submissions
  for each row execute function public.tb_submissions_search_text();
create trigger book_submissions_updated_at before update on public.book_submissions
  for each row execute function public.tb_touch_updated_at();

-- Answers given outside a game: about a published book (4.2) or a submitted one (3.7 / 4.1).
create table public.submission_answers (
  id bigint generated always as identity primary key,
  book_id text references public.books (id),
  submission_id uuid references public.book_submissions (id),
  question_id text not null,
  question_revision int not null,
  answer public.answer_kind not null,
  origin public.answer_origin not null check (origin <> 'game_session'),
  contributor_id uuid not null,
  created_at timestamptz not null default now(),
  check (num_nonnulls(book_id, submission_id) = 1),
  foreign key (question_id, question_revision) references public.question_revisions (question_id, revision)
);
create index submission_answers_target on public.submission_answers (coalesce(book_id, submission_id::text), question_id);
create index submission_answers_by_user on public.submission_answers (contributor_id, created_at);

create table public.question_submissions (
  id uuid primary key default gen_random_uuid(),
  status public.lifecycle_status not null default 'pending',
  keyword text not null check (length(keyword) between 1 and 100),
  text text not null check (length(text) between 5 and 200),
  definition text check (length(definition) <= 1000),
  category text,
  rationale text check (length(rationale) <= 2000),
  similar_question_ids text[] not null default '{}',  -- what the search showed before submitting
  duplicate_of_question_id text references public.questions (id),
  approved_review_id bigint,
  published_question_id text references public.questions (id),
  submitted_by uuid not null,
  search_text text generated always as (public.tb_normalize(keyword || ' ' || "text")) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index question_submissions_search_trgm on public.question_submissions using gin (search_text extensions.gin_trgm_ops);
create trigger question_submissions_updated_at before update on public.question_submissions
  for each row execute function public.tb_touch_updated_at();

create table public.image_submissions (
  id uuid primary key default gen_random_uuid(),
  status public.lifecycle_status not null default 'pending',
  book_id text references public.books (id),
  submission_id uuid references public.book_submissions (id),
  storage_path text not null,                        -- bucket "cover-submissions" (private): <uid>/<file>
  rights_basis text not null check (rights_basis in
    ('own_photo', 'publisher_permission', 'public_domain', 'open_license', 'other')),  -- DECISION D7
  license text,
  source_url text check (source_url is null or source_url like 'https://%'),
  attribution text,
  replaces_image_id uuid references public.book_images (id),
  approved_review_id bigint,
  submitted_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(book_id, submission_id) = 1)
);
create trigger image_submissions_updated_at before update on public.image_submissions
  for each row execute function public.tb_touch_updated_at();

-- Owners can read their own raw rows; admins can read everything. No client insert/update/delete
-- policies at all: writes go through the security-definer submit_* / admin_* functions.
alter table public.game_sessions enable row level security;
create policy "own or admin" on public.game_sessions for select to authenticated
  using (contributor_id = auth.uid() or public.is_admin());
alter table public.session_answers enable row level security;
create policy "own or admin" on public.session_answers for select to authenticated
  using (public.is_admin() or exists (select 1 from public.game_sessions s
                                      where s.id = session_id and s.contributor_id = auth.uid()));
alter table public.book_submissions enable row level security;
create policy "own or admin" on public.book_submissions for select to authenticated
  using (submitted_by = auth.uid() or public.is_admin());
alter table public.submission_answers enable row level security;
create policy "own or admin" on public.submission_answers for select to authenticated
  using (contributor_id = auth.uid() or public.is_admin());
alter table public.question_submissions enable row level security;
create policy "own or admin" on public.question_submissions for select to authenticated
  using (submitted_by = auth.uid() or public.is_admin());
alter table public.image_submissions enable row level security;
create policy "own or admin" on public.image_submissions for select to authenticated
  using (submitted_by = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- 3. Review log, exclusions, consensus
-- ---------------------------------------------------------------------------

create table public.submission_reviews (
  id bigint generated always as identity primary key,
  subject_type public.review_subject not null,
  subject_id text not null,
  action public.review_action not null,
  from_status public.lifecycle_status,
  to_status public.lifecycle_status,
  reason text,
  details jsonb not null default '{}',
  reviewer_id uuid not null,
  created_at timestamptz not null default now()
);
create index submission_reviews_subject on public.submission_reviews (subject_type, subject_id, created_at);

-- Append-only, even for the service role: corrections are new review rows.
create or replace function public.tb_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception '% is append-only', tg_table_name using errcode = '42501'; end $$;
create trigger submission_reviews_append_only before update or delete on public.submission_reviews
  for each row execute function public.tb_append_only();

-- Raw answers are never edited; a reviewer excludes them here (and can restore them later).
create table public.answer_exclusions (
  id bigint generated always as identity primary key,
  session_id uuid,
  seq smallint,
  submission_answer_id bigint references public.submission_answers (id),
  review_id bigint not null references public.submission_reviews (id),
  restored_review_id bigint references public.submission_reviews (id),
  created_at timestamptz not null default now(),
  check ((session_id is not null and seq is not null and submission_answer_id is null)
      or (session_id is null and seq is null and submission_answer_id is not null)),
  foreign key (session_id, seq) references public.session_answers (session_id, seq)
);

-- One row per aggregation run; results are inserted, never overwritten, so runs can be compared.
create table public.consensus_runs (
  id bigint generated always as identity primary key,
  algorithm_version text not null,
  config jsonb not null,
  input_rows int not null,
  git_commit text,
  created_at timestamptz not null default now()
);

create table public.feature_consensus (
  id bigint generated always as identity primary key,
  run_id bigint not null references public.consensus_runs (id),
  target_id text not null,                           -- book id or "submission:<uuid>"
  question_id text not null references public.questions (id),
  raw_answers int not null,
  contributors int not null,
  informative_contributors int not null,
  counts jsonb not null,
  log_odds double precision not null,
  posterior double precision not null,
  agreement double precision not null,
  proposed_p_yes numeric not null check (proposed_p_yes in (0.1, 0.3, 0.5, 0.7, 0.9)),
  flags text[] not null default '{}',
  unique (run_id, target_id, question_id)
);
alter table public.book_features
  add constraint book_features_consensus_fk foreign key (consensus_id) references public.feature_consensus (id);

do $$
declare t text;
begin
  foreach t in array array['submission_reviews', 'answer_exclusions', 'consensus_runs', 'feature_consensus'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "admins read" on public.%I for select to authenticated using (public.is_admin())', t);
  end loop;
end $$;

-- Every raw answer that counts as evidence about one target, in one shape for the aggregation.
-- Game answers count only for the book the reader confirmed or named; answers in a game whose
-- guess was rejected say nothing reliable about the rejected book and are not attributed to it.
create or replace view public.feature_evidence with (security_invoker = true) as
with sub_target as (
  select s.id,
         coalesce(s.published_book_id, s.merged_into_book_id,
                  'submission:' || coalesce(s.merged_into_submission_id, s.id)::text) as target_id
  from public.book_submissions s
  where s.kind = 'new_book' and s.status <> 'rejected'
)
select 'session:' || a.session_id || ':' || a.seq as answer_ref,
       g.contributor_id,
       coalesce(g.confirmed_book_id, g.identified_book_id, st.target_id) as target_id,
       a.question_id, a.question_revision, a.answer,
       'game_session'::public.answer_origin as origin,
       g.created_at,
       exists (select 1 from public.answer_exclusions e
               where e.session_id = a.session_id and e.seq = a.seq and e.restored_review_id is null)
         or coalesce(cs.blocked, false) as excluded
from public.session_answers a
join public.game_sessions g on g.id = a.session_id
left join public.book_submissions bs on bs.origin_session_id = g.id and bs.kind = 'new_book'
left join sub_target st on st.id = bs.id
left join public.contributor_status cs on cs.user_id = g.contributor_id
where coalesce(g.confirmed_book_id, g.identified_book_id, st.target_id) is not null
union all
select 'answer:' || a.id,
       a.contributor_id,
       coalesce(a.book_id, st.target_id),
       a.question_id, a.question_revision, a.answer, a.origin, a.created_at,
       exists (select 1 from public.answer_exclusions e
               where e.submission_answer_id = a.id and e.restored_review_id is null)
         or coalesce(cs.blocked, false)
from public.submission_answers a
left join sub_target st on st.id = a.submission_id
left join public.contributor_status cs on cs.user_id = a.contributor_id
where coalesce(a.book_id, st.target_id) is not null;

-- ---------------------------------------------------------------------------
-- Search (duplicate prevention): published books + open submissions, limited columns
-- ---------------------------------------------------------------------------

create or replace function public.search_books(q text, max_results int default 10)
returns table (kind text, id text, title text, title_ko text, author text,
               first_publication_year int, status public.lifecycle_status, score real)
language sql stable security definer set search_path = '' as $$
  with nq as (select public.tb_normalize(q) as v)
  select * from (
    select 'book'::text, b.id, b.title_en, b.title_ko, b.author, b.first_publication_year, b.status,
           greatest(extensions.similarity(b.search_text, nq.v), extensions.word_similarity(nq.v, b.search_text))
    from public.books b, nq
    where b.status = 'published' and length(nq.v) >= 2
      and (b.search_text operator(extensions.%) nq.v or nq.v operator(extensions.<%) b.search_text
           or exists (select 1 from public.editions e where e.book_id = b.id and e.isbn13 = regexp_replace(q, '[^0-9]', '', 'g')))
    union all
    select 'submission', s.id::text, s.title, s.title_ko, s.author, s.first_publication_year, s.status,
           greatest(extensions.similarity(s.search_text, nq.v), extensions.word_similarity(nq.v, s.search_text))
    from public.book_submissions s, nq
    where s.kind = 'new_book' and s.status in ('pending', 'collecting', 'review') and s.merged_into_book_id is null
      and s.merged_into_submission_id is null and length(nq.v) >= 2
      and (s.search_text operator(extensions.%) nq.v or nq.v operator(extensions.<%) s.search_text
           or s.isbn13 = regexp_replace(q, '[^0-9]', '', 'g'))
  ) r (kind, id, title, title_ko, author, first_publication_year, status, score)
  order by score desc, id
  limit least(greatest(max_results, 1), 25)
$$;

create or replace function public.search_questions(q text, max_results int default 10)
returns table (kind text, id text, question_text text, score real)
language sql stable security definer set search_path = '' as $$
  with nq as (select public.tb_normalize(q) as v),
  current_rev as (
    select distinct on (r.question_id) r.question_id, r.text
    from public.question_revisions r join public.questions qq on qq.id = r.question_id
    where qq.status = 'published' and r.active
    order by r.question_id, r.revision desc
  )
  select * from (
    select 'question'::text, c.question_id, c.text,
           extensions.word_similarity(nq.v, public.tb_normalize(c.text))
    from current_rev c, nq
    where nq.v operator(extensions.<%) public.tb_normalize(c.text)
    union all
    select 'submission', s.id::text, s.text, extensions.word_similarity(nq.v, s.search_text)
    from public.question_submissions s, nq
    where s.status in ('pending', 'collecting', 'review') and nq.v operator(extensions.<%) s.search_text
  ) r (kind, id, question_text, score)
  order by score desc, id
  limit least(greatest(max_results, 1), 25)
$$;

-- ---------------------------------------------------------------------------
-- Submission functions (the only client write path)
-- ---------------------------------------------------------------------------

create or replace function public.tb_rate_limit(uid uuid, tbl text, user_col text, setting text, fallback int, adding int default 1)
returns void language plpgsql security definer set search_path = '' as $$
declare n int; lim int := public.tb_setting_int(setting, fallback);
begin
  execute format('select count(*) from public.%I where %I = $1 and created_at > now() - interval ''1 hour''', tbl, user_col)
    into n using uid;
  if n + adding > lim then
    raise exception 'rate limit: at most % per hour', lim using errcode = '53400';
  end if;
end $$;

-- p: {catalog_version, film_memory_mode, outcome, confirmed_book_id?, identified_book_id?,
--     rejected_book_ids?: [], consent_version, answers: [{question_id, answer}] in asked order}
create or replace function public.submit_game_session(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.tb_require_contributor();
  v text := p->>'catalog_version';
  sid uuid;
  item jsonb;
  n int := 0;
  rev int;
  max_answers int := public.tb_setting_int('max_session_answers', 18);
  book text;
begin
  perform public.tb_rate_limit(uid, 'game_sessions', 'contributor_id', 'rate_sessions_per_hour', 30);
  if not exists (select 1 from public.catalog_releases where version = v) then
    raise exception 'unknown catalog_version %', v using errcode = '22023';
  end if;
  if jsonb_typeof(p->'answers') <> 'array' or jsonb_array_length(p->'answers') not between 1 and max_answers then
    raise exception 'answers must be an array of 1..% items', max_answers using errcode = '22023';
  end if;
  if coalesce(btrim(p->>'consent_version'), '') = '' then
    raise exception 'consent_version is required' using errcode = '22023';
  end if;
  foreach book in array array[p->>'confirmed_book_id', p->>'identified_book_id']
                        || coalesce(array(select jsonb_array_elements_text(p->'rejected_book_ids')), '{}') loop
    if book is not null and not exists (select 1 from public.release_books where catalog_version = v and book_id = book) then
      raise exception 'book % is not in release %', book, v using errcode = '22023';
    end if;
  end loop;

  insert into public.game_sessions (contributor_id, catalog_version, film_memory_mode, outcome,
                                    confirmed_book_id, identified_book_id, rejected_book_ids, consent_version)
  values (uid, v, coalesce((p->>'film_memory_mode')::boolean, false), (p->>'outcome')::public.session_outcome,
          p->>'confirmed_book_id', p->>'identified_book_id',
          coalesce(array(select jsonb_array_elements_text(p->'rejected_book_ids')), '{}'),
          p->>'consent_version')
  returning id into sid;

  for item in select * from jsonb_array_elements(p->'answers') loop
    n := n + 1;
    select rq.revision into rev from public.release_questions rq
      where rq.catalog_version = v and rq.question_id = item->>'question_id';
    if rev is null then
      raise exception 'question % is not in release %', item->>'question_id', v using errcode = '22023';
    end if;
    insert into public.session_answers (session_id, seq, question_id, question_revision, answer)
    values (sid, n, item->>'question_id', rev, (item->>'answer')::public.answer_kind);
  end loop;
  return sid;
end $$;

-- p (new_book): {kind:"new_book", title, author, title_ko?, aliases?, original_language?, first_publication_year?,
--                series_title?, series_number?, isbn13?, openlibrary_work_id?, reason?, origin_session_id?,
--                confirm_not_duplicate?: bool}
-- p (correction): {kind:"correction", target_book_id, proposed_changes: {field: value}, reason}
-- Returns {status: "created"|"duplicate_book"|"duplicate_submission"|"possible_duplicates", ...}
create or replace function public.submit_book(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.tb_require_contributor();
  k public.submission_kind := (p->>'kind')::public.submission_kind;
  isbn text := nullif(regexp_replace(coalesce(p->>'isbn13', ''), '[^0-9]', '', 'g'), '');
  olid text := nullif(p->>'openlibrary_work_id', '');
  hit text;
  cands jsonb;
  threshold real := public.tb_setting_real('duplicate_score_threshold', 0.45);
  sid uuid;
  allowed_fields text[] := array['title_en', 'title_ko', 'aliases', 'author', 'original_language',
                                 'first_publication_year', 'series', 'edition'];
begin
  perform public.tb_rate_limit(uid, 'book_submissions', 'submitted_by', 'rate_book_submissions_per_hour', 10);

  if k = 'correction' then
    if not exists (select 1 from public.books where id = p->>'target_book_id' and status = 'published') then
      raise exception 'unknown book %', p->>'target_book_id' using errcode = '22023';
    end if;
    if jsonb_typeof(p->'proposed_changes') <> 'object'
       or exists (select 1 from jsonb_object_keys(p->'proposed_changes') f where f <> all (allowed_fields)) then
      raise exception 'proposed_changes may only contain %', allowed_fields using errcode = '22023';
    end if;
    insert into public.book_submissions (kind, origin, target_book_id, proposed_changes, reason, submitted_by)
    values ('correction', 'direct', p->>'target_book_id', p->'proposed_changes', p->>'reason', uid)
    returning id into sid;
    return jsonb_build_object('status', 'created', 'submission_id', sid);
  end if;

  if length(btrim(coalesce(p->>'title', ''))) not between 1 and 300
     or length(btrim(coalesce(p->>'author', ''))) not between 1 and 200 then
    raise exception 'title (1-300) and author (1-200) are required' using errcode = '22023';
  end if;
  if (p->>'origin_session_id') is not null and not exists (
      select 1 from public.game_sessions g where g.id = (p->>'origin_session_id')::uuid and g.contributor_id = uid) then
    raise exception 'origin_session_id is not your session' using errcode = '42501';
  end if;

  -- Exact identifiers: an existing edition ISBN or work id is always the same work.
  select e.book_id into hit from public.editions e where isbn is not null and e.isbn13 = isbn;
  if hit is null then select b.id into hit from public.books b where olid is not null and b.openlibrary_work_id = olid; end if;
  if hit is not null then return jsonb_build_object('status', 'duplicate_book', 'book_id', hit); end if;
  select s.id::text into hit from public.book_submissions s
    where isbn is not null and s.isbn13 = isbn and s.status in ('pending', 'collecting', 'review');
  if hit is not null then return jsonb_build_object('status', 'duplicate_submission', 'submission_id', hit); end if;

  -- Fuzzy title/author/alias match: show candidates first; create only after the reader confirms.
  select coalesce(jsonb_agg(to_jsonb(c)), '[]') into cands
    from public.search_books(concat_ws(' ', p->>'title', p->>'author'), 10) c where c.score >= threshold;
  if jsonb_array_length(cands) > 0 and not coalesce((p->>'confirm_not_duplicate')::boolean, false) then
    return jsonb_build_object('status', 'possible_duplicates', 'candidates', cands);
  end if;

  insert into public.book_submissions (
    kind, origin, origin_session_id, title, author, title_ko, aliases, original_language, first_publication_year,
    series_title, series_number, isbn13, openlibrary_work_id, reason, submitted_by,
    possible_duplicate_book_ids, possible_duplicate_submission_ids)
  values (
    'new_book', case when p->>'origin_session_id' is null then 'direct' else 'game_miss' end::public.submission_origin,
    (p->>'origin_session_id')::uuid, btrim(p->>'title'), btrim(p->>'author'), nullif(btrim(p->>'title_ko'), ''),
    coalesce(array(select jsonb_array_elements_text(p->'aliases')), '{}'), nullif(p->>'original_language', ''),
    (p->>'first_publication_year')::int, nullif(p->>'series_title', ''), (p->>'series_number')::numeric, isbn, olid,
    p->>'reason', uid,
    coalesce(array(select c->>'id' from jsonb_array_elements(cands) c where c->>'kind' = 'book'), '{}'),
    coalesce(array(select (c->>'id')::uuid from jsonb_array_elements(cands) c where c->>'kind' = 'submission'), '{}'))
  returning id into sid;
  return jsonb_build_object('status', 'created', 'submission_id', sid,
                            'flagged_possible_duplicates', jsonb_array_length(cands) > 0);
end $$;

-- p: {catalog_version, book_id? | submission_id?, answers: [{question_id, answer}]}
create or replace function public.submit_feature_answers(p jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public.tb_require_contributor();
  v text := p->>'catalog_version';
  bid text := p->>'book_id';
  sub uuid := (p->>'submission_id')::uuid;
  org public.answer_origin := 'contribution_form';
  item jsonb;
  rev int;
  n int := 0;
begin
  if num_nonnulls(bid, sub) <> 1 then raise exception 'give exactly one of book_id, submission_id' using errcode = '22023'; end if;
  if jsonb_typeof(p->'answers') <> 'array' or jsonb_array_length(p->'answers') not between 1 and 128 then
    raise exception 'answers must be an array of 1..128 items' using errcode = '22023';
  end if;
  perform public.tb_rate_limit(uid, 'submission_answers', 'contributor_id', 'rate_feature_answers_per_hour', 300,
                               jsonb_array_length(p->'answers'));
  if bid is not null and not exists (select 1 from public.books where id = bid and status = 'published') then
    raise exception 'unknown book %', bid using errcode = '22023';
  end if;
  if sub is not null then
    if not exists (select 1 from public.book_submissions s where s.id = sub and s.kind = 'new_book'
                   and s.status in ('pending', 'collecting', 'review')) then
      raise exception 'submission % is not open for answers', sub using errcode = '22023';
    end if;
    if exists (select 1 from public.book_submissions s where s.id = sub and s.submitted_by = uid) then
      org := 'submission_seed';
    end if;
  end if;
  for item in select * from jsonb_array_elements(p->'answers') loop
    select rq.revision into rev from public.release_questions rq
      where rq.catalog_version = v and rq.question_id = item->>'question_id';
    if rev is null then
      raise exception 'question % is not in release %', item->>'question_id', v using errcode = '22023';
    end if;
    insert into public.submission_answers (book_id, submission_id, question_id, question_revision, answer, origin, contributor_id)
    values (bid, sub, item->>'question_id', rev, (item->>'answer')::public.answer_kind, org, uid);
    n := n + 1;
  end loop;
  return n;
end $$;

-- p: {keyword, text, definition?, category?, rationale?, similar_question_ids?: []}
create or replace function public.submit_question(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.tb_require_contributor(); qid uuid;
begin
  perform public.tb_rate_limit(uid, 'question_submissions', 'submitted_by', 'rate_question_submissions_per_hour', 10);
  insert into public.question_submissions (keyword, text, definition, category, rationale, similar_question_ids, submitted_by)
  values (btrim(p->>'keyword'), btrim(p->>'text'), p->>'definition', p->>'category', p->>'rationale',
          coalesce(array(select jsonb_array_elements_text(p->'similar_question_ids')), '{}'), uid)
  returning id into qid;
  return qid;
end $$;

-- Called after the client uploaded the file to cover-submissions/<uid>/… (storage policy below).
-- p: {book_id? | submission_id?, storage_path, rights_basis, license?, source_url?, attribution?, replaces_image_id?}
create or replace function public.submit_image(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public.tb_require_contributor(); iid uuid;
begin
  perform public.tb_rate_limit(uid, 'image_submissions', 'submitted_by', 'rate_image_submissions_per_hour', 5);
  if split_part(p->>'storage_path', '/', 1) <> uid::text then
    raise exception 'storage_path must be inside your own folder' using errcode = '42501';
  end if;
  insert into public.image_submissions (book_id, submission_id, storage_path, rights_basis, license, source_url,
                                        attribution, replaces_image_id, submitted_by)
  values (p->>'book_id', (p->>'submission_id')::uuid, p->>'storage_path', p->>'rights_basis', p->>'license',
          p->>'source_url', p->>'attribution', (p->>'replaces_image_id')::uuid, uid)
  returning id into iid;
  return iid;
end $$;

-- ---------------------------------------------------------------------------
-- Admin review (server-side role check; every change writes a submission_reviews row)
-- ---------------------------------------------------------------------------

create or replace function public.tb_transition_ok(f public.lifecycle_status, t public.lifecycle_status) returns boolean
language sql immutable set search_path = '' as $$
  select (f, t) in (
    ('pending', 'collecting'), ('pending', 'review'), ('pending', 'rejected'),
    ('collecting', 'review'), ('collecting', 'rejected'),
    ('review', 'collecting'), ('review', 'rejected'),
    ('rejected', 'review'), ('archived', 'review'))
    or (t = 'archived' and f <> 'archived')
  -- 'published' is set only by the release/export step (service role), never by this function.
$$;

-- p: {subject_type, subject_id, action, to_status?, reason?, details?}
--   approve / reject / set_status      book_submission | question_submission | image_submission
--   merge  details {into_book_id | into_submission_id}           book_submission
--   edit   details {changes: {column: value}}                    book_submission (whitelisted columns)
--   exclude_answer / restore_answer    subject_id = answer_ref from feature_evidence
--   block_contributor / unblock_contributor  subject_id = user uuid
--   accept_consensus / dismiss_consensus     subject_id = feature_consensus.id (recorded for the export)
create or replace function public.admin_review(p jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  st public.review_subject := (p->>'subject_type')::public.review_subject;
  sid text := p->>'subject_id';
  act public.review_action := (p->>'action')::public.review_action;
  tbl text;
  cur public.lifecycle_status;
  target public.lifecycle_status := (p->>'to_status')::public.lifecycle_status;
  rid bigint;
  ref text[];
  changes jsonb := p->'details'->'changes';
  editable text[] := array['title', 'author', 'title_ko', 'aliases', 'original_language', 'first_publication_year',
                           'series_title', 'series_number', 'isbn13', 'openlibrary_work_id'];
  col text;
begin
  if me is null or not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if coalesce(btrim(p->>'reason'), '') = '' and act in ('reject', 'merge', 'exclude_answer', 'block_contributor') then
    raise exception 'a reason is required for %', act using errcode = '22023';
  end if;

  if st in ('book_submission', 'question_submission', 'image_submission') then
    tbl := replace(st::text, '_submission', '_submissions');
    execute format('select status from public.%I where id = $1::uuid for update', tbl) into cur using sid;
    if cur is null then raise exception '% % not found', st, sid using errcode = '22023'; end if;

    if act = 'approve' then
      if cur <> 'review' then raise exception 'only items in review can be approved' using errcode = '22023'; end if;
      target := cur;                                   -- stays in review until a release publishes it
    elsif act = 'reject' then
      target := 'rejected';
    elsif act = 'merge' then
      if st <> 'book_submission' then raise exception 'merge applies to book submissions' using errcode = '22023'; end if;
      if num_nonnulls(p->'details'->>'into_book_id', p->'details'->>'into_submission_id') <> 1
         or (p->'details'->>'into_submission_id') = sid then
        raise exception 'merge needs exactly one other details.into_book_id or details.into_submission_id' using errcode = '22023';
      end if;
      target := 'archived';
    elsif act = 'edit' then
      target := cur;
    elsif act = 'set_status' then
      if target is null then raise exception 'set_status needs to_status' using errcode = '22023'; end if;
    else
      raise exception 'action % does not apply to %', act, st using errcode = '22023';
    end if;
    if target is distinct from cur and not public.tb_transition_ok(cur, target) then
      raise exception 'transition % -> % is not allowed', cur, target using errcode = '22023';
    end if;

    insert into public.submission_reviews (subject_type, subject_id, action, from_status, to_status, reason, details, reviewer_id)
    values (st, sid, act, cur, target, p->>'reason', coalesce(p->'details', '{}'), me) returning id into rid;

    execute format('update public.%I set status = $1 where id = $2::uuid', tbl) using target, sid;
    if act = 'approve' then
      execute format('update public.%I set approved_review_id = $1 where id = $2::uuid', tbl) using rid, sid;
    elsif act = 'merge' then
      update public.book_submissions
         set merged_into_book_id = p->'details'->>'into_book_id',
             merged_into_submission_id = (p->'details'->>'into_submission_id')::uuid
       where id = sid::uuid;
    elsif act = 'edit' then
      if jsonb_typeof(changes) <> 'object' or st <> 'book_submission' then
        raise exception 'edit needs details.changes on a book submission' using errcode = '22023';
      end if;
      for col in select jsonb_object_keys(changes) loop
        if col <> all (editable) then raise exception 'column % is not editable', col using errcode = '22023'; end if;
        if col = 'aliases' then
          update public.book_submissions set aliases = array(select jsonb_array_elements_text(changes->'aliases')) where id = sid::uuid;
        else
          execute format('update public.book_submissions set %I = ($1->>%L)::%s where id = $2::uuid', col, col,
                         case when col = 'first_publication_year' then 'int' when col = 'series_number' then 'numeric' else 'text' end)
            using changes, sid;
        end if;
      end loop;
    end if;
    return rid;
  end if;

  insert into public.submission_reviews (subject_type, subject_id, action, reason, details, reviewer_id)
  values (st, sid, act, p->>'reason', coalesce(p->'details', '{}'), me) returning id into rid;

  if st = 'answer' and act in ('exclude_answer', 'restore_answer') then
    ref := string_to_array(sid, ':');                  -- "session:<uuid>:<seq>" | "answer:<id>"
    if act = 'exclude_answer' then
      if ref[1] = 'session' then
        insert into public.answer_exclusions (session_id, seq, review_id) values (ref[2]::uuid, ref[3]::smallint, rid);
      else
        insert into public.answer_exclusions (submission_answer_id, review_id) values (ref[2]::bigint, rid);
      end if;
    else
      update public.answer_exclusions set restored_review_id = rid
       where restored_review_id is null
         and ((ref[1] = 'session' and session_id = ref[2]::uuid and seq = ref[3]::smallint)
           or (ref[1] = 'answer' and submission_answer_id = ref[2]::bigint));
    end if;
  elsif st = 'contributor' and act in ('block_contributor', 'unblock_contributor') then
    insert into public.contributor_status (user_id, blocked, reason) values (sid::uuid, act = 'block_contributor', p->>'reason')
    on conflict (user_id) do update set blocked = excluded.blocked, reason = excluded.reason, updated_at = now();
  elsif st = 'feature_consensus' and act in ('accept_consensus', 'dismiss_consensus') then
    if not exists (select 1 from public.feature_consensus where id = sid::bigint) then
      raise exception 'consensus row % not found', sid using errcode = '22023';
    end if;
  else
    raise exception 'action % does not apply to %', act, st using errcode = '22023';
  end if;
  return rid;
end $$;

-- ---------------------------------------------------------------------------
-- Release sync: load one shipped catalog JSON (src/engine/model.ts Catalog) into the mirror.
-- Service role only (scripts/community_sync.ts). A release is immutable once loaded; book
-- metadata is updated to the newest release that mentions it.
-- ---------------------------------------------------------------------------

create or replace function public.tb_sync_release(cat jsonb, commit_sha text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v text := cat->>'catalog_version';
  b jsonb; q jsonb; e jsonb; s jsonb; f jsonb;
  ord bigint;
  rev int;
  nb int := 0; nq int := 0; nf int := 0;
begin
  if v is null or jsonb_typeof(cat->'books') <> 'array' then
    raise exception 'not a catalog' using errcode = '22023';
  end if;
  if exists (select 1 from public.catalog_releases where version = v) then
    raise exception 'release % is already loaded (releases are immutable)', v using errcode = '23505';
  end if;
  insert into public.catalog_releases (version, data_status, notice, git_commit, meta)
  values (v, cat->>'data_status', cat->>'notice', commit_sha, cat - 'books' - 'questions' - 'features');

  for b in select * from jsonb_array_elements(cat->'books') loop
    insert into public.books (id, title_en, title_ko, aliases, author, original_language, first_publication_year,
                              series_id, series_number, openlibrary_work_id)
    values (b->>'id', b->>'title_en', b->>'title_ko', coalesce(array(select jsonb_array_elements_text(b->'aliases')), '{}'),
            b->>'author', b->>'original_language', (b->>'first_publication_year')::int, b->>'series_id',
            (b->>'series_number')::numeric, b->>'openlibrary_work_id')
    on conflict (id) do update set
      title_en = excluded.title_en, title_ko = excluded.title_ko, aliases = excluded.aliases, author = excluded.author,
      original_language = excluded.original_language, first_publication_year = excluded.first_publication_year,
      series_id = excluded.series_id, series_number = excluded.series_number,
      openlibrary_work_id = excluded.openlibrary_work_id;
    for s, ord in select x.value, x.ordinality from jsonb_array_elements(coalesce(b->'sources', '[]')) with ordinality x loop
      insert into public.sources (book_id, id, url, license, attribution, position)
      values (b->>'id', s->>'id', s->>'url', s->>'license', s->>'attribution', ord)
      on conflict (book_id, id) do update set url = excluded.url, license = excluded.license,
        attribution = excluded.attribution, position = excluded.position;
    end loop;
    for e in select * from jsonb_array_elements(coalesce(b->'editions', '[]')) loop
      if e->>'isbn' is not null then
        insert into public.editions (book_id, isbn13, language, title, source_id)
        values (b->>'id', e->>'isbn', e->>'language', e->>'title', e->>'source_id')
        on conflict (isbn13) do nothing;
      end if;
    end loop;
    insert into public.release_books (catalog_version, book_id, position) values (v, b->>'id', nb);
    nb := nb + 1;
  end loop;

  for q in select * from jsonb_array_elements(cat->'questions') loop
    insert into public.questions (id) values (q->>'id') on conflict (id) do nothing;
    select r.revision into rev from public.question_revisions r
     where r.question_id = q->>'id' and r.text = q->>'text' and r.definition = q->>'definition'
       and r.group_key = coalesce(q->>'group', q->>'id') and r.recallability = (q->>'recallability')::numeric
       and r.adaptation_sensitive = coalesce((q->>'adaptation_sensitive')::boolean, false)
       and r.active = coalesce((q->>'active')::boolean, true)
       and r.category is not distinct from q->>'category'
       and r.inactive_reason is not distinct from q->>'inactive_reason';
    if rev is null then
      select coalesce(max(r.revision), 0) + 1 into rev from public.question_revisions r where r.question_id = q->>'id';
      insert into public.question_revisions (question_id, revision, text, definition, category, group_key, recallability,
                                             adaptation_sensitive, active, inactive_reason)
      values (q->>'id', rev, q->>'text', q->>'definition', q->>'category', coalesce(q->>'group', q->>'id'),
              (q->>'recallability')::numeric, coalesce((q->>'adaptation_sensitive')::boolean, false),
              coalesce((q->>'active')::boolean, true), q->>'inactive_reason');
    end if;
    insert into public.release_questions (catalog_version, question_id, revision, position) values (v, q->>'id', rev, nq);
    nq := nq + 1;
  end loop;

  for f in select * from jsonb_array_elements(cat->'features') loop
    insert into public.book_features (catalog_version, book_id, question_id, p_yes, status, source_ids, reviewed, note,
                                      consensus_id, consensus, position)
    values (v, f->>'book_id', f->>'question_id', (f->>'p_yes')::numeric, (f->>'status')::public.feature_status,
            coalesce(array(select jsonb_array_elements_text(f->'source_ids')), '{}'),
            coalesce((f->>'reviewed')::boolean, false), f->>'note',
            (f->'consensus'->>'consensus_id')::bigint, f->'consensus', nf);
    nf := nf + 1;
  end loop;
  return jsonb_build_object('catalog_version', v, 'books', nb, 'questions', nq, 'features', nf);
end $$;

-- Loads one release back in the exact JSON shape the engine plays (src/engine/model.ts Catalog), so a
-- client can fetch the dataset from Supabase instead of the bundle. Readable by anyone, like the mirror.
-- Book metadata is the newest synced version of each work (books are shared across releases).
create or replace function public.get_release_catalog(release_version text) returns jsonb
language sql stable set search_path = '' as $$
  select r.meta || jsonb_build_object(
    'catalog_version', r.version,
    'data_status', r.data_status,
    'books', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'title_en', b.title_en, 'title_ko', b.title_ko, 'aliases', to_jsonb(b.aliases),
        'author', b.author, 'original_language', b.original_language,
        'first_publication_year', b.first_publication_year, 'series_id', b.series_id,
        'series_number', b.series_number, 'openlibrary_work_id', b.openlibrary_work_id,
        'editions', coalesce((
          select jsonb_agg(jsonb_build_object('isbn', e.isbn13, 'language', e.language, 'title', e.title,
                                              'source_id', e.source_id) order by e.id)
          from public.editions e where e.book_id = b.id), '[]'::jsonb),
        'sources', coalesce((
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', s.id, 'url', s.url, 'license', s.license,
                                                                'attribution', s.attribution)) order by s.position)
          from public.sources s where s.book_id = b.id), '[]'::jsonb)
      ) order by rb.position)
      from public.release_books rb join public.books b on b.id = rb.book_id
      where rb.catalog_version = r.version), '[]'::jsonb),
    'questions', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', q.question_id, 'category', q.category, 'group', q.group_key,
                           'recallability', q.recallability, 'adaptation_sensitive', q.adaptation_sensitive,
                           'text', q.text, 'definition', q.definition)
        || case when q.active then '{}'::jsonb
                else jsonb_strip_nulls(jsonb_build_object('active', false, 'inactive_reason', q.inactive_reason)) end
        order by rq.position)
      from public.release_questions rq
      join public.question_revisions q on q.question_id = rq.question_id and q.revision = rq.revision
      where rq.catalog_version = r.version), '[]'::jsonb),
    'features', coalesce((
      select jsonb_agg(
        jsonb_build_object('book_id', f.book_id, 'question_id', f.question_id, 'p_yes', f.p_yes,
                           'status', f.status, 'source_ids', to_jsonb(f.source_ids), 'reviewed', f.reviewed)
        || jsonb_strip_nulls(jsonb_build_object('note', f.note, 'consensus', f.consensus))
        order by f.position)
      from public.book_features f where f.catalog_version = r.version), '[]'::jsonb))
  from public.catalog_releases r
  where r.version = release_version
$$;

-- Client-callable functions. Everything else (tb_* helpers) is internal. Only this migration's
-- functions are touched, so other objects in the project's public schema keep their grants.
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and (p.proname like 'tb\_%' or p.proname in ('is_admin', 'search_books', 'search_questions',
                  'submit_game_session', 'submit_book', 'submit_feature_answers', 'submit_question',
                  'submit_image', 'admin_review', 'get_release_catalog')) loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;
grant execute on function public.search_books(text, int), public.search_questions(text, int),
  public.get_release_catalog(text) to anon, authenticated;
grant execute on function public.submit_game_session(jsonb), public.submit_book(jsonb),
  public.submit_feature_answers(jsonb), public.submit_question(jsonb), public.submit_image(jsonb),
  public.admin_review(jsonb), public.is_admin() to authenticated;
-- RLS policies call is_admin() and helpers as the querying role:
grant execute on function public.is_admin() to anon;
grant execute on function public.tb_normalize(text), public.tb_isbn13_ok(text) to anon, authenticated;
grant execute on function public.tb_sync_release(jsonb, text) to service_role;

-- ---------------------------------------------------------------------------
-- Storage: private uploads, public approved covers (DECISION D7 decides whether covers ship at all)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cover-submissions', 'cover-submissions', false, 2097152, array['image/jpeg', 'image/png', 'image/webp']),
       ('covers', 'covers', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "upload into own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'cover-submissions' and (storage.foldername(name))[1] = auth.uid()::text
              and not coalesce((select s.blocked from public.contributor_status s where s.user_id = auth.uid()), false));
create policy "read own uploads or admin" on storage.objects for select to authenticated
  using (bucket_id = 'cover-submissions' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
