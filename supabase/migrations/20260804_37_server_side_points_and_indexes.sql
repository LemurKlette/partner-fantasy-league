-- Migration: Audit-Punkte 1 und 2
--   1) Der Client bestimmt den Punktwert selbst
--   2) Das Projekt hat keinen einzigen Index
-- Datum: 2026-08-07
--
-- ═══════════════════════════════════════════════════════════════
-- VORBEMERKUNG: Minuspunkte als geplantes Feature
-- ═══════════════════════════════════════════════════════════════
-- Minuspunkte sollen spaeter dazukommen. Diese Migration ist deshalb
-- bewusst so gebaut, dass sie dem nicht im Weg steht:
--
--   * KEIN "check (points >= 0)" auf point_entries. Das waere der
--     naheliegende Weg, den im Audit gemeldeten Negativwert zu blocken --
--     er muesste fuer das Feature aber sofort wieder fallen. Stattdessen
--     wird der Wert gar nicht mehr vom Client uebernommen, sondern aus
--     der Kategorie abgeleitet. Das Vorzeichen ist damit eine Eigenschaft
--     der *Daten*, nicht des Aufrufs: eine kuenftige Strafkategorie traegt
--     einfach einen negativen points-Wert, und alles andere greift ohne
--     weitere Aenderung.
--   * Die Anti-Farming-Regeln kappen ausschliesslich nach oben und sind
--     unten explizit auf positive Eintraege begrenzt. Ohne diese Grenze
--     wuerde eine Strafe bei ausgeschoepftem Tageslimit stillschweigend
--     auf 0 gesetzt -- der Eintrag waere wirkungslos, ohne dass es jemand
--     merkt.
--   * Das Tagesbudget zaehlt nur positive Eintraege. Sonst wuerde eine
--     Strafe von -10 am selben Tag 10 Punkte Kappungsspielraum
--     zurueckgeben und liesse sich zum Farmen benutzen.
--
-- Heute aendert das nichts, da alle Kategorien positive Werte haben --
-- die Zweige liegen brach, bis das Feature kommt. Was beim Feature noch
-- zu entscheiden ist, steht am Ende der Datei.

-- ═══════════════════════════════════════════════════════════════
-- 1: Punktwert serverseitig aus der Kategorie ableiten
-- ═══════════════════════════════════════════════════════════════
-- add_point_entry() hat p_points ungeprueft uebernommen. Der Publishable
-- Key steckt im App-Bundle, wer die API direkt anspricht konnte damit
-- "Muell rausbringen" (Tier 1, 2 Punkte) mit 80 Punkten buchen. Ebenso
-- liess sich p_without_request fuer Romantik und Verlaesslichkeit
-- erzwingen, obwohl der Bonus dort laut Konzept nicht gilt -- und darueber
-- das Badge "Der Hellseher" farmen.
--
-- Die Absicherung sitzt bewusst im TRIGGER und nicht in der RPC: die
-- INSERT-Policy auf point_entries erlaubt auch direkte Inserts (sie prueft
-- nur Gruppe und eigener Partner). Die RPC ist also gar nicht die einzige
-- Tuer. Der Trigger ist der einzige Punkt, an dem jeder Eintrag
-- vorbeimuss -- egal ueber welchen Weg er kommt.
--
-- Damit ist auch p_category_id abgesichert: eine Kategorie aus einer
-- fremden Gruppe oder eine archivierte wird abgewiesen statt akzeptiert.

create or replace function apply_point_entry_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat point_categories%rowtype;
  v_same_task_count integer;
  v_daily_total integer;
  v_remaining integer;
  v_tz text;
  v_day_start timestamptz;
  v_day_end timestamptz;
