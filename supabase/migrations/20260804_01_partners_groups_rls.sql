-- Migration: Partners, Groups, Group Members + RLS
-- Datum: 2026-08-04

create table if not exists partners (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id) not null,
  name text not null,
  created_at timestamptz default now()
);

alter table partners enable row level security;

create policy "Nutzer sieht nur eigene Partner"
  on partners for select
  using (auth.uid() = owner_user_id);

create policy "Nutzer kann eigenen Partner anlegen"
  on partners for insert
  with check (auth.uid() = owner_user_id);

-- Groups
create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users(id) not null,
  invite_code text unique not null,
  created_at timestamptz default now()
);

create table if not exists group_members (
  group_id uuid references groups(id) not null,
  user_id uuid references auth.users(id) not null,
  joined_at timestamptz default now(),
  primary key (group_id, user_id)
);

alter table groups enable row level security;
alter table group_members enable row level security;

create policy "Ersteller und Mitglieder sehen Gruppe"
  on groups for select
  using (
    auth.uid() = created_by
    or exists (
      select 1 from group_members
      where group_members.group_id = groups.id
      and group_members.user_id = auth.uid()
    )
  );

create policy "Eingeloggte Nutzer können Gruppe erstellen"
  on groups for insert
  with check (auth.uid() = created_by);

create policy "Mitglieder sehen Gruppenmitglieder"
  on group_members for select
  using (user_id = auth.uid());

create policy "Nutzer kann Gruppe beitreten"
  on group_members for insert
  with check (user_id = auth.uid());
