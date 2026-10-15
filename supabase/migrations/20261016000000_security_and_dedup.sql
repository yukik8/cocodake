-- 2026-10-16: security fixes and duplicate prevention.
-- Run once in the Supabase SQL editor BEFORE deploying the matching web release
-- (the new code writes shared_lists.user_session and places.source_url, and relies on
-- the unique index for ON CONFLICT).
--
-- Optional check first — duplicates that step 4 will merge:
--   select user_session, place_id, count(*) from places
--   where place_id is not null group by 1, 2 having count(*) > 1;

begin;

-- 1. Share links: never readable with the public anon key; only the server reads them.
drop policy if exists "anyone can read shared_lists" on shared_lists;
drop policy if exists "authenticated users can insert shared_lists" on shared_lists;
alter table shared_lists enable row level security;

-- Owner of a share, so deleting an account deletes its shares
alter table shared_lists add column if not exists user_session text;
create index if not exists shared_lists_user_session_idx on shared_lists(user_session);

-- 2. Old snapshots held every column of each place, including the owner's user ID and
--    private note, and photo URLs with the Google API key. Keep only the public fields.
update shared_lists s
set places_snapshot = (
  select coalesce(
    jsonb_agg(
      case
        when e.elem->>'photo_url' like 'https://maps.googleapis.com/maps/api/place/photo%'
          then jsonb_set(
            e.elem - 'user_session' - 'note' - 'enriched' - 'created_at' - 'geom',
            '{photo_url}',
            coalesce(
              to_jsonb('/api/photo?ref=' || substring(e.elem->>'photo_url' from 'photo_reference=([A-Za-z0-9_-]+)')),
              'null'::jsonb
            )
          )
        else e.elem - 'user_session' - 'note' - 'enriched' - 'created_at' - 'geom'
      end
      order by e.ord
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(s.places_snapshot) with ordinality as e(elem, ord)
)
where jsonb_typeof(s.places_snapshot) = 'array';

-- 3. Places: photo URLs that embed the Google API key → our /api/photo proxy
update places
set photo_url = case
  when substring(photo_url from 'photo_reference=([A-Za-z0-9_-]+)') is not null
    then '/api/photo?ref=' || substring(photo_url from 'photo_reference=([A-Za-z0-9_-]+)')
  else null
end
where photo_url like 'https://maps.googleapis.com/maps/api/place/photo%';

-- 4. One row per Google place per user. place_id is used by the app but was missing from
--    the old schema file; add it if this database doesn't have it.
alter table places add column if not exists place_id text;
alter table places add column if not exists source_url text;

-- Merge existing duplicates: keep the oldest row, carry over a note it lacks, delete the rest
update places keep
set note = d.note
from (
  select distinct on (user_session, place_id) user_session, place_id, note
  from places
  where place_id is not null and note is not null
  order by user_session, place_id, created_at, id
) d
where keep.user_session = d.user_session
  and keep.place_id = d.place_id
  and keep.note is null;

delete from places a
using places b
where a.user_session = b.user_session
  and a.place_id is not null
  and a.place_id = b.place_id
  and (a.created_at, a.id) > (b.created_at, b.id);

create unique index if not exists places_user_place_id_key on places(user_session, place_id);
create index if not exists places_user_created_idx on places(user_session, created_at desc, id);

commit;
