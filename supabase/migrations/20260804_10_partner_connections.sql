-- Migration: Partner-Invite-Code System
-- Datum: 2026-08-04

create table if not exists partner_connections (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid references partners(id) not null unique,
  man_user_id uuid references auth.users(id),
  invite_code text unique not null,
  connected_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz default now()
);

alter table partner_connections enable row level security;

create policy "Sieht eigene Verbindungen"
  on partner_connections for select
  using (
    partner_id in (select id from partners where owner_user_id = auth.uid())
    or man_user_id = auth.uid()
  );

create policy "Frau erstellt Verbindung fuer ihren Partner"
  on partner_connections for insert
  with check (
    partner_id in (select id from partners where owner_user_id = auth.uid())
  );

create policy "Mann kann sich disconnecten"
  on partner_connections for update
  using (man_user_id = auth.uid())
  with check (man_user_id = auth.uid());

-- Partner-RLS um Mann-Zugriff erweitern
drop policy if exists "Nutzer sieht eigene und Gruppen-Partner" on partners;
create policy "Nutzer sieht eigene und Gruppen-Partner"
  on partners for select
  using (
    owner_user_id = auth.uid()
    or owner_user_id in (
      select user_id from group_members
      where group_id = any(array(select get_my_group_ids()))
    )
    or id in (
      select partner_id from partner_connections where man_user_id = auth.uid()
    )
  );

-- RPC: Mann verbindet sich mit Partner-Code
create or replace function connect_to_partner(code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conn partner_connections%rowtype;
begin
  select * into v_conn
  from partner_connections
  where invite_code = upper(code);

  if not found then
    raise exception 'Code nicht gefunden. Bitte überprüfe den Code.';
  end if;

  if v_conn.man_user_id is not null and v_conn.man_user_id != auth.uid() then
    raise exception 'Dieser Code ist bereits mit einem anderen Nutzer verbunden.';
  end if;

  update partner_connections
  set man_user_id = auth.uid(), connected_at = now(), disconnected_at = null
  where id = v_conn.id;
end;
$$;

grant execute on function connect_to_partner(text) to authenticated;
