-- Kohler Pass perks on avatars, and avatars the owner makes by hand (AI or upload).
alter table avatars add column if not exists pass_free boolean not null default false;   -- free to wear with an active Pass
alter table avatars add column if not exists source text not null default 'factory';    -- factory | admin-ai | upload | custom
update avatars set source = 'custom' where collection = 'custom' and source = 'factory';

-- Rare avatars are collector pieces: a spread of prices and copies, from $49.99 (25 copies)
-- up to $999 (one of one). Only prices still at the old $2.99 default change; never below copies sold.
with ladder as (
  select a.id, abs(hashtext(a.id::text)) % 20 as k,
         (select count(*) from user_items i where i.item_id = 'av:' || a.id and not i.is_test)::int as sold
    from avatars a where a.collection = 'starter' and a.tier = 'rare' and a.price_cents = 299)
update avatars a set
  price_cents = case when l.k = 0 then 99900 when l.k <= 2 then 49900 when l.k <= 6 then 19900 when l.k <= 12 then 9900 else 4999 end,
  supply = greatest(l.sold, case when l.k = 0 then 1 when l.k <= 2 then 3 when l.k <= 6 then 5 when l.k <= 12 then 10 else 25 end)
  from ladder l where l.id = a.id;
