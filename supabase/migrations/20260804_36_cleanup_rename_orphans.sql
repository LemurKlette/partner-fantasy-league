-- Migration: Audit-Punkte 6, 7, 8 und 10
-- Datum: 2026-08-07

-- ═══════════════════════════════════════════════════════════════
-- 6: Tote Emoji-Spalten entfernen
-- ═══════════════════════════════════════════════════════════════
-- Seit Migration 24 laeuft die Icon-Darstellung ueber icon_key und
-- theme/icons.ts. Die alten Emoji-Spalten werden von der App nicht mehr
-- gelesen (geprueft: nur icon_key kommt in App.tsx und BadgeGrid.tsx vor)
-- und beim Anlegen eigener Kategorien auch nicht mehr geschrieben.
-- ACHTUNG: die enthaltenen Emojis gehen dabei verloren -- sie sind aber
-- ohnehin nicht mehr erreichbar.
alter table badges drop column if exists icon;
alter table point_categories drop column if exists icon;

-- ═══════════════════════════════════════════════════════════════
-- 7: Gruppen umbenennen ermoeglichen
-- ═══════════════════════════════════════════════════════════════
-- Auf groups gab es bisher gar keine UPDATE-Moeglichkeit, ein Tippfehler
-- im Gruppennamen war damit dauerhaft.
--
-- Bewusst als RPC und *nicht* als UPDATE-Policy: eine Policy wirkt immer
-- auf die ganze Zeile, RLS kann keine einzelnen Spalten schuetzen. Die
-- Erstellerin haette damit auch invite_code und created_at aendern
-- koennen -- ein neuer Code haette allen Mitgliedern still den
-- Einladungslink entwertet. Die RPC schreibt ausschliesslich name und
-- folgt damit dem Muster von delete_group() und leave_group().
create or replace function rename_group(p_group_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := trim(p_name);
begin
  if v_name = '' or v_name is null then
    raise exception 'Bitte gib einen Gruppennamen ein.';
  end if;

  -- "deleted_at is null" verhindert nebenbei, dass eine geloeschte Gruppe
  -- ueber diesen Weg noch angefasst wird.
  update groups set name = v_name
   where id = p_group_id
     and created_by = auth.uid()
     and deleted_at is null;

  if not found then
    raise exception 'Nur die Erstellerin kann die Gruppe umbenennen.';
  end if;
end;
$$;

grant execute on function rename_group(uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 8: Verwaiste Gruppen vermeiden
-- ═══════════════════════════════════════════════════════════════
-- Verliess das letzte Mitglied eine Gruppe, blieb sie mit allen Daten
-- bestehen -- unsichtbar fuer alle und von niemandem mehr loeschbar.
-- Betrifft nur Gruppen ohne Erstellerin (created_by is null, siehe
-- Migration 33): solange die Erstellerin drin ist, kann sie nicht
-- verlassen, sondern nur loeschen.
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

-- Dieselbe Luecke hat delete_account(): Schritt 6 loescht alle
-- Mitgliedschaften der Person, ohne die betroffenen Gruppen danach zu
-- pruefen. Selbst erstellte Gruppen werden in Schritt 1 markiert -- war
-- sie dagegen in einer fremden Gruppe das letzte verbliebene Mitglied
-- (moeglich, wenn die Erstellerin selbst nie in group_members stand),
-- blieb dieselbe unerreichbare Karteileiche zurueck.
create or replace function delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_partner_ids uuid[];
  v_group_ids uuid[];
begin
  if v_user_id is null then
    raise exception 'Nicht angemeldet.';
  end if;

  select array_agg(id) into v_partner_ids from partners where owner_user_id = v_user_id;
  -- Vor dem Loeschen merken, welche Gruppen anschliessend zu pruefen sind.
  select array_agg(group_id) into v_group_ids from group_members where user_id = v_user_id;

  -- 1. Selbst erstellte Gruppen nur markieren und die Urheberschaft loesen.
  --    Die Eintraege der anderen Mitglieder bleiben erhalten, sonst wuerden
  --    deren Partner Badge-Punkte verlieren.
  update groups set deleted_at = coalesce(deleted_at, now()), created_by = null
   where created_by = v_user_id;

  -- 2. Eigene Partner samt aller abhaengigen Daten
  if v_partner_ids is not null then
    delete from point_entries where partner_id = any(v_partner_ids);
    delete from partner_badges where partner_id = any(v_partner_ids);
    delete from partner_connections where partner_id = any(v_partner_ids);
    delete from group_partner_memberships where partner_id = any(v_partner_ids);
    delete from partners where id = any(v_partner_ids);
  end if;

  -- 3. Eigene Eintraege in fremden Gruppen (created_by ist NOT NULL, muss
  --    also weg, bevor der auth-User geloescht wird)
  delete from point_entries where created_by = v_user_id;

  -- 4. Selbst angelegte Gruppenkategorien bleiben erhalten, nur die
  --    Urheberschaft wird geloest
  update point_categories set created_by = null where created_by = v_user_id;

  -- 5. Verbindungen, in denen die Person der Mann war
  update partner_connections
     set man_user_id = null, connected_at = null, disconnected_at = now()
   where man_user_id = v_user_id;

  -- 6. Restliche Mitgliedschaften und der Account selbst
  delete from group_members where user_id = v_user_id;

  -- 6a. Gruppen, die dadurch ohne Mitglieder dastehen, weich loeschen.
  if v_group_ids is not null then
    update groups g set deleted_at = coalesce(g.deleted_at, now())
     where g.id = any(v_group_ids)
       and not exists (select 1 from group_members gm where gm.group_id = g.id);
  end if;

  delete from profiles where user_id = v_user_id;
  delete from auth.users where id = v_user_id;
end;
$$;

grant execute on function delete_account() to authenticated;

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
-- select column_name from information_schema.columns
--   where table_name in ('badges', 'point_categories') and column_name = 'icon';
-- select count(*) from groups g where g.deleted_at is null
--   and not exists (select 1 from group_members gm where gm.group_id = g.id);
