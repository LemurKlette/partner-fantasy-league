-- Migration: Sicherheits- und Fehlerbehebungen (Punkte 1-5 des Audits)
-- Datum: 2026-08-06

-- ═══════════════════════════════════════════════════════════════
-- FIX 1: Maennerprofil zeigte keine Badges
-- ═══════════════════════════════════════════════════════════════
-- Ursache: partner_badges und point_entries waren nur ueber
-- get_my_group_ids() lesbar. Maenner stehen aber nie in group_members,
-- sondern haengen ueber partner_connections dran -> beide Queries in
-- BadgeGrid lieferten leer, alle Badges erschienen gesperrt mit 0
-- Fortschritt.

drop policy if exists "Mitglieder sehen Badges ihrer Gruppe" on partner_badges;
create policy "Badges eigener Gruppen und verbundener Partner sichtbar"
  on partner_badges for select
  using (
    group_id = any(array(select get_my_group_ids()))
    or partner_id = any(array(select get_my_partner_ids()))
    or partner_id = any(array(select get_my_connected_partner_ids()))
  );

-- point_entries wird BEWUSST NICHT fuer Maenner geoeffnet: die Tabelle
-- enthaelt die Notizen der Frauen ("note"), die privat bleiben sollen.
-- Stattdessen liefert diese Funktion nur die Summen, die die
-- Badge-Ansicht fuer Fortschrittsbalken braucht.
create or replace function partner_point_totals(p_partner_id uuid)
returns table (category_tag text, total integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    p_partner_id = any(array(select get_my_partner_ids()))
    or p_partner_id = any(array(select get_my_connected_partner_ids()))
    or exists (
      select 1 from group_partner_memberships gpm
      where gpm.partner_id = p_partner_id
        and gpm.group_id = any(array(select get_my_group_ids()))
    )
  ) then
    raise exception 'Kein Zugriff auf diesen Partner.';
  end if;

  return query
    select pc.category_tag, coalesce(sum(pe.points), 0)::integer
    from point_entries pe
    join point_categories pc on pc.id = pe.category_id
    where pe.partner_id = p_partner_id
    group by pc.category_tag;
end;
$$;

