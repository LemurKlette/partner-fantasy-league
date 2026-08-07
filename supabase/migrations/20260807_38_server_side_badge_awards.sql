-- Migration: Audit-Punkte 3 und 5
--   3) Badge-Vergabe läuft nicht mehr im Client
--   5) group_category_overrides aufgeräumt (toter Ballast)
-- Datum: 2026-08-07
--
-- ═══════════════════════════════════════════════════════════════
-- 3: Badges serverseitig vergeben, nicht im Client
-- ═══════════════════════════════════════════════════════════════
-- Problem: Ein manipulierter Client konnte sich jedes Badge selbst
-- verleihen (INSERT-Policy war zu permissiv). Schließt jemand die App
-- direkt nach dem Punktevergeben, lief checkAndAwardBadges nie --
-- verdiente Badges gingen still verloren.
--
-- Lösung: Trigger auf point_entries mit kompletter Prüflogik.
-- Der Trigger lädt Daten via RPC, rechnet Punkte/Streaks/etc.
-- aus und INSERT die Badges selbst. Das läuft immer -- egal ob
-- der Client die Prüfung je aufgerufen hätte oder was nach dem
-- Punktevergeben passiert.
--
-- Der Client darf checkAndAwardBadges behalten (schnell, Fehlersuche),
-- aber er ist nicht verbindlich. Der Trigger ist der autoritative Ort.
-- Die INSERT-Policy auf partner_badges wird gelöscht -- nur die RPC
-- darf INSERTs machen, und die wird vom Trigger aufgerufen.

-- ── Hilfsroutinen: ISO-Wochenzahl, Monatsschlüssel, etc. ──────
-- Diese Funktionen sind im Client auch vorhanden (mondayOf,
-- monthKeyOf, weekKeyOf). Hier als reine SQL-Funktionen.

create or replace function sql_week_key(p_date timestamptz)
returns text
language sql
immutable
as $$
  -- ISO-8601: Donnerstag entscheidet über das Jahr, Montag ist Wochenstart
  select to_char(
    (p_date::date - (extract('dow', p_date::date)::int + 5) % 7)::timestamp,
    'YYYY-MM-DD'
  )
$$;

create or replace function sql_month_key(p_date timestamptz)
returns text
language sql
immutable
as $$
  select to_char(p_date::date, 'YYYY-MM')
$$;

create or replace function sql_year_key(p_date timestamptz)
returns text
language sql
immutable
as $$
  select to_char(p_date::date, 'YYYY')
$$;

-- ── Badge-Auswertung für einen Partner ───────────────────────
-- Diese RPC wird vom Trigger aufgerufen und liefert eine Liste
-- von Badge-IDs, die verdient sind. Sie ändert NICHT selbst die DB.

