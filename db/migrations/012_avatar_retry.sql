-- Starter avatars that failed because the painter sent a "seed" FLUX doesn't accept go back in the
-- queue (that was our bug, not the images'). Custom orders that failed were already refunded.
update avatar_jobs set status = 'queued', attempts = 0, next_at = now(), last_error = null, updated_at = now()
 where kind = 'catalogue' and status in ('failed', 'queued') and last_error like '%/seed%';
delete from site_settings where key in ('avatars_state_error_catalogue', 'avatars_state_error_custom') and value like '%/seed%';
