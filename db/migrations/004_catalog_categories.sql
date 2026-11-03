alter table product_groups
  add column if not exists category text not null default 'Other';
