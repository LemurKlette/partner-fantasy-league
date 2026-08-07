-- Migration: Audit-Punkte 6, 7, 8 und 10
-- Datum: 2026-08-07

-- ═══════════════════════════════════════════════════════════════
-- 6: Tote Emoji-Spalten entfernen
-- ═══════════════════════════════════════════════════════════════
-- Seit Migration 24 laeuft die Icon-Darstellung ueber icon_key und
-- theme/icons.ts. Die alten Emoji-Spalten werden von der App nicht mehr
-- gelesen. ACHTUNG: die enthaltenen Emojis gehen dabei verloren -- sie
-- sind aber ohnehin nicht mehr erreichbar.
alter table badges drop column if exists icon;
alter table point_categories drop column if exists icon;

-- ═══════════════════════════════════════════════════════════════
-- 7: Gruppen umbenennen ermoeglichen
-- ═══════════════════════════════════════════════════════════════
-- Auf groups gab es bisher gar keine UPDATE-Policy, ein Tippfehler im
-- Gruppennamen war damit dauerhaft.
--
-- "using (deleted_at is null)" verhindert nebenbei, dass eine geloeschte
-- Gruppe ueber diesen Weg wieder aktiviert wird; "with check (created_by
-- = auth.uid())" verhindert das Abtreten der Gruppe an jemand anderen.
drop policy if exists "Erstellerin kann Gruppe umbenennen" on groups;
create policy "Erstellerin kann Gruppe umbenennen"
  on groups for update
  using (created_by = auth.uid() and deleted_at is null)
  with check (created_by = auth.uid());

-- ═══════════════════════════════════════════════════════════════
-- 8: Verwaiste Gruppen vermeiden
-- ═══════════════════════════════════════════════════════════════
-- Verliess das letzte Mitglied eine Gruppe, blieb sie mit allen Daten
-- bestehen -- unsichtbar fuer alle und von niemandem mehr loeschbar.
create or replace function leave_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from groups where id = p_group_id and created_by = auth.uid()) then
    raise exception 'Als Erstellerin kannst du die Gruppe nur löschen, nicht verlassen.';
  end if;
  if not exists (select 1 from group_members where group_id = p_group_id and user_id = auth.uid()) then
    raise exception 'Du bist kein Mitglied dieser Gruppe.';
  end if;

  -- Eigene Partner aus der Gruppenwertung nehmen. Die bisherigen
  -- Punkteintraege bleiben als Historie erhalten.
  delete from group_partner_memberships
   where group_id = p_group_id
     and partner_id = any(array(select get_my_partner_ids()));

  delete from group_members where group_id = p_group_id and user_id = auth.uid();

  -- Bleibt niemand uebrig, die Gruppe weich loeschen: sie waere sonst
  -- fuer immer unerreichbar, weil die Uebersicht ueber group_members laeuft.
  if not exists (select 1 from group_members where group_id = p_group_id) then
    update groups set deleted_at = coalesce(deleted_at, now()) where id = p_group_id;
  end if;
end;
$$;

grant execute on function leave_group(uuid) to authenticated;

-- Bestehende mitgliederlose Gruppen nachtraeglich markieren. Sie waren
-- ohnehin fuer niemanden sichtbar, da die Uebersicht ueber group_members geht.
update groups g set deleted_at = now()
where g.deleted_at is null
  and not exists (select 1 from group_members gm where gm.group_id = g.id);

-- ═══════════════════════════════════════════════════════════════
-- 10: profiles.role entfernen
-- ═══════════════════════════════════════════════════════════════
-- Die Spalte wurde per Trigger und RPC gepflegt, aber nirgends zur
-- Autorisierung ausgewertet -- weder in der App noch in einer Policy.
-- Sie suggerierte damit eine Rollenpruefung, die es nie gab. Die
-- Unterscheidung Frau/Mann ergibt sich ausschliesslich aus der Datenlage
-- (eigener Partner vs. Verbindung ueber partner_connections).
--
-- profiles bleibt bestehen: die Spalte timezone wird aktiv genutzt.

drop trigger if exists trg_set_woman_role on partners;
drop function if exists set_woman_role();

-- Funktionen zuerst anpassen, damit sie nicht kurzzeitig auf eine
-- geloeschte Spalte verweisen.
create or replace function set_my_timezone(p_tz text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet.';
  end if;
  if p_tz is null or not exists (select 1 from pg_timezone_names where name = p_tz) then
    raise exception 'Unbekannte Zeitzone: %', p_tz;
  end if;

  insert into profiles (user_id, timezone)
  values (auth.uid(), p_tz)
  on conflict (user_id) do update set timezone = excluded.timezone;
end;
$$;

grant execute on function set_my_timezone(text) to authenticated;

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

alter table profiles drop column if exists role;

-- Kontrolle
-- select column_name from information_schema.columns where table_name = 'profiles';
-- select count(*) from groups g where g.deleted_at is null
--   and not exists (select 1 from group_members gm where gm.group_id = g.id);
