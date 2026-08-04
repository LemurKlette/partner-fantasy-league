-- Migration: role-Feld fuer Nutzer (Frau/Mann)
-- Datum: 2026-08-05
-- Hinweis: auth.users wird von Supabase verwaltet, eigene Spalten sollten dort
-- nicht direkt angelegt werden. Stattdessen: Begleit-Tabelle "profiles".
-- Die App-Navigation (Frau vs. Mann vs. neu) funktioniert weiterhin ueber die
-- bestehende Erkennung (hat Partner? hat Verbindung?) in loadUserData -- das
-- role-Feld ist die im Konzept geforderte Datenmodell-Erweiterung und steht
-- fuer zukuenftige rollenbasierte Policies/Auswertungen zur Verfuegung.

create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('woman', 'man')),
  created_at timestamptz default now()
);

alter table profiles enable row level security;

create policy "Nutzer sieht eigenes Profil" on profiles for select using (user_id = auth.uid());
create policy "Nutzer legt eigenes Profil an" on profiles for insert with check (user_id = auth.uid());
create policy "Nutzer aktualisiert eigenes Profil" on profiles for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Backfill anhand bestehender Daten
insert into profiles (user_id, role)
select owner_user_id, 'woman' from partners
on conflict (user_id) do nothing;

insert into profiles (user_id, role)
select man_user_id, 'man' from partner_connections
where man_user_id is not null
on conflict (user_id) do nothing;

-- Automatisch role='woman' setzen, sobald ein Partner angelegt wird
create or replace function set_woman_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (user_id, role) values (NEW.owner_user_id, 'woman')
  on conflict (user_id) do nothing;
  return NEW;
end;
$$;

drop trigger if exists trg_set_woman_role on partners;
create trigger trg_set_woman_role
  after insert on partners
  for each row execute function set_woman_role();

-- connect_to_partner erweitert: setzt role='man', sobald ein Code verbunden wird
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

  insert into profiles (user_id, role) values (auth.uid(), 'man')
  on conflict (user_id) do update set role = 'man';
end;
$$;
