-- Migration: Badges-System
-- Datum: 2026-08-04

alter table point_categories add column if not exists category_tag text;

update point_categories set category_tag = 'haushalt'
  where name in ('Geschirrspüler ein-/ausräumen', 'Wäsche waschen & aufhängen', 'Putzen (Bad/Küche)');
update point_categories set category_tag = 'romantik'
  where name in ('Blumen/Überraschung ohne Anlass', 'Komplimente, die sitzen', 'Date-Night organisiert', 'Handschriftliche Nachricht');
update point_categories set category_tag = 'verlaesslichkeit'
  where name in ('Termin pünktlich & vorbereitet', 'Zugehört ohne Handy', 'Konflikt fair & ruhig gelöst');

create table if not exists badges (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  icon text not null,
  trigger_type text not null,  -- 'total_points', 'category_points', 'week_points', 'month_points'
  trigger_value integer not null,
  category_filter text,        -- category_tag-Wert fuer 'category_points'-Badges
  created_at timestamptz default now()
);

alter table badges enable row level security;
create policy "Alle sehen Badges" on badges for select using (true);

insert into badges (name, description, icon, trigger_type, trigger_value, category_filter) values
('Haushalt-Hero', 'Hat 100 Punkte in Haushalt-Kategorien gesammelt', '🏠', 'category_points', 100, 'haushalt'),
('Romantik-Champion', 'Hat 50 Punkte in Romantik-Kategorien gesammelt', '💕', 'category_points', 50, 'romantik'),
('Zuverlässiger Partner', 'Hat 75 Punkte in Verlässlichkeits-Kategorien gesammelt', '⏰', 'category_points', 75, 'verlaesslichkeit'),
('Legende', 'Hat insgesamt 200 Punkte gesammelt', '👑', 'total_points', 200, null),
('Wochenstar', 'Hat in einer Woche 50 Punkte gesammelt', '⭐', 'week_points', 50, null),
('Monatsstar', 'Hat in einem Monat 100 Punkte gesammelt', '🌟', 'month_points', 100, null);

create table if not exists partner_badges (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references partners(id) not null,
  badge_id uuid references badges(id) not null,
  earned_at timestamptz default now(),
  group_id uuid references groups(id) not null,
  unique(partner_id, badge_id, group_id)
);

alter table partner_badges enable row level security;

create policy "Mitglieder sehen Badges ihrer Gruppe"
  on partner_badges for select
  using (group_id = any(array(select get_my_group_ids())));

create policy "Mitglieder koennen Badges vergeben"
  on partner_badges for insert
  with check (group_id = any(array(select get_my_group_ids())));
