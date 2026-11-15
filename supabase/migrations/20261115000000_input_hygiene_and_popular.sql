-- Bookinator — input hygiene for free-text contributions + "most found books" for the start screen.
--
-- 1. Free text typed by readers (book title, author, …) is stored as plain text and escaped on output
--    by the UI. Here the database itself removes control / invisible / bidi-override characters,
--    collapses whitespace and caps lengths, so a client that skips the web form cannot store them.
-- 2. popular_books(): how many different contributors confirmed each book. Counts only; no raw rows.

create or replace function public.tb_clean_text(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select nullif(btrim(regexp_replace(
    regexp_replace(coalesce(t, ''), '[\u0001-\u001F\u007F-\u009F​-‏ -‮⁠-⁩﻿]', ' ', 'g'),
    '\s+', ' ', 'g')), '')
$$;

create or replace function public.tb_book_submissions_clean() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.title := public.tb_clean_text(new.title);
  new.author := public.tb_clean_text(new.author);
  new.title_ko := public.tb_clean_text(new.title_ko);
  new.series_title := public.tb_clean_text(new.series_title);
  new.original_language := public.tb_clean_text(new.original_language);
  new.reason := nullif(btrim(new.reason), '');
  new.aliases := coalesce(array(select public.tb_clean_text(a) from unnest(new.aliases) a
                                where public.tb_clean_text(a) is not null), '{}');
  if length(new.title) > 300 or length(new.author) > 200 or length(new.title_ko) > 300
     or length(new.series_title) > 300 or length(new.original_language) > 35
     or cardinality(new.aliases) > 10 or exists (select 1 from unnest(new.aliases) a where length(a) > 300)
     or length(new.proposed_changes::text) > 4000 then
    raise exception 'submitted text is too long' using errcode = '22023';
  end if;
  return new;
end $$;
-- Named to sort before book_submissions_search_text, so the search text is built from the cleaned values.
create trigger book_submissions_clean before insert or update on public.book_submissions
  for each row execute function public.tb_book_submissions_clean();

create or replace function public.tb_question_submissions_clean() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.keyword := coalesce(public.tb_clean_text(new.keyword), '');
  new.text := coalesce(public.tb_clean_text(new.text), '');
  new.category := public.tb_clean_text(new.category);
  if length(new.category) > 60 then
    raise exception 'submitted text is too long' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger question_submissions_clean before insert or update on public.question_submissions
  for each row execute function public.tb_question_submissions_clean();

-- Books readers found most often (confirmed from a guess or the shortlist). One count per contributor
-- and book, blocked contributors skipped. Empty until readers share their games.
create or replace function public.popular_books(release_version text default null, max_results int default 10)
returns table (book_id text, title_en text, title_ko text, author text, found_count bigint)
language sql stable security definer set search_path = '' as $$
  select b.id, b.title_en, b.title_ko, b.author, count(distinct g.contributor_id)
  from public.game_sessions g
  join public.books b on b.id = g.confirmed_book_id
  left join public.contributor_status cs on cs.user_id = g.contributor_id
  where not coalesce(cs.blocked, false)
    and (release_version is null or g.catalog_version = release_version)
  group by b.id
  order by count(distinct g.contributor_id) desc, b.id
  limit least(greatest(max_results, 1), 20)
$$;

revoke execute on function public.tb_clean_text(text), public.tb_book_submissions_clean(),
  public.tb_question_submissions_clean(), public.popular_books(text, int) from public, anon, authenticated;
grant execute on function public.popular_books(text, int) to anon, authenticated;
