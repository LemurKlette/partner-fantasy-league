-- Migration: Anti-Farming-Regeln (serverseitig, per Trigger)
-- Datum: 2026-08-05
-- Kann nicht durch den Client umgangen werden, weil sie bei JEDEM Insert
-- auf point_entries greift, unabhaengig davon, welchen "points"-Wert der
-- Client mitschickt.

alter table point_entries add column if not exists capped_reason text; -- 'daily_limit' | 'task_repeat' | null

create or replace function apply_point_entry_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_same_task_count integer;
  v_daily_total integer;
  v_day_start timestamptz := date_trunc('day', now());
  v_day_end timestamptz := v_day_start + interval '1 day';
begin
  -- Wie oft wurde dieselbe Aufgabe (Kategorie) fuer diesen Partner heute schon eingetragen?
  select count(*) into v_same_task_count
  from point_entries
  where partner_id = NEW.partner_id
    and category_id = NEW.category_id
    and created_at >= v_day_start and created_at < v_day_end;

  -- Wie viele Punkte hat der Partner heute schon insgesamt (alle Gruppen/Kategorien)?
  select coalesce(sum(points), 0) into v_daily_total
  from point_entries
  where partner_id = NEW.partner_id
    and created_at >= v_day_start and created_at < v_day_end;

  if v_daily_total >= 80 then
    -- Tageslimit bereits erreicht: weitere Eintraege zaehlen 0
    NEW.points := 0;
    NEW.capped_reason := 'daily_limit';
  elsif v_same_task_count >= 2 then
    -- 3. Eintrag derselben Aufgabe am selben Tag und weitere: 0 Punkte
    NEW.points := 0;
    NEW.capped_reason := 'task_repeat';
  elsif v_same_task_count = 1 then
    -- 2. Eintrag derselben Aufgabe am selben Tag: 50%
    NEW.points := ceil(NEW.points * 0.5)::integer;
    NEW.capped_reason := null;
  else
    -- 1. Eintrag: 100%
    NEW.capped_reason := null;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_apply_point_entry_rules on point_entries;
create trigger trg_apply_point_entry_rules
  before insert on point_entries
  for each row execute function apply_point_entry_rules();
