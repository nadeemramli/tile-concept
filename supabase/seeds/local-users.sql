-- LOCAL DEVELOPMENT ONLY. Sets known passwords for the synthetic demo staff
-- users created by seed.sql so you can log in against the local stack.
-- Never apply this file to a hosted project.
update auth.users
set encrypted_password = extensions.crypt('TileDemo!2026', extensions.gen_salt('bf')), updated_at = now()
where email like 'demo.%@tileconcept.test';
