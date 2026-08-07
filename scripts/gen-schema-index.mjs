// Erzeugt supabase/CURRENT.md: den aktuellen Stand der Datenbank aus der
// Migrationshistorie. Aufruf: npm run schema
//
// Warum das Skript existiert: 11 Funktionen sind ueber die Migrationen
// hinweg mehrfach neu definiert worden (apply_point_entry_rules viermal,
// delete_account viermal). Es gab nirgends den *aktuellen* Stand, nur die
// Schichten -- die Frage "was tut diese Funktion heute?" kostete jedes Mal
// eine Suche ueber alle Dateien.
//
// Bewusst generiert statt von Hand gepflegt: eine handgeschriebene
// Schemadatei driftet, und eine falsche Schemadatei ist schlimmer als
// keine. Der Index nennt zu jedem Objekt die Migration, in der es zuletzt
// definiert wurde -- er ersetzt die Quelle nicht, er zeigt darauf.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIG_DIR = join(ROOT, 'supabase', 'migrations');
const OUT = join(ROOT, 'supabase', 'CURRENT.md');

/** Kommentarzeilen entfernen, damit auskommentierte Beispiele nicht als
 *  echte Definitionen gezaehlt werden (die Migrationen enden oft mit einem
 *  auskommentierten Kontroll-SELECT). */
function stripComments(sql) {
  // CRLF zuerst normalisieren: git checkt hier mit CRLF aus, sonst greift
  // keines der zeilenbasierten Muster.
  return sql
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(l => !l.trimStart().startsWith('--'))
    .join('\n');
}

/** "20260804_37_server_side_points_and_indexes.sql" -> "37" */
const shortName = f => (f.match(/_(\d+)_/) ?? [null, f])[1];

const files = readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).sort();

const tables = new Map();   // name -> { columns: Map<name, {type, since}>, since }
const functions = new Map(); // "name(argtypes)" -> { name, args, last, count, dropped }
const policies = new Map();  // "table|name" -> { table, name, action, last, dropped }
const indexes = new Map();   // name -> { table, cols, last }
const triggers = new Map();  // name -> { table, last, dropped }

for (const file of files) {
  const mig = shortName(file);
  const sql = stripComments(readFileSync(join(MIG_DIR, file), 'utf8'));

  // ── create table ─────────────────────────────────────────────
  for (const m of sql.matchAll(/create table (?:if not exists )?(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
    const [, name, body] = m;
    if (!tables.has(name)) tables.set(name, { columns: new Map(), since: mig });
    const t = tables.get(name);
    for (const raw of body.split('\n')) {
      const line = raw.trim().replace(/,$/, '');
      if (!line) continue;
      // Tabellen-Constraints sind keine Spalten
      if (/^(primary key|unique|constraint|foreign key|check)\b/i.test(line)) continue;
      const col = line.match(/^(\w+)\s+(.*)$/);
      if (col) t.columns.set(col[1], { type: col[2], since: mig });
    }
  }

  // ── alter table add / drop column ────────────────────────────
  for (const m of sql.matchAll(/alter table (\w+)\s+add column (?:if not exists )?(\w+)([^;]*);/gi)) {
    const [, table, col, rest] = m;
    if (!tables.has(table)) tables.set(table, { columns: new Map(), since: '?' });
    tables.get(table).columns.set(col, { type: rest.trim(), since: mig });
  }
  for (const m of sql.matchAll(/alter table (\w+)\s+drop column (?:if exists )?(\w+)/gi)) {
    const [, table, col] = m;
    tables.get(table)?.columns.delete(col);
  }

  // ── Funktionen ───────────────────────────────────────────────
  // Argumentliste endet vor "returns". Argumente enthalten hier nie
  // geschachtelte Klammern, deshalb reicht der nicht-gierige Block.
  for (const m of sql.matchAll(/create (?:or replace )?function (\w+)\s*\(([\s\S]*?)\)\s*returns/gi)) {
    const [, name, args] = m;
    const key = `${name}(${normArgs(args)})`;
    const prev = functions.get(key);
    functions.set(key, {
      name, args: args.trim(), last: mig,
      count: (prev?.count ?? 0) + 1,
      dropped: false,
    });
  }
  for (const m of sql.matchAll(/drop function (?:if exists )?(\w+)\s*\(([^)]*)\)/gi)) {
    const [, name, args] = m;
    const key = `${name}(${normArgs(args)})`;
    if (functions.has(key)) functions.get(key).dropped = mig;
  }
  for (const m of sql.matchAll(/drop function (?:if exists )?(\w+)\s*\(\s*\)/gi)) {
    const key = `${m[1]}()`;
    if (functions.has(key)) functions.get(key).dropped = mig;
  }
  // Ein DROP unmittelbar vor dem Neuanlegen (z.B. weil sich der
  // Rueckgabetyp geaendert hat) ist kein Entfernen: das create in
  // derselben Datei gewinnt.
  for (const m of sql.matchAll(/create (?:or replace )?function (\w+)\s*\(([\s\S]*?)\)\s*returns/gi)) {
    const key = `${m[1]}(${normArgs(m[2])})`;
    if (functions.has(key)) functions.get(key).dropped = false;
  }

  // ── Policies ─────────────────────────────────────────────────
  for (const m of sql.matchAll(/create policy\s+"([^"]+)"\s*\n?\s*on (\w+)\s+for (\w+)/gi)) {
    const [, name, table, action] = m;
    policies.set(`${table}|${name}`, { table, name, action: action.toLowerCase(), last: mig, dropped: false });
  }
  for (const m of sql.matchAll(/drop policy (?:if exists )?"([^"]+)" on (\w+)/gi)) {
    const [, name, table] = m;
    const p = policies.get(`${table}|${name}`);
    // Ein DROP direkt vor dem Neuanlegen ist kein Entfernen -- das faengt
    // die Reihenfolge ab: das spaetere create ueberschreibt dropped wieder.
    if (p) p.dropped = mig;
  }
  // create nach drop in derselben Datei gewinnt
  for (const m of sql.matchAll(/create policy\s+"([^"]+)"\s*\n?\s*on (\w+)/gi)) {
    const p = policies.get(`${m[2]}|${m[1]}`);
    if (p) p.dropped = false;
  }

  // ── Indizes ──────────────────────────────────────────────────
  for (const m of sql.matchAll(/create index (?:if not exists )?(\w+)\s*\n?\s*on (\w+)\s*\(([^)]*)\)/gi)) {
    indexes.set(m[1], { table: m[2], cols: m[3].replace(/\s+/g, ' ').trim(), last: mig });
  }

  // ── Trigger ──────────────────────────────────────────────────
  for (const m of sql.matchAll(/create trigger (\w+)\s*\n?\s*(?:before|after)[^\n]*on (\w+)/gi)) {
    triggers.set(m[1], { table: m[2], last: mig, dropped: false });
  }
  for (const m of sql.matchAll(/drop trigger (?:if exists )?(\w+) on (\w+)/gi)) {
    if (triggers.has(m[1])) triggers.get(m[1]).dropped = mig;
  }
  for (const m of sql.matchAll(/create trigger (\w+)/gi)) {
    if (triggers.has(m[1])) triggers.get(m[1]).dropped = false;
  }
}

