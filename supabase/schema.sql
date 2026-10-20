-- Schema for a fresh project. An existing project: run supabase/migrations/ in order instead.

-- Enable PostGIS extension for spatial queries. It goes in the extensions schema: in public,
-- its spatial_ref_sys table would be exposed through the API without RLS.
create extension if not exists postgis schema extensions;

-- Places table: stores all imported/added spots
create table if not exists places (
  id uuid primary key default gen_random_uuid(),
  user_session text not null,           -- auth.users.id of the owner
  place_id text,                        -- Google place ID, when known
  name text,
  url text,
  source_url text,                      -- the URL as written in an imported Takeout file
  lat double precision not null,
  lng double precision not null,
  address text,
  category text,
  rating double precision,
  photo_url text,                       -- /api/photo?place_id=… (or ?ref=… without a place ID); never the API key
  note text,
  enriched boolean default false,
  created_at timestamptz default now(),
  geom extensions.geometry(Point, 4326)
    generated always as (extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)) stored
);

create index if not exists places_user_session_idx on places(user_session);
create index if not exists places_user_created_idx on places(user_session, created_at desc, id);
create index if not exists places_geom_idx on places using gist(geom);
-- one row per Google place per user (rows without place_id are not affected: NULLs are distinct)
create unique index if not exists places_user_place_id_key on places(user_session, place_id);
create index if not exists places_place_id_idx on places(place_id) where place_id is not null;

-- Shared lists table: snapshot of places for a share URL
create table if not exists shared_lists (
  id uuid primary key default gen_random_uuid(),
  user_session text,                    -- owner (auth.users.id); used to delete shares with the account
  title text,
  place_ids uuid[] not null,
  places_snapshot jsonb not null,       -- denormalized snapshot so shares don't break; public fields only
  expires_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists shared_lists_user_session_idx on shared_lists(user_session);

-- Current Google photo reference per Google place, shared by all users; refreshed by
-- /api/photo when a reference expires. photo_ref = null: the place has no photo.
create table if not exists place_photos (
  place_id text primary key,
  photo_ref text,
  fetched_at timestamptz not null default now()
);
