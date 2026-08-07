import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

// Warteschlange fuer Punktevergaben ohne Netz.
//
// Warum nur Punktevergaben: Es ist die einzige Aktion, die im Alltag
// spontan passiert ("er hat gerade den Muell rausgebracht") und deren
// Verlust wirklich aergert. Gruppe anlegen oder beitreten passiert einmal
// und vertraegt ein "gleich nochmal versuchen".
//
// Was hier BEWUSST nicht passiert: die Punkte ausrechnen. Der Wert
// entsteht im Trigger apply_point_entry_rules und haengt vom Tagesstand
// in der Gruppe ab, den das Geraet offline nicht kennen kann. Der Eintrag
// steht deshalb bis zur Uebertragung ohne Zahl im Log. Ein selbst
// geschaetzter Wert waere haeufig falsch und wuerde nach dem Sync
// sichtbar nach unten springen.

const QUEUE_KEY = 'offline-queue:v1:point-entries';

export type PendingEntry = {
  local_id: string;
  /** Zeitpunkt des Tippens -- nur fuer Anzeige und Reihenfolge. Der
   *  created_at-Wert in der Datenbank entsteht beim Uebertragen. */
  queued_at: string;
  partner_id: string;
  partner_name: string;
  group_id: string;
  category_id: string;
  /** Anzeigedaten, damit der wartende Eintrag im Log aussieht wie ein
   *  echter -- ohne dass dafuer die Kategorie nachgeladen werden muss. */
  category_name: string;
  icon_key: string | null;
  cat_tag: string | null;
  note: string | null;
  without_request: boolean;
};

async function readRaw(): Promise<PendingEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as PendingEntry[]) : [];
  } catch {
    return [];
  }
}

async function writeRaw(entries: PendingEntry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(entries));
  } catch {
    // Nichts zu retten: schlaegt das Schreiben fehl, ist der Eintrag weg.
    // Der Aufrufer hat die Nutzerin bereits darueber informiert, dass der
    // Eintrag wartet -- mehr laesst sich hier nicht tun.
  }
}

export async function readQueue(): Promise<PendingEntry[]> {
  return readRaw();
}

export async function enqueue(entry: Omit<PendingEntry, 'local_id' | 'queued_at'>): Promise<PendingEntry> {
  const full: PendingEntry = {
    ...entry,
    // Kein crypto.randomUUID in React Native -- Zeitstempel plus Zufall
    // reicht hier vollkommen, der Schluessel ist rein lokal.
    local_id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    queued_at: new Date().toISOString(),
  };
  const all = await readRaw();
  all.push(full);
  await writeRaw(all);
  return full;
}

export type FlushResult = {
  /** erfolgreich uebertragen */
  sent: number;
  /** vom Server endgueltig abgelehnt und deshalb verworfen */
  rejected: { entry: PendingEntry; message: string }[];
  /** wegen fehlender Verbindung liegengeblieben */
  remaining: number;
};

/** Erkennt, ob ein Fehler am Netz lag. Nur dann bleibt der Eintrag in der
 *  Warteschlange -- bei einer fachlichen Ablehnung (Kategorie archiviert,
 *  Gruppe geloescht) wuerde jeder weitere Versuch genauso scheitern und die
 *  Warteschlange fuer immer blockieren. */
function isNetworkError(error: { message?: string } | null | undefined): boolean {
  const m = (error?.message ?? '').toLowerCase();
  return (
    m.includes('network request failed') ||
    m.includes('failed to fetch') ||
    m.includes('network error') ||
    m.includes('timeout') ||
    m.includes('load failed')
  );
}

/**
 * Arbeitet die Warteschlange in der Reihenfolge des Eintragens ab.
 *
 * Die Reihenfolge ist wichtig: die Anti-Farming-Regeln werten den zweiten
 * Eintrag derselben Aufgabe am selben Tag nur halb. Wuerden die Eintraege
 * durcheinander uebertragen, bekaeme die falsche Aufgabe den vollen Wert.
 *
 * Bricht beim ersten Netzfehler ab und laesst den Rest stehen.
 */
export async function flushQueue(): Promise<FlushResult> {
  const all = await readRaw();
  if (all.length === 0) return { sent: 0, rejected: [], remaining: 0 };

  const rejected: FlushResult['rejected'] = [];
  let sent = 0;
  let index = 0;

  for (; index < all.length; index++) {
    const e = all[index];
    // try/catch zusaetzlich zum error-Rueckgabewert: wirft der Aufruf statt
    // zurueckzugeben, wuerde die Schleife sonst abbrechen und die bereits
    // gesendeten Eintraege blieben in der Warteschlange stehen -- beim
    // naechsten Versuch waeren sie doppelt.
    let error: { message: string } | null = null;
    try {
      const res = await supabase.rpc('add_point_entry', {
        p_partner_id: e.partner_id,
        p_group_id: e.group_id,
        p_category_id: e.category_id,
        p_note: e.note,
        p_without_request: e.without_request,
      });
      error = res.error;
    } catch (thrown: any) {
      error = { message: String(thrown?.message ?? thrown) };
    }

    if (!error) {
      sent++;
      continue;
    }
    if (isNetworkError(error)) break;   // weiterhin kein Netz: Rest bleibt liegen
    rejected.push({ entry: e, message: error.message });
  }

  // Alles bis index ist erledigt (uebertragen oder endgueltig abgelehnt).
  const remainingEntries = all.slice(index);
  await writeRaw(remainingEntries);

  return { sent, rejected, remaining: remainingEntries.length };
}

export { isNetworkError };
