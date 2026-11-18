create table if not exists public.smilestore_products (
 id bigint generated always as identity primary key,
 name text not null,
 description text not null default '',
 price numeric not null check (price >= 0),
 image_url text not null,
 status text not null default 'available' check (status in ('available','preorder','unavailable')),
 created_at timestamptz not null default now()
);
alter table public.smilestore_products enable row level security;
-- Site access is read-only via anon REST. Admin bot uses service-role key.
create policy "public read products" on public.smilestore_products for select using (true);
insert into storage.buckets (id,name,public) values ('smilestore-images','smilestore-images',true) on conflict (id) do nothing;
