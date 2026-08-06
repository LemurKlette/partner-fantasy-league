-- Migration: Audit-Punkte 6-9
-- Datum: 2026-08-06

-- ═══════════════════════════════════════════════════════════════
-- FIX 7 (Vorbereitung): Zeitzone des Geraets speichern
-- ═══════════════════════════════════════════════════════════════
-- Die Tagesgrenze lief bisher in UTC, der "neue Tag" begann im Sommer
-- also um 02:00 Uhr deutscher Zeit. Die App meldet jetzt die Zeitzone
-- des Mobilgeraets, und der Trigger rechnet damit.

alter table profiles add column if not exists timezone text;

-- Setzt die Zeitzone des angemeldeten Geraets. Legt die profiles-Zeile
-- bei Bedarf an (role wird spaeter von set_woman_role bzw.
-- connect_to_partner korrekt gesetzt und hier nie ueberschrieben).
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
  -- Nur echte IANA-Zeitzonen zulassen, sonst wuerde spaeter jede
  -- "at time zone"-Umrechnung im Trigger fehlschlagen.
  if p_tz is null or not exists (select 1 from pg_timezone_names where name = p_tz) then
    raise exception 'Unbekannte Zeitzone: %', p_tz;
  end if;

  insert into profiles (user_id, role, timezone)
  values (auth.uid(), 'woman', p_tz)
  on conflict (user_id) do update set timezone = excluded.timezone;
end;
$$;

grant execute on function set_my_timezone(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- FIX 6 + 7: Tageslimit kappen und in Geraete-Zeitzone rechnen
-- ═══════════════════════════════════════════════════════════════
-- Fix 6: Bisher wurde nur geprueft, ob die 80 Punkte bereits erreicht
-- sind. Der Eintrag, der die Grenze ueberschreitet, zaehlte voll --
-- bei 75 Punkten gab eine Tier-5-Aufgabe noch volle 40 Punkte (115
-- statt maximal 80). Jetzt wird auf den Restbetrag gekappt.
--
-- Fix 7: Tagesgrenze richtet sich nach profiles.timezone statt UTC.

create or replace function apply_point_entry_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_same_task_count integer;
  v_daily_total integer;
  v_remaining integer;
  v_tz text;
  v_day_start timestamptz;
  v_day_end timestamptz;
begin
  select p.timezone into v_tz from profiles p where p.user_id = NEW.created_by;
  if v_tz is null or not exists (select 1 from pg_timezone_names where name = v_tz) then
    v_tz := 'Europe/Berlin';
  end if;

  v_day_start := (date_trunc('day', (now() at time zone v_tz)) at time zone v_tz);
  v_day_end := v_day_start + interval '1 day';

  -- Wie oft wurde dieselbe Aufgabe fuer diesen Partner heute schon eingetragen?
  select count(*) into v_same_task_count
  from point_entries
  where partner_id = NEW.partner_id
    and category_id = NEW.category_id
    and created_at >= v_day_start and created_at < v_day_end;

  -- Wie viele Punkte hat der Partner heute schon insgesamt (alle Gruppen)?
  select coalesce(sum(points), 0) into v_daily_total
  from point_entries
  where partner_id = NEW.partner_id
    and created_at >= v_day_start and created_at < v_day_end;

  v_remaining := 80 - v_daily_total;

  if v_remaining <= 0 then
    -- Tageslimit bereits ausgeschoepft
    NEW.points := 0;
    NEW.capped_reason := 'daily_limit';
  elsif v_same_task_count >= 2 then
    -- 3. Eintrag derselben Aufgabe am selben Tag und weitere
    NEW.points := 0;
    NEW.capped_reason := 'task_repeat';
  else
    -- 2. Eintrag derselben Aufgabe: halbe Punkte (aufgerundet)
    if v_same_task_count = 1 then
      NEW.points := ceil(NEW.points * 0.5)::integer;
    end if;
    -- Danach auf den Rest bis zum Tageslimit kappen
    if NEW.points > v_remaining then
      NEW.points := v_remaining;
      NEW.capped_reason := 'daily_limit';
    else
      NEW.capped_reason := null;
    end if;
  end if;

  return NEW;
end;
$$;

-- Saisontitel ebenfalls an deutschen Kalendergrenzen ausrichten statt UTC.
-- (Gruppenuebergreifender Cronjob, deshalb eine feste Zone statt der
-- individuellen Geraete-Zeitzone.)
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

  for v_group in select id from groups loop
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

-- award_period_title ist nur fuer den Cronjob gedacht und war bisher
-- per Postgres-Default fuer alle ausfuehrbar.
revoke execute on function award_period_title(text) from public;

-- ═══════════════════════════════════════════════════════════════
-- FIX 8: Kategorien waren weltweit lesbar
-- ═══════════════════════════════════════════════════════════════
-- Die Policy war "using (true)" ohne Rollenbeschraenkung. Da der
-- Publishable Key im App-Bundle steckt, konnte damit auch eine
-- unangemeldete Person saemtliche selbst erstellten Kategorienamen
-- aller Gruppen auslesen.

drop policy if exists "Alle können Kategorien sehen" on point_categories;
drop policy if exists "Alle koennen Kategorien sehen" on point_categories;
create policy "Globale und eigene Gruppenkategorien sichtbar"
  on point_categories for select
  to authenticated
  using (
    is_global = true
    or group_id = any(array(select get_my_group_ids()))
  );

-- ═══════════════════════════════════════════════════════════════
-- FIX 9: Eine Gruppe liess sich nicht verlassen
-- ═══════════════════════════════════════════════════════════════
-- group_members hatte keine DELETE-Policy. Wer einmal beigetreten war,
-- kam nur wieder raus, wenn die Erstellerin die ganze Gruppe loeschte.

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
end;
$$;

grant execute on function leave_group(uuid) to authenticated;
