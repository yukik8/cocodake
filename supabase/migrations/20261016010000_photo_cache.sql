-- 2026-10-16 (2): stored Google photo references expire, so they move out of `places`
-- into a cache keyed by Google place ID, refreshed by /api/photo when one stops working.
-- The web release that uses it also works before this runs (the cache then stays empty).

begin;

-- One row per Google place, shared by every user who saved it. photo_ref = null: no photo.
-- RLS on with no policies: only the server (service role) reads and writes it.
create table if not exists place_photos (
  place_id text primary key,
  photo_ref text,
  fetched_at timestamptz not null default now()
);
alter table place_photos enable row level security;

-- /api/photo only looks up places someone saved
create index if not exists places_place_id_idx on places(place_id) where place_id is not null;

-- Saved places show their photo by place ID; drop the expired references stored in them.
-- (photo_url stays non-null: it records that the place has a photo.)
update places
set photo_url = '/api/photo?place_id=' || place_id
where place_id is not null
  and photo_url is not null
  and photo_url is distinct from '/api/photo?place_id=' || place_id;

commit;
