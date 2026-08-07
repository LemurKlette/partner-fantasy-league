-- Migration: Gruppen weich loeschen, Badges bleiben unangetastet
-- Datum: 2026-08-07
--
-- Fehler: delete_group() loeschte hart
--   delete from partner_badges where group_id = ...   -> bereits verdiente
--                                                        Badges verschwanden
--   delete from point_entries  where group_id = ...   -> die Punkte fielen
--                                                        vom Badge-Konto
-- Ein Partner mit 1.000 Punkten, davon 300 aus Gruppe X, stand nach dem
-- Loeschen von X bei 700 und verlor dadurch bereits erreichte Meilensteine.
-- delete_account() hatte dasselbe Muster und traf dort sogar die Partner
-- anderer Nutzerinnen.
--
-- Loesung: Die Gruppe wird nur noch als geloescht markiert. Ihre Eintraege
-- und Badges bleiben liegen und zaehlen weiter aufs Erfolgskonto -- die
-- Badge-Summen aendern sich beim Loeschen also um exakt null.
--
-- Das loest zugleich die Doppelzaehlung, die bei einem "Wiederherstellen"
-- entstehen koennte: Es wird nie etwas abgezogen und wieder addiert,
-- sondern nur ein Sichtbarkeits-Flag umgelegt. Ein Marker an den
-- Punkt-Eintraegen ist dafuer nicht noetig.

alter table groups add column if not exists deleted_at timestamptz;

-- Wird die Erstellerin geloescht, bleibt die Gruppe als anonymer Rest
-- bestehen, damit die Eintraege der anderen Mitglieder ihre Badges behalten.
alter table groups alter column created_by drop not null;

-- ── Gruppe loeschen: nur noch markieren ─────────────────────────
create or replace function delete_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from groups
    where id = p_group_id and created_by = auth.uid() and deleted_at is null
  ) then
    raise exception 'Nur die Erstellerin kann diese Gruppe löschen.';
  end if;

  -- Bewusst werden weder point_entries noch partner_badges angefasst:
  -- einmal verdiente Erfolge bleiben lebenslang bestehen.
  update groups set deleted_at = now() where id = p_group_id;
end;
$$;

grant execute on function delete_group(uuid) to authenticated;

-- ── Konto loeschen: eigene Gruppen ebenfalls nur markieren ──────
create or replace function delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_partner_ids uuid[];
begin
  if v_user_id is null then
    raise exception 'Nicht angemeldet.';
  end if;

  select array_agg(id) into v_partner_ids from partners where owner_user_id = v_user_id;

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
  delete from profiles where user_id = v_user_id;
  delete from auth.users where id = v_user_id;
end;
$$;

grant execute on function delete_account() to authenticated;

-- ── Geloeschte Gruppen ueberall ausblenden ──────────────────────
create or replace function join_group_by_invite_code(code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  found_group groups%rowtype;
begin
  select * into found_group from groups
   where invite_code = upper(code) and deleted_at is null;

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

-- Saisontitel nicht mehr fuer geloeschte Gruppen vergeben.
create or replace function award_period_title(p_period text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz constant text := 'Europe/Berlin';
  v_local timestamp := now() at time zone v_tz;
  v_range_start timestamptz;
  v_range_end timestamptz;
  v_period_key text;
  v_badge_id uuid;
  v_trigger_type text;
  v_group record;
  v_winner record;
begin
  if p_period = 'week' then
    v_range_end := date_trunc('week', v_local) at time zone v_tz;
    v_range_start := v_range_end - interval '7 days';
    v_period_key := to_char(date_trunc('week', v_local) - interval '7 days', 'IYYY-"W"IW');
    v_trigger_type := 'weekly_rank1';
  elsif p_period = 'month' then
    v_range_end := date_trunc('month', v_local) at time zone v_tz;
    v_range_start := v_range_end - interval '1 month';
    v_period_key := to_char(date_trunc('month', v_local) - interval '1 month', 'YYYY-MM');
    v_trigger_type := 'monthly_rank1';
  elsif p_period = 'year' then
    v_range_end := date_trunc('year', v_local) at time zone v_tz;
    v_range_start := v_range_end - interval '1 year';
    v_period_key := to_char(date_trunc('year', v_local) - interval '1 year', 'YYYY');
    v_trigger_type := 'yearly_rank1';
  else
    raise exception 'Unbekannter Zeitraum: %', p_period;
  end if;

  select id into v_badge_id from badges where trigger_type = v_trigger_type;
  if v_badge_id is null then
    raise exception 'Saisontitel-Badge fuer % nicht gefunden.', v_trigger_type;
  end if;

  for v_group in select id from groups where deleted_at is null loop
    select pe.partner_id, sum(pe.points) as total
    into v_winner
    from point_entries pe
    join group_partner_memberships gpm
      on gpm.group_id = pe.group_id and gpm.partner_id = pe.partner_id and gpm.active = true
    where pe.group_id = v_group.id
      and pe.created_at >= v_range_start and pe.created_at < v_range_end
    group by pe.partner_id
    order by total desc
    limit 1;

    if v_winner.partner_id is not null and v_winner.total > 0 then
      insert into partner_badges (partner_id, badge_id, group_id, period_key)
      values (v_winner.partner_id, v_badge_id, v_group.id, v_period_key)
      on conflict (partner_id, badge_id, group_id, period_key) do nothing;
    end if;
  end loop;
end;
$$;

revoke execute on function award_period_title(text) from public;

-- Kontrolle: geloeschte Gruppen, deren Punkte weiterhin zaehlen
-- select g.id, g.name, g.deleted_at, count(pe.id) as eintraege
-- from groups g left join point_entries pe on pe.group_id = g.id
-- where g.deleted_at is not null group by 1, 2, 3;