grant execute on function partner_point_totals(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- FIX 2: delete_account schlug immer fehl
-- ═══════════════════════════════════════════════════════════════
-- Ursachen: (a) es wurde nur EIN Partner beruecksichtigt, obwohl
-- Nutzerinnen mehrere haben koennen; (b) partner_connections,
-- partner_badges und point_entries referenzieren partners ohne
-- ON DELETE CASCADE -> Fremdschluesselverletzung; (c) erstellte
-- Gruppen, Kategorien und Verbindungen blieben als Waisen zurueck.

create or replace function delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_partner_ids uuid[];
  v_group_id uuid;
begin
  if v_user_id is null then
    raise exception 'Nicht angemeldet.';
  end if;

  select array_agg(id) into v_partner_ids from partners where owner_user_id = v_user_id;

  -- 1. Selbst erstellte Gruppen komplett aufloesen
  for v_group_id in select id from groups where created_by = v_user_id loop
    delete from partner_badges where group_id = v_group_id;
    delete from group_category_overrides where group_id = v_group_id;
    delete from point_entries where group_id = v_group_id;
    delete from point_entries
      where category_id in (select id from point_categories where group_id = v_group_id);
    delete from point_categories where group_id = v_group_id;
    delete from group_partner_memberships where group_id = v_group_id;
    delete from group_members where group_id = v_group_id;
    delete from groups where id = v_group_id;
  end loop;

  -- 2. Eigene Partner samt aller abhaengigen Daten
  if v_partner_ids is not null then
    delete from point_entries where partner_id = any(v_partner_ids);
    delete from partner_badges where partner_id = any(v_partner_ids);
    delete from partner_connections where partner_id = any(v_partner_ids);
    delete from group_partner_memberships where partner_id = any(v_partner_ids);
    delete from partners where id = any(v_partner_ids);
  end if;

  -- 3. Eintraege in fremden Gruppen (point_entries.created_by ist NOT NULL,
  --    muss also weg, bevor der auth-User geloescht wird)
  delete from point_entries where created_by = v_user_id;

  -- 4. Selbst angelegte Gruppenkategorien bleiben erhalten (andere Mitglieder
  --    nutzen sie weiter), nur die Urheberschaft wird geloest
  update point_categories set created_by = null where created_by = v_user_id;

  -- 5. Verbindungen, in denen die Person der Mann war
  update partner_connections
     set man_user_id = null, connected_at = null, disconnected_at = now()
   where man_user_id = v_user_id;

  -- 6. Restliche Mitgliedschaften und der Account selbst
  delete from group_members where user_id = v_user_id;
  delete from profiles where user_id = v_user_id;
  delete from auth.users where id = v_user_id;
end;
$$;

grant execute on function delete_account() to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- FIX 3: Punkte und Badges liessen sich fuer fremde Partner buchen
-- ═══════════════════════════════════════════════════════════════
-- Die INSERT-Policies prueften nur Gruppenmitgliedschaft, nicht ob
-- partner_id ueberhaupt der eigene Partner ist. Ein Gruppenmitglied
-- konnte per direktem API-Aufruf Punkte und Badges fuer den Partner
-- einer anderen Nutzerin buchen.

drop policy if exists "Mitglieder können Punkte vergeben" on point_entries;
drop policy if exists "Mitglieder koennen Punkte vergeben" on point_entries;
create policy "Punkte nur fuer eigene Partner"
  on point_entries for insert
  with check (
    auth.uid() = created_by
    and group_id = any(array(select get_my_group_ids()))
    and partner_id = any(array(select get_my_partner_ids()))
  );

drop policy if exists "Mitglieder koennen Badges vergeben" on partner_badges;
create policy "Badges nur fuer eigene Partner"
  on partner_badges for insert
  with check (
    group_id = any(array(select get_my_group_ids()))
    and partner_id = any(array(select get_my_partner_ids()))
  );
-- Hinweis: award_period_title() ist SECURITY DEFINER und laeuft als
-- Eigentuemer, umgeht RLS also weiterhin korrekt fuer die Saisontitel.

-- ═══════════════════════════════════════════════════════════════
-- FIX 4: Punktwert-Overrides umgingen das Tier-System
-- ═══════════════════════════════════════════════════════════════
-- group_category_overrides hatte keinerlei Wertpruefung, eine Gruppe
-- konnte jede Kategorie auf einen beliebigen Wert setzen.

-- Bestehende Werte ausserhalb des Tier-Systems entfernen. Die
-- betroffenen Kategorien fallen damit auf ihren Standardwert zurueck.
delete from group_category_overrides where points not in (2, 5, 10, 20, 40);

alter table group_category_overrides
  drop constraint if exists group_category_overrides_tier_points_check;
alter table group_category_overrides
  add constraint group_category_overrides_tier_points_check
  check (points in (2, 5, 10, 20, 40));

-- Bisher fehlte eine DELETE-Policy: ein einmal gesetzter Override liess
-- sich nicht mehr entfernen, nur ueberschreiben.
drop policy if exists "Mitglieder koennen Overrides loeschen" on group_category_overrides;
create policy "Mitglieder koennen Overrides loeschen"
  on group_category_overrides for delete
  using (group_id = any(array(select get_my_group_ids())));

-- ═══════════════════════════════════════════════════════════════
-- FIX 5: join_group_by_invite_code ohne festen search_path
-- ═══════════════════════════════════════════════════════════════
-- Als einzige SECURITY-DEFINER-Funktion fehlte ihr "set search_path".
-- Das ist der klassische Postgres-Rechteausweitungs-Vektor und wird
-- auch vom Supabase-Linter (function_search_path_mutable) gemeldet.

create or replace function join_group_by_invite_code(code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  found_group groups%rowtype;
begin
  select * into found_group from groups where invite_code = upper(code);

  if found_group.id is null then
    raise exception 'Ungültiger Einladungscode.';
  end if;

  insert into group_members (group_id, user_id)
  values (found_group.id, auth.uid())
  on conflict do nothing;

  return json_build_object(
    'id', found_group.id,
    'name', found_group.name,
    'invite_code', found_group.invite_code,
    'created_by', found_group.created_by
  );
end;
$$;

-- ═══════════════════════════════════════════════════════════════
-- Kontrolle
-- ═══════════════════════════════════════════════════════════════
-- Sollte 0 Zeilen liefern (SECURITY DEFINER ohne festen search_path):
--   select p.proname from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.prosecdef
--     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'))
--                     as c where c like 'search_path=%');
