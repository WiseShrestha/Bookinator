-- The research catalog now carries cells labelled from an AI assistant's general knowledge (no source).
-- They are stored like any other published cell; the UI never shows them as source-checked.
alter type public.feature_status add value if not exists 'ai_recall';

-- Series targets: a book row may list its volumes ({id, title, number}); the reader confirms the series
-- and then picks the volume. Stored as shipped, returned only when present, so older releases round-trip
-- unchanged. The original functions keep their bodies under a _v1 name and are wrapped.
alter table public.books add column if not exists volumes jsonb;

alter function public.tb_sync_release(jsonb, text) rename to tb_sync_release_v1;
alter function public.get_release_catalog(text) rename to get_release_catalog_v1;

create function public.tb_sync_release(cat jsonb, commit_sha text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare res jsonb;
begin
  res := public.tb_sync_release_v1(cat, commit_sha);
  update public.books bk set volumes = b.value->'volumes'
    from jsonb_array_elements(cat->'books') b
   where bk.id = b.value->>'id' and jsonb_typeof(b.value->'volumes') = 'array';
  return res;
end $$;

create function public.get_release_catalog(release_version text) returns jsonb
language sql stable set search_path = '' as $$
  select case when x.c is null then null else jsonb_set(x.c, '{books}', coalesce((
    select jsonb_agg(case when bk.volumes is null then e.value else e.value || jsonb_build_object('volumes', bk.volumes) end
                     order by e.ordinality)
    from jsonb_array_elements(x.c->'books') with ordinality e
    join public.books bk on bk.id = e.value->>'id'), '[]'::jsonb)) end
  from (select public.get_release_catalog_v1(release_version) as c) x
$$;

revoke execute on function public.tb_sync_release(jsonb, text), public.get_release_catalog(text) from public, anon, authenticated;
grant execute on function public.tb_sync_release(jsonb, text) to service_role;
grant execute on function public.get_release_catalog(text) to anon, authenticated;
