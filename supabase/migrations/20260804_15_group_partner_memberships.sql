-- Migration: Partner-Mitgliedschaften pro Gruppe
-- Datum: 2026-08-04
-- Partner muessen explizit einer Gruppe hinzugefuegt werden (aktiv/inaktiv togglebar)

create table group_partner_memberships (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references groups(id) on delete cascade not null,
  partner_id uuid references partners(id) on delete cascade not null,
  active boolean default true not null,
  created_at timestamptz default now(),
  unique(group_id, partner_id)
);

alter table group_partner_memberships enable row level security;

create policy "Mitglieder sehen Partner-Mitgliedschaften"
  on group_partner_memberships for select
  using (
    group_id in (select group_id from group_members where user_id = auth.uid())
  );

create policy "Partner-Eigentuemer fuegt Partner zur Gruppe hinzu"
  on group_partner_memberships for insert
  with check (
    partner_id = any(array(select get_my_partner_ids()))
    and group_id in (select group_id from group_members where user_id = auth.uid())
  );

create policy "Partner-Eigentuemer aktualisiert Mitgliedschaft"
  on group_partner_memberships for update
  using (partner_id = any(array(select get_my_partner_ids())))
  with check (partner_id = any(array(select get_my_partner_ids())));

-- Vorhandene Daten migrieren
insert into group_partner_memberships (group_id, partner_id)
select gm.group_id, p.id
from group_members gm
join partners p on p.owner_user_id = gm.user_id
on conflict (group_id, partner_id) do nothing;
