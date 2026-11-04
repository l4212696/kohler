-- The starter collection now comes from your own list of 100 characters (lib/avatars/style.js,
-- STARTER). Starter jobs that never produced a picture are dropped and replanned from that list,
-- and any stored "painter refused" state is cleared so painting retries straight away.
delete from avatar_jobs where kind = 'catalogue' and status in ('queued', 'failed');
delete from site_settings where key like 'avatars\_state\_%';
insert into site_settings (key, value) values ('avatars_backup_next_at', '') on conflict (key) do nothing;
