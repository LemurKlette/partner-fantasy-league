import AsyncStorage from '@react-native-async-storage/async-storage';

// Zwischenspeicher fuer zuletzt geladene Listen.
//
// Zweck: Ohne Netz zeigte die App bisher leere Listen plus einen
// Fehlerdialog -- fuer die Nutzerin nicht von "kaputt" zu unterscheiden.
// Mit dem Cache startet sie in den letzten bekannten Stand.
//
// Bewusst KEIN Ersatz fuer die Datenbank: hier liegen nur Anzeigedaten,
// die beim naechsten erfolgreichen Laden ueberschrieben werden. Punktwerte
// und Badges entscheidet weiterhin ausschliesslich der Server.

const PREFIX = 'cache:v1:';

/** Schluessel sind pro Nutzerin getrennt -- sonst sieht die naechste
 *  Anmeldung auf demselben Geraet die Daten der vorherigen. */
function fullKey(userId: string, key: string): string {
  return `${PREFIX}${userId}:${key}`;
}

export async function cacheSet(userId: string, key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(fullKey(userId, key), JSON.stringify(value));
  } catch {
    // Schreibfehler im Cache duerfen den Ablauf nie stoeren: die Daten sind
    // gerade frisch aus dem Netz gekommen und stehen bereits auf dem Schirm.
  }
}

export async function cacheGet<T>(userId: string, key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(fullKey(userId, key));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Beim Abmelden aufraeumen -- der naechste Login soll nicht kurz die
 *  Gruppen der Vorgaengerin sehen. */
export async function cacheClearForUser(userId: string): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter(k => k.startsWith(`${PREFIX}${userId}:`));
    if (mine.length > 0) await AsyncStorage.multiRemove(mine);
  } catch {
    // siehe oben
  }
}

// Schluesselnamen an einer Stelle, damit Schreiber und Leser nicht
// auseinanderlaufen.
export const CACHE_KEYS = {
  partners: 'partners',
  groups: 'groups',
  groupAvatars: 'group-avatars',
  ranking: (groupId: string, period: string) => `ranking:${groupId}:${period}`,
  activityLog: (groupId: string) => `activity:${groupId}`,
  earnedBadges: (groupId: string) => `badges:${groupId}`,
  groupMembers: (groupId: string) => `members:${groupId}`,
};