begin
  -- ── Punktwert und Bonus aus der Kategorie ableiten ────────────
  select * into v_cat from point_categories where id = NEW.category_id;
  if not found then
    raise exception 'Aufgabe nicht gefunden.';
  end if;
  if v_cat.archived_at is not null then
    raise exception 'Diese Aufgabe wurde archiviert und kann nicht mehr vergeben werden.';
  end if;
  -- Eigene Kategorien gehoeren genau einer Gruppe. Globale gelten ueberall.
  if coalesce(v_cat.is_global, true) = false
     and v_cat.group_id is distinct from NEW.group_id then
    raise exception 'Diese Aufgabe gehört nicht zu dieser Gruppe.';
  end if;

  -- Der Bonus gilt nur, wo das Balancing-Konzept ihn vorsieht (Haushalt
  -- und Mental Load). Es wird der *wirksame* Wert gespeichert, nicht der
  -- gewuenschte -- sonst traegt der Eintrag ein Blitz-Symbol im Log und
  -- zaehlt fuer "Der Hellseher", ohne dass der Bonus je gegriffen hat.
  NEW.without_request := coalesce(NEW.without_request, false)
                         and coalesce(v_cat.multiplier_eligible, false);

  if NEW.without_request then
    NEW.points := ceil(v_cat.points * 1.5)::integer;
  else
    NEW.points := v_cat.points;
  end if;

  -- ── Anti-Farming (unveraendert, nur nach oben) ────────────────
  -- Ab hier ist NEW.points serverseitig gesetzt. Die Regeln kappen
  -- ausschliesslich nach oben; auf Eintraege ohne positiven Wert sind
  -- sie nicht anwendbar (siehe Vorbemerkung zu Minuspunkten).
  if NEW.points <= 0 then
    NEW.capped_reason := null;
    return NEW;
  end if;

  select p.timezone into v_tz from profiles p where p.user_id = NEW.created_by;
  if v_tz is null or not exists (select 1 from pg_timezone_names where name = v_tz) then
    v_tz := 'Europe/Berlin';
  end if;

  v_day_start := (date_trunc('day', (now() at time zone v_tz)) at time zone v_tz);
  v_day_end := v_day_start + interval '1 day';

  -- Wie oft wurde dieselbe Aufgabe fuer diesen Partner heute IN DIESER
  -- GRUPPE schon eingetragen? "points >= 0" schliesst kuenftige Strafen
  -- aus: eine Strafe darf die Wiederholungszaehlung einer Aufgabe nicht
  -- verbrauchen.
  select count(*) into v_same_task_count
  from point_entries
  where partner_id = NEW.partner_id
    and group_id = NEW.group_id
    and category_id = NEW.category_id
    and points >= 0
    and created_at >= v_day_start and created_at < v_day_end;

  -- Wie viele Punkte hat der Partner heute IN DIESER GRUPPE schon
  -- gesammelt? Nur positive Eintraege: eine Strafe darf kein Budget
  -- zurueckgeben (siehe Vorbemerkung).
  select coalesce(sum(points) filter (where points > 0), 0) into v_daily_total
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

-- ── RPC: p_points entfaellt ─────────────────────────────────────
-- Der Parameter waere ab jetzt wirkungslos, weil der Trigger ihn ohnehin
-- ueberschreibt. Ein stiller Blindgaenger in der Signatur laedt zu genau
-- der Annahme ein, die dieser Fix beseitigt -- deshalb raus damit.
-- Die alte Signatur muss weichen, sonst stehen beide als Ueberladung da.
drop function if exists add_point_entry(uuid, uuid, uuid, integer, text, boolean);

-- SECURITY INVOKER wie bisher (Migration 29): so greifen die bestehenden
-- RLS-Policies weiter und die Berechtigungspruefung muss nicht dupliziert
-- werden.
create or replace function add_point_entry(
  p_partner_id uuid,
  p_group_id uuid,
  p_category_id uuid,
  p_note text,
  p_without_request boolean
)
returns table (awarded_points integer, cap_reason text)
language plpgsql
set search_path = public
as $$
declare
  v_points integer;
  v_reason text;
begin
  insert into group_partner_memberships (group_id, partner_id, active)
  values (p_group_id, p_partner_id, true)
  on conflict (group_id, partner_id) do nothing;

  -- points wird hier nur als Platzhalter gesetzt: der Trigger leitet den
  -- echten Wert aus der Kategorie ab und kappt ihn gegebenenfalls.
  insert into point_entries (partner_id, group_id, category_id, points, note, created_by, without_request)
  values (
    p_partner_id, p_group_id, p_category_id, 0,
    nullif(btrim(coalesce(p_note, '')), ''),
    auth.uid(), coalesce(p_without_request, false)
  )
  returning point_entries.points, point_entries.capped_reason
  into v_points, v_reason;

  awarded_points := v_points;
  cap_reason := v_reason;
  return next;
end;
$$;

grant execute on function add_point_entry(uuid, uuid, uuid, text, boolean) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 2: Indizes
-- ═══════════════════════════════════════════════════════════════
-- In 36 Migrationen kam "create index" kein einziges Mal vor. Postgres
-- legt Indizes nur fuer Primaerschluessel und Unique-Constraints an --
-- fuer Fremdschluessel ausdruecklich NICHT. Betroffen sind ausgerechnet
-- die heissesten Pfade.
--
-- Bewusst ohne "concurrently": das laeuft nicht in einer Transaktion und
-- der SQL-Editor im Dashboard klammert. Bei der aktuellen Datenmenge
-- dauert der Aufbau ohnehin Millisekunden.

