# Aktueller Stand der Datenbank

**Generiert — nicht von Hand bearbeiten.** Neu erzeugen mit `npm run schema`.

Aus 38 Migrationen in `supabase/migrations/` zusammengesetzt. Die Spalte
„Migration" nennt die Datei, in der das Objekt **zuletzt** definiert wurde — dort steht
die verbindliche Fassung samt Begründung. Dieser Index ersetzt die Migrationen nicht,
er zeigt auf die richtige.

## Tabellen

### badges

| Spalte | Typ | seit |
|---|---|---|
| `id` | uuid primary key default gen_random_uuid() | 09 |
| `name` | text not null | 09 |
| `description` | text | 09 |
| `trigger_type` | text not null,  -- 'total_points', 'category_points', 'week_points', 'month_points' | 09 |
| `trigger_value` | integer not null | 09 |
| `category_filter` | text,        -- category_tag-Wert fuer 'category_points'-Badges | 09 |
| `created_at` | timestamptz default now() | 09 |
| `badge_type` | integer | 18 |
| `is_hidden` | boolean not null default false | 18 |
| `is_repeatable` | boolean not null default false | 18 |
| `sort_order` | integer | 21 |
| `image_url` | text | 24 |
| `tier` | smallint | 24 |
| `icon_key` | text | 24 |

### group_category_overrides

| Spalte | Typ | seit |
|---|---|---|
| `id` | uuid primary key default gen_random_uuid() | 08 |
| `group_id` | uuid references groups(id) not null | 08 |
| `category_id` | uuid references point_categories(id) not null | 08 |
| `points` | integer not null | 08 |
| `created_at` | timestamptz default now() | 08 |

### group_members

| Spalte | Typ | seit |
|---|---|---|
| `group_id` | uuid references groups(id) not null | 01 |
| `user_id` | uuid references auth.users(id) not null | 01 |
| `joined_at` | timestamptz default now() | 01 |

### group_partner_memberships

| Spalte | Typ | seit |
|---|---|---|
| `id` | uuid primary key default gen_random_uuid() | 15 |
| `group_id` | uuid references groups(id) on delete cascade not null | 15 |
| `partner_id` | uuid references partners(id) on delete cascade not null | 15 |
| `active` | boolean default true not null | 15 |
| `created_at` | timestamptz default now() | 15 |

### groups

| Spalte | Typ | seit |
|---|---|---|
| `id` | uuid primary key default gen_random_uuid() | 01 |
| `name` | text not null | 01 |
| `created_by` | uuid references auth.users(id) not null | 01 |
| `invite_code` | text unique not null | 01 |
| `created_at` | timestamptz default now() | 01 |
| `deleted_at` | timestamptz | 33 |

### partner_badges

| Spalte | Typ | seit |
|---|---|---|
| `id` | uuid primary key default gen_random_uuid() | 09 |
| `partner_id` | uuid references partners(id) not null | 09 |
| `badge_id` | uuid references badges(id) not null | 09 |
| `earned_at` | timestamptz default now() | 09 |
| `group_id` | uuid references groups(id) not null | 09 |
| `period_key` | text | 18 |

### partner_connections

| Spalte | Typ | seit |
|---|---|---|
| `id` | uuid primary key default gen_random_uuid() | 10 |
| `partner_id` | uuid references partners(id) not null unique | 10 |
| `man_user_id` | uuid references auth.users(id) | 10 |
| `invite_code` | text unique not null | 10 |
| `connected_at` | timestamptz | 10 |
| `disconnected_at` | timestamptz | 10 |
| `created_at` | timestamptz default now() | 10 |

### partners

| Spalte | Typ | seit |
|---|---|---|
| `id` | uuid primary key default gen_random_uuid() | 01 |
| `owner_user_id` | uuid references auth.users(id) not null | 01 |
| `name` | text not null | 01 |
| `created_at` | timestamptz default now() | 01 |
| `avatar_url` | text | 23 |

### point_categories

| Spalte | Typ | seit |
|---|---|---|
| `id` | uuid primary key default gen_random_uuid() | 04 |
| `name` | text not null | 04 |
| `points` | integer not null | 04 |
| `is_global` | boolean default true | 04 |
| `created_at` | timestamptz default now() | 04 |
| `created_by` | uuid references auth.users(id) | 06 |
| `group_id` | uuid references groups(id) | 07 |
| `category_tag` | text | 09 |
| `tier` | integer | 16 |
| `multiplier_eligible` | boolean not null default false | 16 |
| `icon_key` | text | 24 |
| `archived_at` | timestamptz | 27 |

### point_entries

| Spalte | Typ | seit |
|---|---|---|
| `id` | uuid primary key default gen_random_uuid() | 04 |
| `partner_id` | uuid references partners(id) not null | 04 |
| `group_id` | uuid references groups(id) not null | 04 |
| `category_id` | uuid references point_categories(id) not null | 04 |
| `points` | integer not null | 04 |
| `note` | text | 04 |
| `created_by` | uuid references auth.users(id) not null | 04 |
| `created_at` | timestamptz default now() | 04 |
| `without_request` | boolean not null default false | 16 |
| `capped_reason` | text | 17 |

### profiles

| Spalte | Typ | seit |
|---|---|---|
| `user_id` | uuid primary key references auth.users(id) on delete cascade | 20 |
| `created_at` | timestamptz default now() | 20 |
| `timezone` | text | 26 |

## Funktionen

