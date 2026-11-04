-- How to reach the buyer about an order (prefilled with their email at checkout), and anything
-- they told us that's needed to deliver it.
alter table orders add column if not exists contact text;
alter table orders add column if not exists note text;
