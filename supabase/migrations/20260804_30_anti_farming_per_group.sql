-- Migration: Anti-Farming-Regeln pro Gruppe statt gruppenuebergreifend
-- Datum: 2026-08-07
--
-- Fehler: beide Regeln zaehlten nur ueber partner_id, ohne group_id.
--   a) Tageslimit: hatte ein Partner in Gruppe A schon 62 Punkte, blieben
--      in Gruppe B am selben Tag nur noch 18 uebrig.
--   b) Abnehmende Wertung: dieselbe Aufgabe in Gruppe B zaehlte nur halb,
--      wenn sie vorher schon in Gruppe A eingetragen war.
--
-- Gruppen sind unabhaengige Ranglisten mit unterschiedlichen Freundeskreisen.
-- Verbrauch in der einen Gruppe darf die andere nicht beeinflussen, sonst
-- ist die Wertung innerhalb einer Gruppe nicht mehr vergleichbar.
--
-- Die Tagesgrenze lief bereits korrekt in der Zeitzone der Nutzerin
-- (profiles.timezone, Rueckfall Europe/Berlin) -- daran aendert sich nichts.

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

  -- Wie oft wurde dieselbe Aufgabe fuer diesen Partner heute IN DIESER
  -- GRUPPE schon eingetragen?
  select count(*) into v_same_task_count
  from point_entries
  where partner_id = NEW.partner_id
    and group_id = NEW.group_id
    and category_id = NEW.category_id
    and created_at >= v_day_start and created_at < v_day_end;

  -- Wie viele Punkte hat der Partner heute IN DIESER GRUPPE schon gesammelt?
  select coalesce(sum(points), 0) into v_daily_total
  from point_entries
  where partner_id = NEW.partner_id
    and group_id = NEW.group_id
    and created_at >= v_day_start and created_at < v_day_end;

  v_remaining := 80 - v_daily_total;

  if v_remaining <= 0 then
    -- Tageslimit dieser Gruppe bereits ausgeschoepft
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

-- Kontrolle: zeigt je Partner/Gruppe/Tag die Summe. Kein Wert darf ueber 80
-- liegen; Altdaten aus der Zeit vor diesem Fix koennen darunter liegen, weil
-- sie faelschlich gekappt wurden.
-- select partner_id, group_id, created_at::date, sum(points)
-- from point_entries group by 1, 2, 3 having sum(points) > 80;
