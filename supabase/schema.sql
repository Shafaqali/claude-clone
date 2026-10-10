create table if not exists public.chats (
  id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New conversation',
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.chats drop constraint if exists chats_pkey;
alter table public.chats add constraint chats_pkey primary key (user_id, id);

create index if not exists chats_user_updated_idx
  on public.chats (user_id, updated_at desc);

alter table public.chats enable row level security;

drop policy if exists "Users can read their own chats" on public.chats;
create policy "Users can read their own chats"
  on public.chats
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own chats" on public.chats;
create policy "Users can insert their own chats"
  on public.chats
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own chats" on public.chats;
create policy "Users can update their own chats"
  on public.chats
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own chats" on public.chats;
create policy "Users can delete their own chats"
  on public.chats
  for delete
  using (auth.uid() = user_id);
