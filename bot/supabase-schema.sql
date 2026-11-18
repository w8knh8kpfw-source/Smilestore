create table if not exists public.smilestore_products (
 id bigint generated always as identity primary key,
 name text not null,
 description text not null default '',
 category text not null default 'care' check (category in ('brush','paste','floss','mouthwash','irrigator','care')),
 price numeric not null check (price >= 0),
 image_url text not null,
 status text not null default 'available' check (status in ('available','preorder','unavailable')),
 created_at timestamptz not null default now()
);
alter table public.smilestore_products enable row level security;
-- Site access is read-only via anon REST. Admin bot uses service-role key.
create policy "public read products" on public.smilestore_products for select using (true);
insert into storage.buckets (id,name,public) values ('smilestore-images','smilestore-images',true) on conflict (id) do nothing;

-- Safe upgrade for an existing SmileStore catalog.
alter table public.smilestore_products add column if not exists category text not null default 'care';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'smilestore_products_category_check') then
    alter table public.smilestore_products add constraint smilestore_products_category_check check (category in ('brush','paste','floss','mouthwash','irrigator','care'));
  end if;
end $$;