-- get_my_group_ids() -- laeuft ueber fast jede RLS-Policy, also bei
-- praktisch jeder Abfrage. Der Primaerschluessel ist (group_id, user_id):
-- die fuehrende Spalte passt nicht, es blieb ein Seq-Scan.
create index if not exists idx_group_members_user_id
  on group_members (user_id);

-- get_my_partner_ids() -- dito.
create index if not exists idx_partners_owner_user_id
  on partners (owner_user_id);

-- apply_point_entry_rules(): zwei Abfragen bei JEDEM Insert.
-- Deckt mit fuehrendem partner_id auch partner_capped_entries(),
-- partner_point_totals() und partner_point_history() ab.
create index if not exists idx_point_entries_partner_group_created
  on point_entries (partner_id, group_id, created_at);

-- Aktivitaetslog: neueste Eintraege einer Gruppe.
create index if not exists idx_point_entries_group_created
  on point_entries (group_id, created_at desc);

-- delete_custom_category() prueft "wurde die Kategorie je genutzt?",
-- ausserdem der Fremdschluessel selbst.
create index if not exists idx_point_entries_category_id
  on point_entries (category_id);

-- delete_account() Schritt 3 und die DELETE-Policy (eigene Eintraege).
create index if not exists idx_point_entries_created_by
  on point_entries (created_by);

-- partner_badges: (partner_id, badge_id, group_id) ist unique und deckt
-- partner_id als fuehrende Spalte bereits ab. Fuer group_id gilt das nicht
-- -- gebraucht von award_period_title() und delete_group().
create index if not exists idx_partner_badges_group_id
  on partner_badges (group_id);

-- group_partner_memberships: unique(group_id, partner_id) deckt group_id
-- ab, partner_id nicht -- gebraucht von leave_group(), delete_partner()
-- und delete_account().
create index if not exists idx_gpm_partner_id
  on group_partner_memberships (partner_id);

-- partner_connections: partner_id ist unique, invite_code ebenfalls.
-- man_user_id nicht -- laeuft in loadUserData bei jedem Login.
create index if not exists idx_partner_connections_man_user_id
  on partner_connections (man_user_id);

-- SELECT-Policy auf point_categories filtert nach group_id.
create index if not exists idx_point_categories_group_id
  on point_categories (group_id);

-- delete_account() Schritt 4.
create index if not exists idx_point_categories_created_by
  on point_categories (created_by);

-- Gruppenuebersicht und delete_account() Schritt 1.
create index if not exists idx_groups_created_by
  on groups (created_by);

-- Der Planer braucht aktuelle Statistiken, sonst nutzt er die neuen
-- Indizes unter Umstaenden erst nach dem naechsten Autovacuum.
analyze group_members;
analyze partners;
analyze point_entries;
analyze partner_badges;
analyze group_partner_memberships;
analyze partner_connections;
analyze point_categories;
analyze groups;

-- ═══════════════════════════════════════════════════════════════
-- Offen fuer das Minuspunkte-Feature
-- ═══════════════════════════════════════════════════════════════
-- Vorbereitet ist der Weg des Punktwerts. Drei Entscheidungen stehen
-- beim Bau des Features noch an, sie sind hier bewusst NICHT
-- vorweggenommen:
--
--   a) point_categories_points_tier_check bindet points fest an tier
--      (1..5 = 2/5/10/20/40). Eine Strafkategorie braucht entweder eine
--      eigene Stufe (z.B. tier 0 oder negative Stufen) oder eine
--      Ausnahme ueber ein Flag wie is_penalty.
--   b) delete_point_entry() entfernt die Gruppenzugehoerigkeit, sobald
--      die Punktsumme <= 0 faellt. Mit Minuspunkten koennte ein Partner
--      dadurch aus dem Ranking verschwinden, obwohl er Eintraege hat --
--      dann sollte die Bedingung auf "keine Eintraege mehr" wechseln.
--   c) partner_capped_entries() waehlt pro Tag die punktstaerkste Gruppe
--      fuers Badge-Konto. Ob Strafen dort mitzaehlen (und ob sie ein
--      bereits verdientes Badge wieder entziehen koennen), ist eine
--      Produktentscheidung.

-- Kontrolle
-- select indexname, tablename from pg_indexes
--   where schemaname = 'public' order by tablename, indexname;
-- select proname, pg_get_function_identity_arguments(oid)
--   from pg_proc where proname = 'add_point_entry';