create or replace function evaluate_badges(p_partner_id uuid)
returns table (badge_id uuid, period_key text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_points integer;
  v_now_week_key text;
  v_now_month_key text;
  v_now_year_key text;
  v_cat_totals hstore;
  v_week_totals hstore;
  v_dishwasher_count integer;
  v_has_anniversary boolean;
  v_tier4_month_count integer;
  v_custom_category_count integer;
  v_this_week_total integer;
  v_pause_weeks integer;
  v_had_earlier_activity boolean;
  v_is_comeback boolean;
  v_streak integer;
  v_week_cursor date;
  v_this_week_without_request integer;
  v_this_week_tags text[];
  r_badge record;
begin
  v_now_week_key := sql_week_key(now());
  v_now_month_key := sql_month_key(now());
  v_now_year_key := sql_year_key(now());

  -- Alle Punkte für den Partner über alle Gruppen, nur die der
  -- punktstärksten Gruppe pro Tag (via partner_capped_entries).
  select coalesce(sum(counted_points), 0)
  into v_total_points
  from partner_capped_entries(p_partner_id)
  where counts_for_badges;

  -- Punkte pro Kategorie
  select hstore(array_agg(cat_tag), array_agg(cat_points))
  into v_cat_totals
  from (
    select cat_tag, sum(counted_points) as cat_points
    from partner_capped_entries(p_partner_id)
    where counts_for_badges
    group by cat_tag
  ) x;
  v_cat_totals := coalesce(v_cat_totals, ''::hstore);

  -- Punkte pro Woche
  select hstore(array_agg(week_key), array_agg(week_points))
  into v_week_totals
  from (
    select sql_week_key(entry_at) as week_key, sum(counted_points) as week_points
    from partner_capped_entries(p_partner_id)
    where counts_for_badges
    group by sql_week_key(entry_at)
  ) x;
  v_week_totals := coalesce(v_week_totals, ''::hstore);

  -- Speziale Badges: Zähler
  select count(*)
  into v_dishwasher_count
  from partner_capped_entries(p_partner_id)
  where counts_for_badges and category_name = 'Geschirrspüler aus-/einräumen';

  select exists(select 1 from partner_capped_entries(p_partner_id)
                where category_name = 'Jahrestag / Geburtstag perfekt gemeistert')
  into v_has_anniversary;

  select count(*)
  into v_tier4_month_count
  from partner_capped_entries(p_partner_id)
  where counts_for_badges
    and sql_month_key(entry_at) = v_now_month_key
    and cat_tier = 4;

  select count(*)
  into v_custom_category_count
  from partner_capped_entries(p_partner_id)
  where counts_for_badges and not coalesce(cat_is_global, true);

  select count(*)
  into v_this_week_without_request
  from partner_capped_entries(p_partner_id)
  where counts_for_badges
    and sql_week_key(entry_at) = v_now_week_key
    and unprompted;

  select array_agg(distinct cat_tag)
  into v_this_week_tags
  from partner_capped_entries(p_partner_id)
  where counts_for_badges and sql_week_key(entry_at) = v_now_week_key
    and cat_tag is not null;
  v_this_week_tags := coalesce(v_this_week_tags, array[]::text[]);

  -- Streak: wie viele Wochen in Folge >= 20 Punkte (aktuell rückwärts)
  v_streak := 0;
  v_week_cursor := (sql_week_key(now())::date);
  loop
    exit when (v_week_totals -> sql_week_key(v_week_cursor::timestamptz))::int < 20;
    v_streak := v_streak + 1;
    v_week_cursor := v_week_cursor - 7;
  end loop;

  -- Comeback: diese Woche >= 30, 3+ Wochen Pause vorher (0 Punkte)
  v_this_week_total := (v_week_totals -> v_now_week_key)::int;
  v_is_comeback := false;
  if v_this_week_total >= 30 then
    v_pause_weeks := 0;
    v_week_cursor := (v_now_week_key::date - 7);
    loop
      exit when (v_week_totals -> sql_week_key(v_week_cursor::timestamptz))::int > 0;
      v_pause_weeks := v_pause_weeks + 1;
      v_week_cursor := v_week_cursor - 7;
      exit when v_pause_weeks > 52;
    end loop;
    select exists(select 1 from partner_capped_entries(p_partner_id)
                  where entry_at::date < v_week_cursor)
    into v_had_earlier_activity;
    v_is_comeback := v_pause_weeks >= 3 and v_had_earlier_activity;
  end if;

  -- ── Alle Badges durchgehen und verdiente Ausgeben ──────────────────
  -- Trigger wird nur aufgerufen nach einem INSERT, nicht bei Delete/Update.
  -- Daher: nur prüfen, ob Badge verdient ist -- nicht, ob es entzogen werden
  -- soll (theoretisch könnte man davon ausgehen, dass der Partner es noch hat).

  for r_badge in select id, name, trigger_type, trigger_value, category_filter,
                        badge_type, is_repeatable
                   from badges
                   where is_hidden = false
                     and badge_type != 4  -- Saisontitel werden separat vergeben
  loop
    -- Meilensteine: totale Punkte
    if r_badge.trigger_type = 'total_points' then
      if v_total_points >= r_badge.trigger_value then
        return query select r_badge.id, null::text;
      end if;

    -- Kategorie-Spezialisten: Punkte in einer Kategorie
    elsif r_badge.trigger_type = 'category_points' then
      if coalesce((v_cat_totals -> r_badge.category_filter)::int, 0) >= r_badge.trigger_value then
        return query select r_badge.id, null::text;
      end if;

    -- Konsistenz: Streak-Wochen
    elsif r_badge.trigger_type = 'streak_weeks' then
      if v_streak >= r_badge.trigger_value then
        return query select r_badge.id, null::text;
      end if;

    -- Comeback
    elsif r_badge.trigger_type = 'comeback' then
      if v_is_comeback then
        return query select r_badge.id, null::text;
      end if;

    -- Der Hellseher: einen Jahrestag-Eintrag
    elsif r_badge.trigger_type = 'hellseher' then
      if v_has_anniversary then
        return query select r_badge.id, null::text;
      end if;

    -- Spülmaschinen-Flüsterer: 5x diese Aktivität
    elsif r_badge.trigger_type = 'dishwasher_count' then
      if v_dishwasher_count >= r_badge.trigger_value then
        return query select r_badge.id, null::text;
      end if;

    -- Überraschungsei: 10 verschiedene Kategorien
    elsif r_badge.trigger_type = 'allrounder' then
      if (select count(distinct cat_tag) from partner_capped_entries(p_partner_id)
          where counts_for_badges) >= r_badge.trigger_value then
        return query select r_badge.id, null::text;
      end if;

    -- Der Merker: Jahrestag (einmal vergeben, nicht wiederholbar)
    elsif r_badge.trigger_type = 'anniversary' then
      if v_has_anniversary then
        return query select r_badge.id, null::text;
      end if;

    -- Gefälligkeitszögling: 10 "ohne Aufforderung" in dieser Woche
    elsif r_badge.trigger_type = 'tier4_month' then
      if v_tier4_month_count >= r_badge.trigger_value then
        return query select r_badge.id, null::text;
      end if;

    -- Allrounder Custom: 5 verschiedene eigene Kategorien
    elsif r_badge.trigger_type = 'custom_category_count' then
      if v_custom_category_count >= r_badge.trigger_value then
        return query select r_badge.id, null::text;
      end if;
    end if;
  end loop;
end;
$$;

grant execute on function evaluate_badges(uuid) to authenticated;

-- ── RPC zum Abspeichern verdientes Badges ────────────────────
-- Diese RPC wird nur vom Trigger aufgerufen. Sie ist SECURITY DEFINER,
-- aber der Trigger gibt ihr explizit den Partner-ID, damit kein Client
-- das ausnutzen kann.

create or replace function award_badges_for_partner(p_partner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_badge_id uuid;
  v_period_key text;
begin
  -- Alle verdienen Badges aus evaluate_badges einfügen, aber nur falls
  -- nicht bereits verdient. On Conflict ignoriert Duplikate.
  for v_badge_id, v_period_key in
    select badge_id, period_key from evaluate_badges(p_partner_id)
  loop
    insert into partner_badges (partner_id, badge_id, group_id, period_key)
    -- group_id wird bei Meilenstein/Spezialisten auf NULL gesetzt -- diese
    -- Badges sind global. Saisontitel (badge_type 4) werden separat vergeben.
    values (p_partner_id, v_badge_id, null, v_period_key)
    on conflict (partner_id, badge_id, group_id) do nothing;
  end loop;
end;
$$;

grant execute on function award_badges_for_partner(uuid) to authenticated;

-- ── Trigger: Badges nach jedem neuen Eintrag prüfen ────────────────
-- Läuft AFTER INSERT, weil am Anfang bereits partner_capped_entries mit
-- den neuen Daten sehen soll.

drop trigger if exists trg_award_badges_on_point_entry on point_entries;
create trigger trg_award_badges_on_point_entry
  after insert on point_entries
  for each row execute function award_badges_for_partner(NEW.partner_id);

-- ── INSERT-Policy entfernen: nur noch Trigger statt Client ──────────
-- Beachte: die bestehende UPDATE/DELETE-Policy bleibt bestehen, damit
-- der Client die Einträge anfassen kann. Nur die Badges-INSERT wird
-- gesperrt.

drop policy if exists "Nur eigene Partner in eigenen Gruppen" on partner_badges;
-- Neue minimal-Policy: überhaupt nix erlauben. Der Trigger braucht
-- keine Policy, weil er SECURITY DEFINER läuft.
create policy "partner_badges_no_direct_insert"
  on partner_badges for insert
  with check (false);

-- Alter code im Client wird wahrscheinlich immer noch
-- checkAndAwardBadges aufrufen und versuchen zu INSERT. Das schlägt
-- jetzt fehl -- aber nicht mehr mit "Permissionfehler", sondern mit
-- "Policy reject". Der Client kann das weich bearbeiten: "Badges sind
-- auf dem Server".

-- ═══════════════════════════════════════════════════════════════
-- 5: group_category_overrides aufgeräumt
-- ═══════════════════════════════════════════════════════════════
-- Tabelle, vier Policies, ein CHECK-Constraint. Von der App weder
-- gelesen noch geschrieben, seit Punkte fest sind (Migration 04).
-- Soft-Delete räumt sie auch nicht mehr auf. Raus damit.

drop policy if exists "Partner sieht Override ihrer Gruppen" on group_category_overrides;
drop policy if exists "Partner kann Override in ihrer Gruppe hinzufügen" on group_category_overrides;
drop policy if exists "Partner kann Override in ihrer Gruppe ändern" on group_category_overrides;
drop policy if exists "Partner kann Override in ihrer Gruppe löschen" on group_category_overrides;
drop table if exists group_category_overrides;

-- ═══════════════════════════════════════════════════════════════
-- Kontrollqueries
-- ═══════════════════════════════════════════════════════════════
-- select count(*) from partner_badges;
-- select count(distinct partner_id) from partner_capped_entries(
--   (select id from partners limit 1)::uuid);
