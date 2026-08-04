-- Migration: Punktekategorien und Punkteeinträge
-- Datum: 2026-08-04

create table if not exists point_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  points integer not null,
  icon text default '⭐',
  is_global boolean default true,
  created_at timestamptz default now()
);

alter table point_categories enable row level security;

create policy "Alle können Kategorien sehen"
  on point_categories for select using (true);

-- Standard-Kategorien
insert into point_categories (name, points, icon) values
('Geschirrspüler ein-/ausräumen', 5, '🍽️'),
('Wäsche waschen & aufhängen', 10, '👕'),
('Putzen (Bad/Küche)', 15, '🧹'),
('Kochen', 10, '🍳'),
('Aufwendiges Menü kochen', 20, '👨‍🍳'),
('Einkaufen ohne Erinnerung', 10, '🛒'),
('Müll rausbringen ohne Aufforderung', 5, '🗑️'),
('Blumen/Überraschung ohne Anlass', 15, '💐'),
('Komplimente, die sitzen', 5, '💬'),
('Date-Night organisiert', 20, '🌙'),
('Geburtstag/Jahrestag perfekt gemeistert', 30, '🎂'),
('Handschriftliche Nachricht', 15, '💌'),
('Termin pünktlich & vorbereitet', 10, '⏰'),
('Kinderbetreuung übernommen', 15, '👶'),
('Zugehört ohne Handy', 10, '👂'),
('Konflikt fair & ruhig gelöst', 15, '🤝');

-- Punkteeinträge
create table if not exists point_entries (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references partners(id) not null,
  group_id uuid references groups(id) not null,
  category_id uuid references point_categories(id) not null,
  points integer not null,
  note text,
  created_by uuid references auth.users(id) not null,
  created_at timestamptz default now()
);

alter table point_entries enable row level security;

create policy "Mitglieder sehen Einträge ihrer Gruppe"
  on point_entries for select
  using (group_id = any(array(select get_my_group_ids())));

create policy "Mitglieder können Punkte vergeben"
  on point_entries for insert
  with check (
    auth.uid() = created_by
    and group_id = any(array(select get_my_group_ids()))
  );
