// Zuordnung semantischer Namen auf MaterialCommunityIcons.
// Regel: Im UI-Code steht nie ein Icon-Name direkt, sondern immer ICONS.xyz.
// Ausschliesslich MaterialCommunityIcons — kein Mischen mit anderen Icon-Sets.

export const ICONS = {
  // ── Kategorien ──────────────────────────────────────
  categoryHousehold: 'broom',
  categoryMentalLoad: 'brain',
  categoryRomance: 'heart-outline',
  categoryReliability: 'shield-outline',

  // ── Aufgaben: Haushalt ──────────────────────────────
  taskTrash: 'trash-can-outline',
  taskDishwasher: 'dishwasher',
  taskTable: 'silverware-fork-knife',
  taskLaundryIn: 'washing-machine',
  taskLaundryFold: 'tshirt-crew-outline',
  taskVacuum: 'vacuum-outline',
  taskGroceries: 'cart-outline',
  taskCookDaily: 'pot-steam-outline',
  taskBathroom: 'shower-head',
  taskKitchen: 'countertop-outline',
  taskCookFancy: 'chef-hat',
  taskDeepClean: 'spray-bottle',
  taskDeclutter: 'garage-open-variant',

  // ── Aufgaben: Mental Load ───────────────────────────
  taskRemindAppointment: 'bell-outline',
  taskMakeAppointment: 'calendar-plus',
  taskGiftForOthers: 'gift-outline',
  taskMedicalAppointment: 'medical-bag',
  taskPaperwork: 'file-document-outline',
  taskCraftsmen: 'hammer-wrench',
  taskVacationPlanning: 'airplane',

  // ── Aufgaben: Romantik ──────────────────────────────
  taskCompliment: 'chat-outline',
  taskSweetMessage: 'message-text-outline',
  taskFavoriteSnack: 'food-croissant',
  taskHandwrittenNote: 'fountain-pen-tip',
  taskFlowers: 'flower-outline',
  taskDateNight: 'glass-wine',
  taskAnniversary: 'cake-variant-outline',
  taskWeekendTrip: 'map-marker-outline',

  // ── Aufgaben: Verlaesslichkeit ──────────────────────
  taskPunctual: 'clock-check-outline',
  taskPhoneAway: 'cellphone-off',
  taskChildcare: 'human-male-child',
  taskSchoolStuff: 'school-outline',
  taskConflictResolved: 'handshake-outline',
  taskFamilyVisit: 'home-group',

  // ── Navigation & UI ─────────────────────────────────
  navGroups: 'account-group-outline',
  navProfile: 'account-circle-outline',
  navSettings: 'cog-outline',
  navHelp: 'help-circle-outline',
  actionAddPoints: 'plus-circle-outline',
  actionDelete: 'trash-can-outline',
  actionEdit: 'pencil-outline',
  actionBack: 'chevron-left',
  actionCopy: 'content-copy',
  actionLogout: 'logout',
  toggleUnprompted: 'lightning-bolt-outline',
  emptyState: 'inbox-outline',

  // ── Badges: Meilensteine ────────────────────────────
  badgeRookie: 'seed-outline',
  badgeRegular: 'account-check-outline',
  badgePerformer: 'arm-flex-outline',
  badgeLegend: 'crown-outline',
  badgeImmortal: 'diamond-stone',

  // ── Badges: Spezialisten (Stufe 1 / 2 / 3) ──────────
  badgeHousehold1: 'arm-flex-outline',
  badgeHousehold2: 'broom',
  // 'home-star' existiert nicht in MaterialCommunityIcons -> naechstliegende
  // Alternative aus derselben Familie. Die Stufe wird ohnehin ueber die
  // Rahmenform (9-zackiger Stern) ausgedrueckt, nicht ueber das Icon.
  badgeHousehold3: 'home-variant-outline',
  badgeMental1: 'lightbulb-on-outline',
  badgeMental2: 'calendar-month-outline',
  badgeMental3: 'brain',
  // 'message-heart-outline' existiert nicht -> 'email-heart-outline' ist der
  // naechste Treffer (Nachricht + Herz) aus derselben Familie.
  badgeRomance1: 'email-heart-outline',
  badgeRomance2: 'flower-outline',
  badgeRomance3: 'diamond-stone',
  badgeReliability1: 'clock-check-outline',
  badgeReliability2: 'image-filter-hdr',
  badgeReliability3: 'medal-outline',

  // ── Badges: Konsistenz ──────────────────────────────
  badgeStreak4: 'fire',
  badgeStreak12: 'run',
  badgeStreak24: 'weight-lifter',
  badgeComeback: 'rocket-launch-outline',

  // ── Badges: Saisontitel ─────────────────────────────
  badgeWeekWinner: 'trophy-outline',
  badgeMonthWinner: 'trophy-variant-outline',
  badgeSeasonWinner: 'trophy-award',

  // ── Badges: versteckt ───────────────────────────────
  badgeClairvoyant: 'crystal-ball',
  badgeAllrounder: 'star-four-points-outline',
  badgeDishwasherWhisperer: 'dishwasher',
  badgeRemembers: 'calendar-heart',
  badgeSurprise: 'gift-open-outline',
  badgeEagerStudent: 'clipboard-check-outline',
} as const;

export type IconKey = keyof typeof ICONS;

// Einheitliche Icon-Groessen
export const ICON_SIZE = {
  inline: 20,    // inline im Text / kleine Aktionen
  list: 24,      // Listenzeilen
  category: 28,  // Kategoriekreise
  badge: 32,     // Badges
} as const;

// Aufloesung eines gespeicherten icon_key aus der Datenbank auf den
// tatsaechlichen Icon-Namen. Faellt auf ein neutrales Icon zurueck, falls
// ein unbekannter Schluessel ankommt.
export function iconFor(key: string | null | undefined, fallback: string = ICONS.emptyState): string {
  if (!key) return fallback;
  return (ICONS as Record<string, string>)[key] ?? fallback;
}
