-- The "Not Found" form lets a reader leave the author blank ("leave blank if unsure"): a new-book
-- submission needs only a title. A reviewer adds the author before the book can join a release
-- (scripts/community_lib.ts refuses to export a book without one).

do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.book_submissions'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%author IS NOT NULL%' loop
    execute format('alter table public.book_submissions drop constraint %I', c);
  end loop;
end $$;
alter table public.book_submissions
  add constraint book_submissions_new_book_title check (kind <> 'new_book' or title is not null);

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
     or length(btrim(coalesce(p->>'author', ''))) > 200 then
    raise exception 'title (1-300) is required; author is optional (up to 200)' using errcode = '22023';
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
    (p->>'origin_session_id')::uuid, btrim(p->>'title'), nullif(btrim(p->>'author'), ''), nullif(btrim(p->>'title_ko'), ''),
    coalesce(array(select jsonb_array_elements_text(p->'aliases')), '{}'), nullif(p->>'original_language', ''),
    (p->>'first_publication_year')::int, nullif(p->>'series_title', ''), (p->>'series_number')::numeric, isbn, olid,
    p->>'reason', uid,
    coalesce(array(select c->>'id' from jsonb_array_elements(cands) c where c->>'kind' = 'book'), '{}'),
    coalesce(array(select (c->>'id')::uuid from jsonb_array_elements(cands) c where c->>'kind' = 'submission'), '{}'))
  returning id into sid;
  return jsonb_build_object('status', 'created', 'submission_id', sid,
                            'flagged_possible_duplicates', jsonb_array_length(cands) > 0);
end $$;
