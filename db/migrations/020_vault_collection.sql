-- Update 19: one avatar collection, limited editions, cleaner images, no shop admins.

-- Legendary characters are simply Legendary: no second rarity tag. Prices that were never
-- changed from their old rarity default become the Legendary price ($19.99).
alter table legends drop constraint if exists legends_rarity_check;
update legends set price_cents = 1999 where buyable and price_cents in (0, 199, 499, 1499);
update legends set rarity = 'legendary';
alter table legends alter column rarity set default 'legendary';

-- Limited editions: an avatar can have a fixed number of copies (1 = one of one).
-- Rare avatars become limited: 10 copies each to start (or however many are already sold).
alter table avatars add column if not exists supply integer check (supply is null or supply >= 0);
update avatars a set supply = greatest(10, (select count(*) from user_items i where i.item_id = 'av:' || a.id and not i.is_test))
 where a.collection = 'starter' and a.tier = 'rare' and a.supply is null;

-- Pictures from the backup painter carry its watermark: they are trimmed once (lib/avatars).
alter table avatars add column if not exists wm_trimmed boolean not null default false;

-- The shop's catalog editors have nothing left to edit.
update users set is_admin = false where is_admin and admin_role not in ('god', 'finance');
