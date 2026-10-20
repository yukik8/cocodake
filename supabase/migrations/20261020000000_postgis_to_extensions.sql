-- 2026-10-20: PostGIS was installed in the public schema, so its reference table
-- public.spatial_ref_sys was exposed through the API without RLS: anyone with the anon key
-- could read, change or delete it (checked: update and delete were allowed), and the
-- table belongs to an admin role, so its privileges can't be revoked from here.
-- Move PostGIS to the extensions schema, which the API does not expose. PostGIS can't
-- change schema in place, so the geom column (derived from lat/lng, not read by the app)
-- is dropped and recreated.

begin;

drop index if exists places_geom_idx;
alter table places drop column if exists geom;
-- The 2026-10-16 backup (CREATE TABLE … AS) copied geom as a plain geometry column; it is
-- derived from lat/lng, so drop it there too. The backup's other columns stay.
alter table if exists backup.places_20261016 drop column if exists geom;
-- fails, and rolls everything back, if anything else still depends on PostGIS
drop extension if exists postgis;
create schema if not exists extensions;
create extension postgis with schema extensions;

alter table places
  add column geom extensions.geometry(Point, 4326)
  generated always as (extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)) stored;
create index places_geom_idx on places using gist (geom);

commit;