/** Nur die Typen, damit "p_id uuid" und "uuid" denselben Schluessel ergeben. */
function normArgs(args) {
  return args
    .split(',')
    .map(a => a.trim())
    .filter(Boolean)
    .map(a => {
      const parts = a.split(/\s+/);
      return (parts.length > 1 ? parts.slice(1).join(' ') : parts[0]).toLowerCase();
    })
    .join(', ');
}

// ── Ausgabe ────────────────────────────────────────────────────
const L = [];
L.push('# Aktueller Stand der Datenbank');
L.push('');
L.push('**Generiert — nicht von Hand bearbeiten.** Neu erzeugen mit `npm run schema`.');
L.push('');
L.push(`Aus ${files.length} Migrationen in \`supabase/migrations/\` zusammengesetzt. Die Spalte`);
L.push('„Migration" nennt die Datei, in der das Objekt **zuletzt** definiert wurde — dort steht');
L.push('die verbindliche Fassung samt Begründung. Dieser Index ersetzt die Migrationen nicht,');
L.push('er zeigt auf die richtige.');
L.push('');

L.push('## Tabellen');
L.push('');
for (const [name, t] of [...tables].sort()) {
  L.push(`### ${name}`);
  L.push('');
  L.push('| Spalte | Typ | seit |');
  L.push('|---|---|---|');
  for (const [col, c] of t.columns) {
    L.push(`| \`${col}\` | ${c.type.replace(/\|/g, '\\|') || '—'} | ${c.since} |`);
  }
  L.push('');
}

L.push('## Funktionen');
L.push('');
L.push('| Funktion | Migration | Fassungen |');
L.push('|---|---|---|');
for (const [key, f] of [...functions].sort()) {
  if (f.dropped) continue;
  L.push(`| \`${key}\` | ${f.last} | ${f.count} |`);
}
L.push('');
const droppedFns = [...functions].filter(([, f]) => f.dropped);
if (droppedFns.length) {
  L.push('Entfernt: ' + droppedFns.map(([k, f]) => `\`${k}\` (in ${f.dropped})`).join(', '));
  L.push('');
}

L.push('## Trigger');
L.push('');
L.push('| Trigger | Tabelle | Migration |');
L.push('|---|---|---|');
for (const [name, t] of [...triggers].sort()) {
  if (t.dropped) continue;
  L.push(`| \`${name}\` | ${t.table} | ${t.last} |`);
}
L.push('');

L.push('## Policies');
L.push('');
L.push('| Tabelle | Aktion | Policy | Migration |');
L.push('|---|---|---|---|');
for (const [, p] of [...policies].sort()) {
  if (p.dropped) continue;
  L.push(`| ${p.table} | ${p.action} | ${p.name} | ${p.last} |`);
}
L.push('');

L.push('## Indizes');
L.push('');
if (indexes.size === 0) {
  L.push('_keine_');
} else {
  L.push('| Index | Tabelle | Spalten | Migration |');
  L.push('|---|---|---|---|');
  for (const [name, i] of [...indexes].sort()) {
    L.push(`| \`${name}\` | ${i.table} | ${i.cols} | ${i.last} |`);
  }
}
L.push('');

writeFileSync(OUT, L.join('\n'), 'utf8');
console.log(`CURRENT.md geschrieben: ${tables.size} Tabellen, ${[...functions.values()].filter(f => !f.dropped).length} Funktionen, ${[...policies.values()].filter(p => !p.dropped).length} Policies, ${indexes.size} Indizes.`);
