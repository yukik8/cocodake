-- Enable PostGIS extension for spatial queries
create extension if not exists postgis;

-- Places table: stores all imported/added spots
create table if not exists places (
  id uuid primary key default gen_random_uuid(),
  user_session text not null,           -- simple session ID (no auth MVP)
  name text,
  url text,
  lat double precision not null,
  lng double precision not null,
  address text,
  category text,
  rating double precision,
  photo_url text,
  note text,
  enriched boolean default false,
  created_at timestamptz default now(),
  geom geometry(Point, 4326) generated always as (ST_SetSRID(ST_MakePoint(lng, lat), 4326)) stored
);

create index if not exists places_user_session_idx on places(user_session);
create index if not exists places_geom_idx on places using gist(geom);

-- Shared lists table: snapshot of places for a share URL
create table if not exists shared_lists (
  id uuid primary key default gen_random_uuid(),
  title text,
  place_ids uuid[] not null,
  places_snapshot jsonb not null,       -- denormalized snapshot so shares don't break
  expires_at timestamptz,
  created_at timestamptz default now()
);
