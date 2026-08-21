-- Corpus migration 7/7 — close the advisor findings the previous six introduced.
--
-- Running the Supabase security advisors before and after the corpus migrations
-- showed ten new WARN findings and no ERROR. Six of them are the expected
-- "a SECURITY DEFINER function is executable by authenticated" note, which is
-- the whole point of those functions. The other four are worth fixing:
--
--   1. ingest.reject_mutation was created without a fixed search_path. It runs
--      as a trigger on append-only tables, so it should not resolve anything
--      through a caller-controlled path.
--   2. api.approve_certificate_candidate, api.approve_media_link, and
--      api.publish_product_media were granted to `authenticated` without first
--      revoking the default PUBLIC execute, so the advisor correctly reported
--      them as anon-executable. They each check core.require_permission before
--      doing anything, and `anon` has no usage on the api schema, so this was
--      defence in depth rather than an exposure - but it costs nothing to close.

create or replace function ingest.reject_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'ingest.% is append-only; record a superseding decision instead', tg_table_name
    using errcode = '0A000';
end $$;
revoke all on function ingest.reject_mutation() from public;

revoke all on function api.approve_certificate_candidate(uuid, jsonb, text) from public;
grant execute on function api.approve_certificate_candidate(uuid, jsonb, text) to authenticated;

revoke all on function api.approve_media_link(uuid, uuid, text) from public;
grant execute on function api.approve_media_link(uuid, uuid, text) to authenticated;

revoke all on function api.publish_product_media(uuid, text, int, boolean) from public;
grant execute on function api.publish_product_media(uuid, text, int, boolean) to authenticated;