| Funktion | Migration | Fassungen |
|---|---|---|
| `add_point_entry(uuid, uuid, uuid, text, boolean)` | 37 | 1 |
| `apply_point_entry_rules()` | 37 | 4 |
| `award_badges_for_partner(uuid, uuid)` | 38 | 1 |
| `award_period_title(text)` | 38 | 4 |
| `connect_to_partner(text)` | 36 | 3 |
| `delete_account()` | 36 | 4 |
| `delete_custom_category(uuid)` | 27 | 1 |
| `delete_group(uuid)` | 33 | 2 |
| `delete_partner(uuid)` | 14 | 1 |
| `delete_point_entry(uuid)` | 29 | 1 |
| `evaluate_badges(uuid)` | 38 | 1 |
| `get_my_connected_partner_ids()` | 12 | 1 |
| `get_my_group_ids()` | 03 | 1 |
| `get_my_partner_ids()` | 12 | 1 |
| `join_group_by_invite_code(text)` | 33 | 4 |
| `leave_group(uuid)` | 36 | 2 |
| `partner_capped_entries(uuid)` | 35 | 3 |
| `partner_point_history(uuid)` | 34 | 1 |
| `partner_point_totals(uuid)` | 31 | 2 |
| `rename_group(uuid, text)` | 36 | 1 |
| `set_my_timezone(text)` | 36 | 2 |
| `sql_month_key(timestamptz)` | 38 | 1 |
| `sql_week_key(timestamptz)` | 38 | 1 |
| `sql_year_key(timestamptz)` | 38 | 1 |
| `trg_award_badges()` | 38 | 1 |

Entfernt: `set_woman_role()` (in 36), `add_point_entry(uuid, uuid, uuid, integer, text, boolean)` (in 37)

## Trigger

| Trigger | Tabelle | Migration |
|---|---|---|
| `trg_apply_point_entry_rules` | point_entries | 17 |
| `trg_award_badges_on_point_entry` | point_entries | 38 |

## Policies

| Tabelle | Aktion | Policy | Migration |
|---|---|---|---|
| badges | select | Alle sehen Badges | 09 |
| group_category_overrides | update | Mitglieder koennen Overrides aktualisieren | 08 |
| group_category_overrides | insert | Mitglieder koennen Overrides erstellen | 08 |
| group_category_overrides | delete | Mitglieder koennen Overrides loeschen | 25 |
| group_category_overrides | select | Mitglieder sehen Overrides ihrer Gruppe | 08 |
| group_members | select | Mitglieder sehen alle Mitglieder ihrer Gruppe | 03 |
| group_members | insert | Nutzer kann Gruppe beitreten | 01 |
| group_partner_memberships | select | Mitglieder sehen Partner-Mitgliedschaften | 15 |
| group_partner_memberships | update | Partner-Eigentuemer aktualisiert Mitgliedschaft | 15 |
| group_partner_memberships | insert | Partner-Eigentuemer fuegt Partner zur Gruppe hinzu | 15 |
| group_partner_memberships | delete | Partner-Eigentuemerin entfernt Mitgliedschaft | 29 |
| groups | insert | Eingeloggte Nutzer können Gruppe erstellen | 01 |
| groups | select | Ersteller und Mitglieder sehen Gruppe | 01 |
| partner_badges | select | Badges eigener Gruppen und verbundener Partner sichtbar | 25 |
| partner_badges | insert | Badges nur fuer eigene Partner | 25 |
| partner_badges | insert | partner_badges_no_direct_insert | 38 |
| partner_connections | insert | Frau erstellt Verbindung fuer ihren Partner | 12 |
| partner_connections | update | Mann kann sich disconnecten | 10 |
| partner_connections | select | Sieht eigene Verbindungen | 12 |
| partners | update | Nutzer kann eigene Partner aktualisieren | 13 |
| partners | insert | Nutzer kann eigenen Partner anlegen | 01 |
| partners | select | Nutzer sieht eigene und Gruppen-Partner | 12 |
| point_categories | select | Globale und eigene Gruppenkategorien sichtbar | 26 |
| point_categories | insert | Gruppenmitglieder koennen Gruppenkategorien erstellen | 07 |
| point_categories | delete | Gruppenmitglieder koennen eigene Kategorien loeschen | 08 |
| point_entries | delete | Ersteller kann eigene Eintraege loeschen | 11 |
| point_entries | select | Mitglieder sehen Einträge ihrer Gruppe | 04 |
| point_entries | insert | Punkte nur fuer eigene Partner | 25 |
| profiles | update | Nutzer aktualisiert eigenes Profil | 20 |
| profiles | insert | Nutzer legt eigenes Profil an | 20 |
| profiles | select | Nutzer sieht eigenes Profil | 20 |

## Indizes

| Index | Tabelle | Spalten | Migration |
|---|---|---|---|
| `idx_gpm_partner_id` | group_partner_memberships | partner_id | 37 |
| `idx_group_members_user_id` | group_members | user_id | 37 |
| `idx_groups_created_by` | groups | created_by | 37 |
| `idx_partner_badges_group_id` | partner_badges | group_id | 37 |
| `idx_partner_connections_man_user_id` | partner_connections | man_user_id | 37 |
| `idx_partners_owner_user_id` | partners | owner_user_id | 37 |
| `idx_point_categories_created_by` | point_categories | created_by | 37 |
| `idx_point_categories_group_id` | point_categories | group_id | 37 |
| `idx_point_entries_category_id` | point_entries | category_id | 37 |
| `idx_point_entries_created_by` | point_entries | created_by | 37 |
| `idx_point_entries_group_created` | point_entries | group_id, created_at desc | 37 |
| `idx_point_entries_partner_group_created` | point_entries | partner_id, group_id, created_at | 37 |
