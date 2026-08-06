import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { decode } from 'base64-arraybuffer';
import { supabase } from './lib/supabase';
import type { Session } from '@supabase/supabase-js';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import BadgeGrid from './components/BadgeGrid';
import Avatar from './components/Avatar';
import { CATEGORY_COLORS, CATEGORY_TAG_TO_KEY, COLORS, type CategoryKey } from './theme/colors';
import { CUSTOM_CATEGORY_ICON_CHOICES, ICON_SIZE, ICONS, iconFor, type IconKey } from './theme/icons';

type Partner = { id: string; name: string; avatar_url?: string | null };
type Group = { id: string; name: string; invite_code: string; created_by: string };
type GroupMember = { user_id: string; partner: Partner | null };
type GroupPartnerPreview = { id: string; name: string; avatar_url: string | null };
type Category = { id: string; name: string; points: number; icon_key: string | null; is_global: boolean; tier: number | null; multiplier_eligible: boolean; category_tag: string | null };
type RankingEntry = { partner_id: string; name: string; total: number };
type EarnedBadge = { partner_id: string; icon_key: string | null; name: string; category_filter: string | null };
type ManConnection = { id: string; invite_code: string; connected_at: string | null; partners: { id: string; name: string; avatar_url: string | null } };
type PartnerWithCode = { id: string; name: string; invite_code: string; avatar_url: string | null };
type ActivityEntry = {
  id: string; points: number; created_at: string; note: string | null; created_by: string;
  capped_reason: string | null;
  without_request: boolean;
  partners: { name: string };
  point_categories: { name: string; icon_key: string | null; category_tag: string | null };
};
type Period = 'week' | 'month' | 'year';
type GroupPartnerMembership = { partner_id: string; active: boolean };
type Screen =
  | 'loading' | 'auth' | 'create-partner'
  | 'groups' | 'create-group' | 'join-group'
  | 'group-detail' | 'add-points' | 'create-category' | 'manage-categories' | 'profile' | 'help'
  | 'onboarding-choice' | 'show-partner-code' | 'enter-invite-code' | 'man-profile' | 'partner-badges';

const CATEGORY_TAG_ORDER = ['haushalt', 'mental_load', 'romantik', 'verlaesslichkeit'];
const CATEGORY_TAG_LABELS: Record<string, string> = {
  haushalt: 'Haushalt',
  mental_load: 'Mental Load',
  romantik: 'Romantik & Aufmerksamkeit',
  verlaesslichkeit: 'Verlässlichkeit & Partnerschaft',
};
const CATEGORY_TAG_ICONS: Record<string, string> = {
  haushalt: ICONS.categoryHousehold,
  mental_load: ICONS.categoryMentalLoad,
  romantik: ICONS.categoryRomance,
  verlaesslichkeit: ICONS.categoryReliability,
};

// Farbpaar einer Kategorie. Faellt auf Ocker zurueck, wenn eine eigene
// Kategorie ohne category_tag angelegt wurde.
// Selbst erstellte Kategorien haben keinen category_tag und bekommen
// deshalb das neutrale Taupe -- so sind sie auf den ersten Blick von den
// vier Standard-Kategorien zu unterscheiden.
function catColors(tag: string | null | undefined) {
  const key = tag ? CATEGORY_TAG_TO_KEY[tag] : undefined;
  return CATEGORY_COLORS[(key ?? 'custom') as CategoryKey];
}

// Kategorie-Icon im farbigen Kreis (Aufgabenlisten, Aktivitaetslog)
function CategoryIcon({ tag, iconKey, size = ICON_SIZE.category, circle = 40 }: {
  tag: string | null | undefined;
  iconKey?: string | null;
  size?: number;
  circle?: number;
}) {
  const c = catColors(tag);
  const name = iconKey ? iconFor(iconKey) : (CATEGORY_TAG_ICONS[tag ?? ''] ?? ICONS.actionAddPoints);
  return (
    <View style={[s.catCircle, { width: circle, height: circle, borderRadius: circle / 2, backgroundColor: c.fill }]}>
      <MaterialCommunityIcons name={name as any} size={size} color={c.stroke} />
    </View>
  );
}

const TIERS: { tier: number; points: number; label: string }[] = [
  { tier: 1, points: 2, label: 'Tier 1 · 2 Pkt' },
  { tier: 2, points: 5, label: 'Tier 2 · 5 Pkt' },
  { tier: 3, points: 10, label: 'Tier 3 · 10 Pkt' },
  { tier: 4, points: 20, label: 'Tier 4 · 20 Pkt' },
  { tier: 5, points: 40, label: 'Tier 5 · 40 Pkt' },
];

function generatePartnerCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return 'P-' + Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function generateInviteCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function getStartDate(period: Period): string {
  const now = new Date();
  if (period === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() - (d.getDay() === 0 ? 6 : d.getDay() - 1));
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  } else if (period === 'month') {
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  } else {
    return new Date(now.getFullYear(), 0, 1).toISOString();
  }
}

// Zentrale Fehlermeldung fuer fehlgeschlagene Abfragen. Ohne sie endete
// jeder Fehler in einer leeren Liste, ohne jeden Hinweis auf die Ursache.
// Gibt true zurueck, wenn ein Fehler vorlag -- Aufrufer brechen damit ab.
let lastErrorAlertAt = 0;
function failed(title: string, error: { message: string } | null | undefined): boolean {
  if (!error) return false;
  // Bei parallelen Abfragen (z.B. Ranking + Log + Badges) schlagen im
  // Offline-Fall alle gleichzeitig fehl. Nur die erste Meldung zeigen,
  // sonst stapeln sich mehrere Dialoge uebereinander.
  const now = Date.now();
  if (now - lastErrorAlertAt > 1500) {
    lastErrorAlertAt = now;
    Alert.alert(title, error.message);
  }
  return true;
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'gerade eben';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.floor(hours / 24);
  return `vor ${days} Tag${days > 1 ? 'en' : ''}`;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [partner, setPartner] = useState<Partner | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [membersExpanded, setMembersExpanded] = useState(false);
  const [ranking, setRanking] = useState<RankingEntry[]>([]);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [note, setNote] = useState('');
  const [newCatName, setNewCatName] = useState('');
  const [newCatTier, setNewCatTier] = useState<number | null>(null);
  const [newCatIconKey, setNewCatIconKey] = useState<IconKey>('helpCustomCategory');
  const [withoutRequest, setWithoutRequest] = useState(false);
  const [earnedBadges, setEarnedBadges] = useState<EarnedBadge[]>([]);
  const [helpTab, setHelpTab] = useState<'frauen' | 'maenner' | 'faq'>('frauen');
  const [helpReturnScreen, setHelpReturnScreen] = useState<Screen>('groups');
  const [generatedPartnerCode, setGeneratedPartnerCode] = useState('');
  const [partnerInviteInput, setPartnerInviteInput] = useState('');
  const [manConnections, setManConnections] = useState<ManConnection[]>([]);
  const [myPartners, setMyPartners] = useState<PartnerWithCode[]>([]);
  const [editEmail, setEditEmail] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editPasswordConfirm, setEditPasswordConfirm] = useState('');
  const [editPartnerNames, setEditPartnerNames] = useState<Record<string, string>>({});
  const [showAddPartnerForm, setShowAddPartnerForm] = useState(false);
  const [newPartnerNameForProfile, setNewPartnerNameForProfile] = useState('');
  const [groupCustomCats, setGroupCustomCats] = useState<Category[]>([]);
  const [period, setPeriod] = useState<Period>('week');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [groupName, setGroupName] = useState('');
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);
  const [groupPartnerMemberships, setGroupPartnerMemberships] = useState<GroupPartnerMembership[]>([]);
  const [selectedPartnerIdForPoints, setSelectedPartnerIdForPoints] = useState<string | null>(null);
  const [myAllPartners, setMyAllPartners] = useState<Partner[]>([]);
  const [viewedPartner, setViewedPartner] = useState<Partner | null>(null);
  const [groupAvatarsMap, setGroupAvatarsMap] = useState<Record<string, GroupPartnerPreview[]>>({});

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) { setSession(session); loadUserData(session); }
      else setScreen('auth');
    });
  }, []);

  // Zeitzone des Geraets an den Server melden. Die Anti-Farming-Regeln
  // brauchen sie, um die Tagesgrenze richtig zu ziehen (vorher lief das
  // in UTC, der neue Tag begann im Sommer also um 02:00 Uhr).
  async function reportDeviceTimezone() {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) await supabase.rpc('set_my_timezone', { p_tz: tz });
    } catch {
      // Ohne Meldung faellt der Server auf Europe/Berlin zurueck.
    }
  }

  async function loadUserData(session: Session) {
    reportDeviceTimezone();
    const { data: pts, error: ptsErr } = await supabase.from('partners').select('id, name, avatar_url')
      .eq('owner_user_id', session.user.id).order('created_at');
    // Ohne Abbruch wuerde ein Fehler hier faelschlich als "noch kein
    // Partner vorhanden" gedeutet und die Onboarding-Auswahl zeigen.
    // Bei einem Fehler geht es zum Login-Screen: die Sitzung bleibt gueltig,
    // ein erneuter Anlauf laedt die Daten nochmal -- ein stehenbleibender
    // Ladekreis waere die schlechtere Alternative.
    if (failed('Verbindung fehlgeschlagen', ptsErr)) { setScreen('auth'); return; }
    const p = (pts ?? [])[0] ?? null;
    if (p) { setPartner(p); await loadGroups(session); return; }
    const { data: conns, error: connErr } = await supabase.from('partner_connections')
      .select('id').eq('man_user_id', session.user.id).is('disconnected_at', null).limit(1);
    if (failed('Verbindung fehlgeschlagen', connErr)) { setScreen('auth'); return; }
    if (conns && conns.length > 0) { await loadManProfile(session.user.id); return; }
    setScreen('onboarding-choice');
  }

  async function loadManProfile(userId: string) {
    const { data, error } = await supabase.from('partner_connections')
      .select('id, invite_code, connected_at, partners(id, name, avatar_url)')
      .eq('man_user_id', userId)
      .is('disconnected_at', null);
    if (failed('Verbindungen konnten nicht geladen werden', error)) return;
    // Supabase typisiert 1:1-Relationen als Array; zur Laufzeit ist es ein Objekt.
    setManConnections((data ?? []) as unknown as ManConnection[]);
    setScreen('man-profile');
  }

  async function handleEnterPartnerInviteCode() {
    if (!partnerInviteInput.trim()) return;
    setLoading(true);
    const { error } = await supabase.rpc('connect_to_partner', { code: partnerInviteInput.trim().toUpperCase() });
    if (error) Alert.alert('Fehler', error.message);
    else { setPartnerInviteInput(''); await loadManProfile(session!.user.id); }
    setLoading(false);
  }

  async function handleDisconnect(connectionId: string, pName: string) {
    Alert.alert('Verbindung trennen', `Wirklich von "${pName}" trennen? Deine bisherigen Punkte bleiben erhalten.`, [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Trennen', style: 'destructive', onPress: async () => {
        const { error } = await supabase.from('partner_connections')
          .update({ disconnected_at: new Date().toISOString() })
          .eq('id', connectionId);
        if (error) Alert.alert('Fehler', error.message);
        else setManConnections(prev => prev.filter(c => c.id !== connectionId));
      }},
    ]);
  }

  async function loadGroups(session: Session) {
    const { data, error } = await supabase.from('group_members').select('groups(id, name, invite_code, created_by)')
      .eq('user_id', session.user.id);
    if (failed('Gruppen konnten nicht geladen werden', error)) return;
    const gs = ((data ?? []) as any[]).map(r => r.groups).filter(Boolean) as Group[];
    setGroups(gs);
    setScreen('groups');
    loadGroupAvatarPreviews(gs.map(g => g.id));
  }

  async function loadGroupAvatarPreviews(groupIds: string[]) {
    if (groupIds.length === 0) { setGroupAvatarsMap({}); return; }
    const [{ data: memberRows, error: e1 }, { data: memberships, error: e2 }] = await Promise.all([
      supabase.from('group_members').select('group_id, user_id').in('group_id', groupIds),
      supabase.from('group_partner_memberships').select('group_id, partner_id, active').in('group_id', groupIds),
    ]);
    if (failed('Gruppenbilder konnten nicht geladen werden', e1 ?? e2)) return;
    const userIds = Array.from(new Set((memberRows ?? []).map((m: any) => m.user_id)));
    const { data: partnerRows, error: e3 } = await supabase.from('partners').select('id, name, avatar_url, owner_user_id').in('owner_user_id', userIds);
    if (failed('Gruppenbilder konnten nicht geladen werden', e3)) return;
    const activeMap = new Map<string, boolean>();
    (memberships ?? []).forEach((m: any) => activeMap.set(`${m.group_id}:${m.partner_id}`, m.active));

    const map: Record<string, GroupPartnerPreview[]> = {};
    (memberRows ?? []).forEach((m: any) => {
      ((partnerRows ?? []) as any[])
        .filter(p => p.owner_user_id === m.user_id)
        .forEach(p => {
          if ((activeMap.get(`${m.group_id}:${p.id}`) ?? true) === false) return;
          (map[m.group_id] ??= []).push({ id: p.id, name: p.name, avatar_url: p.avatar_url });
        });
    });
    setGroupAvatarsMap(map);
  }

  async function loadRankingForGroup(groupId: string, p: Period) {
    setRankingLoading(true);
    const { data: memberRows, error: e1 } = await supabase.from('group_members').select('user_id').eq('group_id', groupId);
    if (failed('Ranking konnte nicht geladen werden', e1)) { setRankingLoading(false); return; }
    const userIds = (memberRows ?? []).map((m: any) => m.user_id);
    const [{ data: partnerRows, error: e2 }, { data: memberships, error: e3 }, { data: entries, error: e4 }] = await Promise.all([
      supabase.from('partners').select('id, name, owner_user_id').in('owner_user_id', userIds),
      supabase.from('group_partner_memberships')
        .select('partner_id, active').eq('group_id', groupId).eq('active', true),
      supabase.from('point_entries').select('partner_id, points')
        .eq('group_id', groupId).gte('created_at', getStartDate(p)),
    ]);
    if (failed('Ranking konnte nicht geladen werden', e2 ?? e3 ?? e4)) { setRankingLoading(false); return; }
    const activeIds = new Set((memberships ?? []).map((m: any) => m.partner_id));
    const activePartners = ((partnerRows ?? []) as any[]).filter(pr => activeIds.has(pr.id));
    const totals: Record<string, number> = {};
    (entries ?? []).forEach((e: any) => { totals[e.partner_id] = (totals[e.partner_id] || 0) + e.points; });
    setRanking(activePartners
      .map(pr => ({ partner_id: pr.id, name: pr.name, total: totals[pr.id] || 0 }))
      .sort((a, b) => b.total - a.total));
    setRankingLoading(false);
  }

  async function loadEarnedBadges(groupId: string) {
    const { data, error } = await supabase.from('partner_badges')
      .select('partner_id, badges(icon_key, name, category_filter)')
      .eq('group_id', groupId);
    if (failed('Badges konnten nicht geladen werden', error)) return;
    setEarnedBadges(((data ?? []) as any[]).map(r => ({
      partner_id: r.partner_id,
      icon_key: (r.badges as any)?.icon_key ?? null,
      name: (r.badges as any)?.name ?? '',
      category_filter: (r.badges as any)?.category_filter ?? null,
    })));
  }

  function mondayOf(d: Date): Date {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    const day = x.getDay();
    x.setDate(x.getDate() - (day === 0 ? 6 : day - 1));
    return x;
  }
  function weekKeyOf(dateStr: string): string {
    return mondayOf(new Date(dateStr)).toISOString().slice(0, 10);
  }
  function monthKeyOf(dateStr: string): string {
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${d.getMonth()}`;
  }

  // Badge-Bedingungen werden global (ueber alle Gruppen des Partners) geprueft,
  // Typ 1/2/3/5 sind partnerweite Erfolge. Nur Typ 4 (Saisontitel) ist pro
  // Gruppe und wird serverseitig per pg_cron vergeben (siehe award_period_title).
  async function checkAndAwardBadges(partnerId: string, groupId: string) {
    const [{ data: allBadges, error: e1 }, { data: earnedRows, error: e2 }, { data: allEntriesRaw, error: e3 }] = await Promise.all([
      supabase.from('badges').select('*').neq('badge_type', 4),
      supabase.from('partner_badges').select('badge_id, period_key').eq('partner_id', partnerId),
      supabase.from('point_entries')
        .select('points, created_at, without_request, point_categories(name, category_tag, tier, is_global)')
        .eq('partner_id', partnerId),
    ]);
    // Ohne Abbruch wuerden bei einem Fehler alle Zaehler als 0 gelesen und
    // dadurch faelschlich keine Badges vergeben.
    if (failed('Badge-Prüfung fehlgeschlagen', e1 ?? e2 ?? e3)) return;
    const allEntries = (allEntriesRaw ?? []) as any[];
    const earnedIds = new Set((earnedRows ?? []).map((b: any) => b.badge_id));
    const earnedPeriodKeys = new Set((earnedRows ?? []).map((b: any) => `${b.badge_id}:${b.period_key ?? ''}`));

    const totalPoints = allEntries.reduce((sum, e) => sum + e.points, 0);
    const catTotals: Record<string, number> = {};
    allEntries.forEach(e => {
      const tag = (e.point_categories as any)?.category_tag;
      if (tag) catTotals[tag] = (catTotals[tag] || 0) + e.points;
    });

    const nowWeekKey = mondayOf(new Date()).toISOString().slice(0, 10);
    const nowMonthKey = monthKeyOf(new Date().toISOString());
    const weekTotals: Record<string, number> = {};
    allEntries.forEach(e => { const k = weekKeyOf(e.created_at); weekTotals[k] = (weekTotals[k] || 0) + e.points; });

    let streak = 0;
    const cursor = mondayOf(new Date());
    while ((weekTotals[cursor.toISOString().slice(0, 10)] || 0) >= 20) {
      streak++;
      cursor.setDate(cursor.getDate() - 7);
    }

    const thisWeekWithoutRequestCount = allEntries.filter(e => weekKeyOf(e.created_at) === nowWeekKey && e.without_request).length;
    const thisWeekTags = new Set(allEntries.filter(e => weekKeyOf(e.created_at) === nowWeekKey).map(e => (e.point_categories as any)?.category_tag).filter(Boolean));
    const dishwasherCount = allEntries.filter(e => (e.point_categories as any)?.name === 'Geschirrspüler aus-/einräumen').length;
    const hasAnniversaryEntry = allEntries.some(e => (e.point_categories as any)?.name === 'Jahrestag / Geburtstag perfekt gemeistert');
    const tier4ThisMonthCount = allEntries.filter(e => monthKeyOf(e.created_at) === nowMonthKey && (e.point_categories as any)?.tier === 4).length;
    const customCategoryCount = allEntries.filter(e => (e.point_categories as any)?.is_global === false).length;

    // Comeback: aktuelle Woche >= 30 Punkte, davor 3+ Wochen in Folge Pause (0 Punkte),
    // und mindestens ein Eintrag vor der Pause (sonst waere es kein "Comeback").
    let isComeback = false;
    const thisWeekTotal = weekTotals[nowWeekKey] || 0;
    if (thisWeekTotal >= 30) {
      let pauseWeeks = 0;
      const pc = mondayOf(new Date());
      pc.setDate(pc.getDate() - 7);
      while ((weekTotals[pc.toISOString().slice(0, 10)] || 0) === 0) {
        pauseWeeks++;
        pc.setDate(pc.getDate() - 7);
        if (pauseWeeks > 52) break;
      }
      const hadEarlierActivity = allEntries.some(e => new Date(e.created_at) < pc);
      isComeback = pauseWeeks >= 3 && hadEarlierActivity;
    }

    const newBadgeNames: string[] = [];
    for (const badge of (allBadges ?? []) as any[]) {
      let earned = false;
      let periodKey: string | null = null;

      switch (badge.trigger_type) {
        case 'total_points':
          earned = totalPoints >= badge.trigger_value;
          break;
        case 'category_points':
          earned = !!badge.category_filter && (catTotals[badge.category_filter] || 0) >= badge.trigger_value;
          break;
        case 'streak_weeks':
          earned = streak === badge.trigger_value;
          periodKey = nowWeekKey;
          break;
        case 'comeback':
          earned = isComeback;
          periodKey = nowWeekKey;
          break;
        case 'hellseher':
          earned = thisWeekWithoutRequestCount >= badge.trigger_value;
          break;
        case 'allrounder':
          earned = thisWeekTags.size >= badge.trigger_value;
          break;
        case 'dishwasher_count':
          earned = dishwasherCount >= badge.trigger_value;
          break;
        case 'anniversary':
          earned = hasAnniversaryEntry;
          break;
        case 'tier4_month':
          earned = tier4ThisMonthCount >= badge.trigger_value;
          break;
        case 'custom_category_count':
          earned = customCategoryCount >= badge.trigger_value;
          break;
      }

      if (!earned) continue;
      const dedupeKey = `${badge.id}:${periodKey ?? ''}`;
      if (badge.is_repeatable ? earnedPeriodKeys.has(dedupeKey) : earnedIds.has(badge.id)) continue;

      const { error: insertErr } = await supabase.from('partner_badges')
        .insert({ partner_id: partnerId, badge_id: badge.id, group_id: groupId, period_key: periodKey });
      if (!insertErr) newBadgeNames.push(badge.name);
    }
    if (newBadgeNames.length > 0) {
      Alert.alert('Neues Badge verdient!', newBadgeNames.join('\n'));
      await loadEarnedBadges(groupId);
    }
  }

  async function loadActivityLog(groupId: string) {
    const { data, error } = await supabase.from('point_entries')
      .select('id, points, created_at, note, created_by, capped_reason, without_request, partners(name), point_categories(name, icon_key, category_tag)')
      .eq('group_id', groupId).order('created_at', { ascending: false }).limit(10);
    if (failed('Aktivitäten konnten nicht geladen werden', error)) return;
    // Supabase typisiert 1:1-Relationen als Array; zur Laufzeit ist es ein Objekt.
    setActivityLog((data ?? []) as unknown as ActivityEntry[]);
  }

  async function openGroup(group: Group) {
    setSelectedGroup(group);
    setMembersExpanded(false);
    setLoading(true);
    const { data: memberRows, error: e1 } = await supabase.from('group_members').select('user_id').eq('group_id', group.id);
    if (failed('Gruppe konnte nicht geladen werden', e1)) { setLoading(false); return; }
    const userIds = (memberRows ?? []).map((m: any) => m.user_id);

    const [{ data: partnerRows, error: e2 }, { data: myPts, error: e3 }, { data: memberships, error: e4 }] = await Promise.all([
      // avatar_url muss mitgeladen werden, sonst zeigen Mitgliederliste und
      // Partner-Auswahl immer nur die Initialen statt des Fotos.
      supabase.from('partners').select('id, name, avatar_url, owner_user_id').in('owner_user_id', userIds),
      // Meine eigenen Partner (alle, nicht nur den ersten)
      supabase.from('partners').select('id, name, avatar_url')
        .eq('owner_user_id', session!.user.id).order('created_at'),
      supabase.from('group_partner_memberships')
        .select('partner_id, active').eq('group_id', group.id),
    ]);
    if (failed('Gruppe konnte nicht geladen werden', e2 ?? e3 ?? e4)) { setLoading(false); return; }

    const myPtsList = (myPts ?? []) as Partner[];
    setMyAllPartners(myPtsList);

    const membershipMap = new Map<string, boolean>((memberships ?? []).map((m: any) => [m.partner_id, m.active as boolean]));

    // Neue Partner automatisch registrieren (die noch keinen Eintrag haben)
    const unregistered = myPtsList.map(p => p.id).filter(id => !membershipMap.has(id));
    if (unregistered.length > 0) {
      const { error: insertErr } = await supabase.from('group_partner_memberships')
        .insert(unregistered.map(pid => ({ group_id: group.id, partner_id: pid, active: true })));
      if (failed('Partner konnte der Gruppe nicht hinzugefügt werden', insertErr)) { setLoading(false); return; }
      unregistered.forEach(pid => membershipMap.set(pid, true));
    }

    setGroupPartnerMemberships(Array.from(membershipMap.entries()).map(([partner_id, active]) => ({ partner_id, active })));

    // Ersten aktiven Partner vorauswählen
    const firstActive = myPtsList.find(p => membershipMap.get(p.id) !== false);
    setSelectedPartnerIdForPoints(firstActive?.id ?? myPtsList[0]?.id ?? null);

    setGroupMembers(userIds.map(uid => ({
      user_id: uid,
      partner: (partnerRows ?? []).find((p: any) => p.owner_user_id === uid) ?? null,
    })));
    setPeriod('week');
    await Promise.all([loadRankingForGroup(group.id, 'week'), loadActivityLog(group.id), loadEarnedBadges(group.id)]);
    setScreen('group-detail');
    setLoading(false);
  }

  async function handleTogglePartnerMembership(partnerId: string, currentActive: boolean) {
    const { error } = await supabase.from('group_partner_memberships')
      .update({ active: !currentActive })
      .eq('group_id', selectedGroup!.id)
      .eq('partner_id', partnerId);
    if (error) { Alert.alert('Fehler', error.message); return; }
    setGroupPartnerMemberships(prev => prev.map(m =>
      m.partner_id === partnerId ? { ...m, active: !currentActive } : m
    ));
    if (!currentActive === false && selectedPartnerIdForPoints === partnerId) {
      const nextActive = myAllPartners.find(p => p.id !== partnerId && groupPartnerMemberships.find(m => m.partner_id === p.id)?.active);
      setSelectedPartnerIdForPoints(nextActive?.id ?? null);
    }
    await loadRankingForGroup(selectedGroup!.id, period);
  }

  async function handleDeletePartner(partnerId: string, partnerName: string) {
    Alert.alert(
      'Partner loeschen',
      `"${partnerName}" wirklich loeschen? Alle Punkte und Verbindungen werden ebenfalls geloescht.`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Loeschen', style: 'destructive',
          onPress: async () => {
            setLoading(true);
            const { error } = await supabase.rpc('delete_partner', { p_partner_id: partnerId });
            if (error) { Alert.alert('Fehler', error.message); }
            else {
              setMyPartners(prev => prev.filter(p => p.id !== partnerId));
              if (partner?.id === partnerId) setPartner(null);
            }
            setLoading(false);
          },
        },
      ]
    );
  }

  // Punktwerte der Standard-Aufgaben sind fest an ihre Aufwandsstufe
  // gebunden und lassen sich nicht mehr pro Gruppe ueberschreiben --
  // nur so bleiben Gruppen untereinander vergleichbar.
  async function loadCategories(): Promise<boolean> {
    const { data: cats, error } = await supabase.from('point_categories')
      .select('id, name, points, icon_key, is_global, tier, multiplier_eligible, category_tag')
      .or(`is_global.eq.true,group_id.eq.${selectedGroup!.id}`)
      .is('archived_at', null)
      .order('name');
    if (error) {
      // Ohne diese Meldung endete ein Abfragefehler in einer leeren
      // Auswahlliste, ohne jeden Hinweis auf die Ursache.
      Alert.alert('Kategorien konnten nicht geladen werden', error.message);
      return false;
    }
    setCategories((cats ?? []) as Category[]);
    return true;
  }

  async function loadManageCategories() {
    setLoading(true);
    const { data: customCats, error } = await supabase.from('point_categories')
      .select('id, name, points, icon_key, is_global, tier, multiplier_eligible, category_tag')
      .eq('group_id', selectedGroup!.id).is('archived_at', null).order('name');
    setLoading(false);
    if (error) {
      Alert.alert('Kategorien konnten nicht geladen werden', error.message);
      return;
    }
    setGroupCustomCats((customCats ?? []) as Category[]);
    setScreen('manage-categories');
  }

  async function handleDeletePointEntry(entryId: string) {
    Alert.alert('Eintrag löschen', 'Diesen Punkt-Eintrag wirklich löschen? Das kann nicht rückgängig gemacht werden.', [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Löschen', style: 'destructive', onPress: async () => {
        const { error } = await supabase.from('point_entries').delete().eq('id', entryId);
        if (error) Alert.alert('Fehler', error.message);
        else await Promise.all([
          loadRankingForGroup(selectedGroup!.id, period),
          loadActivityLog(selectedGroup!.id),
        ]);
      }},
    ]);
  }

  async function handleDeleteCustomCategory(catId: string, catName: string) {
    Alert.alert('Kategorie löschen', `"${catName}" wirklich löschen? Vergangene Einträge bleiben erhalten.`, [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Löschen', style: 'destructive', onPress: async () => {
        // Wurden fuer die Kategorie bereits Punkte vergeben, wird sie
        // serverseitig archiviert statt geloescht -- sonst scheitert das
        // Loeschen an den referenzierenden Eintraegen.
        const { error } = await supabase.rpc('delete_custom_category', { p_category_id: catId });
        if (error) Alert.alert('Fehler', error.message);
        else setGroupCustomCats(prev => prev.filter(c => c.id !== catId));
      }},
    ]);
  }

  async function handleCreateCategory() {
    if (!newCatName.trim()) { Alert.alert('Fehler', 'Bitte gib einen Namen ein.'); return; }
    if (!newCatTier) { Alert.alert('Fehler', 'Bitte wähle eine Aufwandsstufe.'); return; }
    const pts = TIERS.find(t => t.tier === newCatTier)!.points;
    setLoading(true);
    const { error } = await supabase.from('point_categories').insert({
      name: newCatName.trim(),
      points: pts,
      tier: newCatTier,
      icon_key: newCatIconKey,
      is_global: false,
      created_by: session!.user.id,
      group_id: selectedGroup!.id,
    });
    if (error) Alert.alert('Fehler', error.message);
    else {
      const created = newCatName.trim();
      setNewCatName(''); setNewCatTier(null); setNewCatIconKey('helpCustomCategory');
      // Zurueck zur Gruppe statt in die Kategorieauswahl -- die neue
      // Aufgabe steht beim naechsten "Punkte vergeben" bereit.
      setScreen('group-detail');
      Alert.alert('Kategorie angelegt', `"${created}" steht ab sofort für eure Gruppe bereit.`);
    }
    setLoading(false);
  }

  async function handleLogin() {
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) Alert.alert('Fehler', error.message);
    else { setSession(data.session); await loadUserData(data.session!); }
    setLoading(false);
  }

  async function handleRegister() {
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) Alert.alert('Fehler', error.message);
    else if (data.session) { setSession(data.session); await loadUserData(data.session); }
    else Alert.alert('Bestätigung', 'Bitte bestätige deine E-Mail-Adresse.');
    setLoading(false);
  }

  async function handleCreatePartner() {
    if (!partnerName.trim()) { Alert.alert('Fehler', 'Bitte gib einen Namen ein.'); return; }
    setLoading(true);
    const { data, error } = await supabase.from('partners')
      .insert({ owner_user_id: session!.user.id, name: partnerName.trim() }).select('id, name').single();
    if (error) { Alert.alert('Fehler', error.message); setLoading(false); return; }
    setPartner(data);
    const code = generatePartnerCode();
    const { error: connError } = await supabase.from('partner_connections')
      .insert({ partner_id: data.id, invite_code: code });
    if (connError) { Alert.alert('Fehler beim Code-Generieren', connError.message); setLoading(false); return; }
    setGeneratedPartnerCode(code);
    setScreen('show-partner-code');
    setLoading(false);
  }

  async function handleCreateGroup() {
    if (!groupName.trim()) { Alert.alert('Fehler', 'Bitte gib einen Gruppennamen ein.'); return; }
    setLoading(true);
    const invite_code = generateInviteCode();
    const { data, error } = await supabase.from('groups')
      .insert({ name: groupName.trim(), created_by: session!.user.id, invite_code })
      .select('id, name, invite_code, created_by').single();
    if (error) { Alert.alert('Fehler', error.message); }
    else {
      // Schlaegt das fehl, existiert die Gruppe zwar, die Erstellerin waere
      // aber kein Mitglied und saehe sie nach dem naechsten Login nicht mehr.
      const { error: memberErr } = await supabase.from('group_members')
        .insert({ group_id: data.id, user_id: session!.user.id });
      if (memberErr) {
        Alert.alert('Fehler', `Die Gruppe wurde angelegt, du konntest ihr aber nicht beitreten: ${memberErr.message}`);
        setLoading(false);
        return;
      }
      setGroups(prev => [...prev, data]);
      setGroupName('');
      setScreen('groups');
    }
    setLoading(false);
  }

  async function handleJoinGroup() {
    if (!inviteCodeInput.trim()) { Alert.alert('Fehler', 'Bitte gib einen Code ein.'); return; }
    setLoading(true);
    const { data, error } = await supabase.rpc('join_group_by_invite_code', { code: inviteCodeInput.trim().toUpperCase() });
    if (error) Alert.alert('Fehler', error.message);
    else {
      setGroups(prev => prev.find(g => g.id === data.id) ? prev : [...prev, data]);
      setInviteCodeInput('');
      setScreen('groups');
    }
    setLoading(false);
  }

  async function handleDeleteGroup(groupId: string, groupName: string) {
    Alert.alert(
      'Gruppe löschen',
      `"${groupName}" wirklich löschen? Alle Punkte, Kategorien und Mitgliedschaften dieser Gruppe werden unwiderruflich gelöscht.`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen', style: 'destructive',
          onPress: async () => {
            setLoading(true);
            const { error } = await supabase.rpc('delete_group', { p_group_id: groupId });
            if (error) { Alert.alert('Fehler', error.message); }
            else { setGroups(prev => prev.filter(g => g.id !== groupId)); }
            setLoading(false);
          },
        },
      ]
    );
  }

  async function handleLeaveGroup(groupId: string, groupName: string) {
    Alert.alert(
      'Gruppe verlassen',
      `"${groupName}" wirklich verlassen? Dein Partner erscheint dann nicht mehr im Ranking dieser Gruppe. Die bisherigen Punkte bleiben erhalten.`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Verlassen', style: 'destructive',
          onPress: async () => {
            setLoading(true);
            const { error } = await supabase.rpc('leave_group', { p_group_id: groupId });
            if (error) { Alert.alert('Fehler', error.message); }
            else { setGroups(prev => prev.filter(g => g.id !== groupId)); }
            setLoading(false);
          },
        },
      ]
    );
  }

  async function handleSavePoints() {
    if (!selectedCategory) { Alert.alert('Fehler', 'Bitte wähle eine Kategorie.'); return; }
    const effectivePartnerId = selectedPartnerIdForPoints ?? partner!.id;
    const effectivePartnerName = myAllPartners.find(p => p.id === effectivePartnerId)?.name ?? partner?.name ?? '';
    const applyMultiplier = withoutRequest && selectedCategory.multiplier_eligible;
    const requestedPoints = applyMultiplier ? Math.ceil(selectedCategory.points * 1.5) : selectedCategory.points;
    setLoading(true);
    const { data, error } = await supabase.from('point_entries').insert({
      partner_id: effectivePartnerId, group_id: selectedGroup!.id,
      category_id: selectedCategory.id, points: requestedPoints,
      without_request: applyMultiplier,
      note: note.trim() || null, created_by: session!.user.id,
    }).select('points, capped_reason').single();
    if (error) Alert.alert('Fehler', error.message);
    else {
      setSelectedCategory(null);
      setNote('');
      setWithoutRequest(false);
      await Promise.all([loadRankingForGroup(selectedGroup!.id, period), loadActivityLog(selectedGroup!.id)]);
      await checkAndAwardBadges(effectivePartnerId, selectedGroup!.id);
      const awarded = data?.points ?? requestedPoints;
      if (data?.capped_reason === 'daily_limit') {
        Alert.alert(
          'Tageslimit erreicht',
          awarded > 0
            ? `Er hatte heute wohl einen sehr guten Tag – davon zählen noch ${awarded} Punkte, der Rest ab morgen.`
            : 'Er hatte heute wohl einen sehr guten Tag – weitere Punkte zählen ab morgen.',
        );
      } else if (data?.capped_reason === 'task_repeat') {
        Alert.alert('Schon zweimal heute', 'Diese Aufgabe wurde heute bereits zweimal eingetragen und zählt deshalb nicht mehr.');
      } else if (awarded < requestedPoints) {
        Alert.alert('Gespeichert!', `${awarded} statt ${requestedPoints} Punkte für ${effectivePartnerName} – dieselbe Aufgabe gab es heute schon einmal.`);
      } else {
        Alert.alert('Gespeichert!', `${awarded} Punkte für ${effectivePartnerName} vergeben.`);
      }
      setScreen('group-detail');
    }
    setLoading(false);
  }

  async function loadProfileData() {
    const { data: pts, error: e1 } = await supabase.from('partners')
      .select('id, name, avatar_url').eq('owner_user_id', session!.user.id).order('created_at');
    // Ohne Abbruch wuerde ein Fehler hier wie "keine Partner vorhanden" wirken.
    if (failed('Profil konnte nicht geladen werden', e1)) return;
    if (!pts || pts.length === 0) { setMyPartners([]); return; }
    const { data: conns, error: e2 } = await supabase.from('partner_connections')
      .select('partner_id, invite_code').in('partner_id', pts.map((p: any) => p.id));
    if (failed('Einladungscodes konnten nicht geladen werden', e2)) return;
    const codeMap: Record<string, string> = {};
    (conns ?? []).forEach((c: any) => { codeMap[c.partner_id] = c.invite_code; });
    const nameMap: Record<string, string> = {};
    pts.forEach((p: any) => { nameMap[p.id] = p.name; });
    setMyPartners(pts.map((p: any) => ({ id: p.id, name: p.name, invite_code: codeMap[p.id] ?? '—', avatar_url: p.avatar_url })));
    setEditPartnerNames(nameMap);
    setEditEmail(session?.user.email ?? '');
  }

  async function handleUpdateEmail() {
    if (!editEmail.trim()) return;
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ email: editEmail.trim() });
    if (error) Alert.alert('Fehler', error.message);
    else Alert.alert('E-Mail gespeichert', 'Bitte bestätige die Änderung in deiner neuen Inbox.');
    setLoading(false);
  }

  async function handleUpdatePassword() {
    if (!editPassword) return;
    if (editPassword !== editPasswordConfirm) { Alert.alert('Fehler', 'Passwörter stimmen nicht überein.'); return; }
    if (editPassword.length < 6) { Alert.alert('Fehler', 'Mindestens 6 Zeichen.'); return; }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: editPassword });
    if (error) Alert.alert('Fehler', error.message);
    else { Alert.alert('Passwort geändert!', ''); setEditPassword(''); setEditPasswordConfirm(''); }
    setLoading(false);
  }

  async function handleUpdatePartnerName(partnerId: string) {
    const newName = (editPartnerNames[partnerId] ?? '').trim();
    if (!newName) return;
    setLoading(true);
    const { error } = await supabase.from('partners').update({ name: newName }).eq('id', partnerId);
    if (error) Alert.alert('Fehler', error.message);
    else {
      setMyPartners(prev => prev.map(p => p.id === partnerId ? { ...p, name: newName } : p));
      if (partner?.id === partnerId) setPartner(prev => prev ? { ...prev, name: newName } : prev);
      Alert.alert('Name gespeichert!', '');
    }
    setLoading(false);
  }

  async function handlePickAvatar(partnerId: string) {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Zugriff verweigert', 'Bitte erlaube den Zugriff auf deine Fotos in den Einstellungen.'); return; }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1,
    });
    if (picked.canceled) return;
    setLoading(true);
    // Auf 300x300 verkleinern + komprimieren, damit Avatare nur wenige
    // Kilobyte statt potenziell mehrere Megabyte belegen (Storage & Egress).
    const context = ImageManipulator.manipulate(picked.assets[0].uri);
    context.resize({ width: 300, height: 300 });
    const rendered = await context.renderAsync();
    const resized = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
    if (!resized.base64) { Alert.alert('Fehler', 'Bild konnte nicht verarbeitet werden.'); setLoading(false); return; }
    const fileName = `${Date.now()}.jpg`;
    const path = `${partnerId}/${fileName}`;
    const { error: uploadErr } = await supabase.storage.from('avatars')
      .upload(path, decode(resized.base64), { contentType: 'image/jpeg', upsert: true });
    if (uploadErr) { Alert.alert('Fehler beim Hochladen', uploadErr.message); setLoading(false); return; }
    const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
    const { error: updateErr } = await supabase.from('partners').update({ avatar_url: pub.publicUrl }).eq('id', partnerId);
    if (updateErr) { Alert.alert('Fehler', updateErr.message); setLoading(false); return; }

    // Erst nach erfolgreichem Update aufraeumen, damit nie die gerade
    // referenzierte Datei geloescht wird. Ohne das bleibt bei jedem
    // Fotowechsel das alte Bild dauerhaft im Bucket liegen.
    // Bewusst ohne Fehlermeldung: das Foto ist an dieser Stelle bereits
    // gesetzt, ein misslungenes Aufraeumen hinterlaesst nur eine
    // verwaiste Datei und ist fuer die Nutzerin nicht behebbar.
    const { data: existing } = await supabase.storage.from('avatars').list(partnerId);
    const stale = (existing ?? []).filter(f => f.name !== fileName).map(f => `${partnerId}/${f.name}`);
    if (stale.length > 0) await supabase.storage.from('avatars').remove(stale);

    applyAvatarLocally(partnerId, pub.publicUrl);
    setLoading(false);
  }

  // Ein neues Foto muss sofort ueberall sichtbar sein, nicht erst nach
  // erneutem Login. Deshalb werden hier alle Zustaende aktualisiert, in
  // denen ein Avatar steckt.
  function applyAvatarLocally(partnerId: string, url: string) {
    const patch = <T extends { id: string; avatar_url?: string | null }>(p: T): T =>
      p.id === partnerId ? { ...p, avatar_url: url } : p;

    setMyPartners(prev => prev.map(patch));
    setMyAllPartners(prev => prev.map(patch));
    setPartner(prev => (prev && prev.id === partnerId ? { ...prev, avatar_url: url } : prev));
    setViewedPartner(prev => (prev && prev.id === partnerId ? { ...prev, avatar_url: url } : prev));
    setGroupMembers(prev => prev.map(m =>
      m.partner && m.partner.id === partnerId
        ? { ...m, partner: { ...m.partner, avatar_url: url } }
        : m
    ));
    setGroupAvatarsMap(prev => {
      const next: Record<string, GroupPartnerPreview[]> = {};
      for (const [groupId, list] of Object.entries(prev)) next[groupId] = list.map(patch);
      return next;
    });
  }

  async function handleAddPartnerFromProfile() {
    const name = newPartnerNameForProfile.trim();
    if (!name) { Alert.alert('Fehler', 'Bitte gib einen Namen ein.'); return; }
    setLoading(true);
    const { data, error } = await supabase.from('partners')
      .insert({ owner_user_id: session!.user.id, name }).select('id, name').single();
    if (error) { Alert.alert('Fehler', error.message); setLoading(false); return; }
    const code = generatePartnerCode();
    const { error: connError } = await supabase.from('partner_connections')
      .insert({ partner_id: data.id, invite_code: code });
    if (connError) { Alert.alert('Fehler', connError.message); setLoading(false); return; }
    setMyPartners(prev => [...prev, { id: data.id, name: data.name, invite_code: code, avatar_url: null }]);
    setEditPartnerNames(prev => ({ ...prev, [data.id]: data.name }));
    setNewPartnerNameForProfile('');
    setShowAddPartnerForm(false);
    Alert.alert('Partner angelegt!', `Einladungscode: ${code}`);
    setLoading(false);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setSession(null); setPartner(null); setGroups([]);
    setEmail(''); setPassword(''); setScreen('auth');
  }

  async function handleDeleteAccount() {
    Alert.alert(
      'Konto löschen',
      'Bist du sicher? Alle deine Daten (Partner, Punkte, Gruppenmitgliedschaften) werden dauerhaft gelöscht.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Ja, löschen', style: 'destructive',
          onPress: async () => {
            setLoading(true);
            const { error } = await supabase.rpc('delete_account');
            if (error) Alert.alert('Fehler', error.message);
            else {
              await supabase.auth.signOut();
              setSession(null); setPartner(null); setGroups([]);
              setEmail(''); setPassword(''); setScreen('auth');
            }
            setLoading(false);
          },
        },
      ]
    );
  }

  // ── SCREENS ──────────────────────────────────────────

  if (screen === 'loading') return (
    <View style={s.center}><ActivityIndicator size="large" color={COLORS.terracotta} /><StatusBar style="auto" /></View>
  );

  if (screen === 'auth') return (
    <View style={s.center}>
      <Text style={s.title}>{authMode === 'login' ? 'Anmelden' : 'Registrieren'}</Text>
      <TextInput style={s.input} placeholder="E-Mail" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      <TextInput style={s.input} placeholder="Passwort" value={password} onChangeText={setPassword} secureTextEntry />
      {loading ? <ActivityIndicator style={{ marginTop: 16 }} /> : (
        <TouchableOpacity style={s.btn} onPress={authMode === 'login' ? handleLogin : handleRegister}>
          <Text style={s.btnText}>{authMode === 'login' ? 'Anmelden' : 'Registrieren'}</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity onPress={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>
        <Text style={s.link}>{authMode === 'login' ? 'Noch kein Konto? Registrieren' : 'Bereits ein Konto? Anmelden'}</Text>
      </TouchableOpacity>
      <StatusBar style="auto" />
    </View>
  );

  if (screen === 'onboarding-choice') return (
    <View style={s.center}>
      <MaterialCommunityIcons name={ICONS.onboardingWelcome as any} size={44} color={COLORS.terracotta} style={{ marginBottom: 12 }} />
      <Text style={s.title}>Willkommen!</Text>
      <Text style={s.subtitle}>Wie möchtest du die App nutzen?</Text>
      <TouchableOpacity style={[s.btn, s.iconRow, { marginBottom: 12, justifyContent: 'center' }]} onPress={() => setScreen('create-partner')}>
        <MaterialCommunityIcons name={ICONS.onboardingWoman as any} size={ICON_SIZE.inline} color={COLORS.onTerracotta} />
        <Text style={s.btnText}>Ich bin eine Frau</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[s.btn, s.btnOutline, s.iconRow, { justifyContent: 'center' }]} onPress={() => setScreen('enter-invite-code')}>
        <MaterialCommunityIcons name={ICONS.inviteCode as any} size={ICON_SIZE.inline} color={COLORS.terracotta} />
        <Text style={s.btnOutlineText}>Ich habe einen Einladungscode</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={handleLogout} style={{ marginTop: 20 }}>
        <Text style={[s.link, { color: COLORS.inkMuted }]}>Abmelden</Text>
      </TouchableOpacity>
      <StatusBar style="auto" />
    </View>
  );

  if (screen === 'create-partner') return (
    <View style={s.center}>
      <Text style={s.title}>Partner anlegen</Text>
      <Text style={s.subtitle}>Wie heißt dein Partner?</Text>
      <TextInput style={s.input} placeholder="Name" value={partnerName} onChangeText={setPartnerName} />
      {loading ? <ActivityIndicator style={{ marginTop: 16 }} /> : (
        <TouchableOpacity style={s.btn} onPress={handleCreatePartner}><Text style={s.btnText}>Weiter</Text></TouchableOpacity>
      )}
      <StatusBar style="auto" />
    </View>
  );

  if (screen === 'show-partner-code') return (
    <View style={s.center}>
      <MaterialCommunityIcons name={ICONS.onboardingCelebrate as any} size={44} color={COLORS.terracotta} style={{ marginBottom: 12 }} />
      <Text style={s.title}>Partner angelegt!</Text>
      <Text style={s.subtitle}>Schick deinem Partner diesen Code:</Text>
      <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 24, marginBottom: 16, alignItems: 'center', width: '100%' }}>
        <Text style={{ fontSize: 26, fontWeight: 'bold', letterSpacing: 3, color: COLORS.terracotta }}>{generatedPartnerCode}</Text>
      </View>
      <Text style={{ fontSize: 13, color: COLORS.inkMuted, textAlign: 'center', marginBottom: 20 }}>
        Dein Partner gibt diesen Code beim ersten Login ein, um sich mit dir zu verbinden.
      </Text>
      <TouchableOpacity style={[s.btn, s.btnOutline, s.iconRow, { marginBottom: 12, justifyContent: 'center' }]}
        onPress={() => Share.share({ message: `Dein Einladungscode für die Partner Fantasy League: ${generatedPartnerCode}` })}>
        <MaterialCommunityIcons name={ICONS.actionShare as any} size={ICON_SIZE.inline} color={COLORS.terracotta} />
        <Text style={s.btnOutlineText}>Code teilen</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[s.btn, s.iconRow, { justifyContent: 'center' }]} onPress={() => loadGroups(session!)}>
        <Text style={s.btnText}>Weiter zur App</Text>
        <MaterialCommunityIcons name={ICONS.actionForward as any} size={ICON_SIZE.inline} color={COLORS.onTerracotta} />
      </TouchableOpacity>
      <StatusBar style="auto" />
    </View>
  );

  if (screen === 'create-group') return (
    <View style={s.center}>
      <Text style={s.title}>Gruppe erstellen</Text>
      <TextInput style={s.input} placeholder="Gruppenname" value={groupName} onChangeText={setGroupName} />
      {loading ? <ActivityIndicator style={{ marginTop: 16 }} /> : (
        <TouchableOpacity style={s.btn} onPress={handleCreateGroup}><Text style={s.btnText}>Erstellen</Text></TouchableOpacity>
      )}
      <TouchableOpacity onPress={() => setScreen('groups')}><Text style={s.link}>Abbrechen</Text></TouchableOpacity>
      <StatusBar style="auto" />
    </View>
  );

  if (screen === 'join-group') return (
    <View style={s.center}>
      <Text style={s.title}>Gruppe beitreten</Text>
      <Text style={s.subtitle}>Gib den 6-stelligen Einladungscode ein.</Text>
      <TextInput style={[s.input, { fontSize: 24, letterSpacing: 8, textAlign: 'center' }]}
        placeholder="AB3X7K" value={inviteCodeInput} onChangeText={setInviteCodeInput}
        autoCapitalize="characters" maxLength={6} />
      {loading ? <ActivityIndicator style={{ marginTop: 16 }} /> : (
        <TouchableOpacity style={s.btn} onPress={handleJoinGroup}><Text style={s.btnText}>Beitreten</Text></TouchableOpacity>
      )}
      <TouchableOpacity onPress={() => setScreen('groups')}><Text style={s.link}>Abbrechen</Text></TouchableOpacity>
      <StatusBar style="auto" />
    </View>
  );

  if (screen === 'groups') return (
    <View style={s.screen}>
      <View style={s.header}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          {partner ? (
            <TouchableOpacity
              style={[s.iconRow, { flex: 1, gap: 12 }]}
              onPress={() => { setViewedPartner(partner); setScreen('partner-badges'); }}>
              <Avatar uri={partner.avatar_url} name={partner.name} size={52} />
              <View style={{ flex: 1 }}>
                <View style={[s.iconRow, { gap: 4 }]}>
                  <Text style={s.headerTitle} numberOfLines={1}>{partner.name}</Text>
                  <MaterialCommunityIcons name={ICONS.actionForward as any} size={18} color={COLORS.terracotta} />
                </View>
                <Text style={s.headerSub}>Badges & Erfolge ansehen</Text>
              </View>
            </TouchableOpacity>
          ) : (
            <Text style={s.headerTitle}>Meine Gruppen</Text>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <TouchableOpacity onPress={() => { loadProfileData(); setScreen('profile'); }}>
              <MaterialCommunityIcons name={ICONS.navProfile as any} size={ICON_SIZE.list} color={COLORS.terracotta} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setHelpTab('frauen'); setHelpReturnScreen('groups'); setScreen('help'); }}>
              <MaterialCommunityIcons name={ICONS.navHelp as any} size={ICON_SIZE.list} color={COLORS.inkMuted} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
      {groups.length === 0
        ? <View style={s.center}>
            <MaterialCommunityIcons name={ICONS.emptyState as any} size={40} color={COLORS.inkMuted} style={{ marginBottom: 8 }} />
            <Text style={s.empty}>Du bist noch in keiner Gruppe.</Text>
          </View>
        : <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            <Text style={s.sectionLabel}>Meine Gruppen</Text>
            {groups.map(item => (
              <View key={item.id} style={s.card}>
                <TouchableOpacity onPress={() => openGroup(item)}>
                  {(groupAvatarsMap[item.id]?.length ?? 0) > 0 && (
                    <View style={{ flexDirection: 'row', marginBottom: 10 }}>
                      {groupAvatarsMap[item.id].map((p, i) => (
                        <View key={p.id} style={{ marginLeft: i === 0 ? 0 : -12, borderWidth: 2, borderColor: COLORS.surface, borderRadius: 18 }}>
                          <Avatar uri={p.avatar_url} name={p.name} size={32} />
                        </View>
                      ))}
                    </View>
                  )}
                  <Text style={s.cardTitle}>{item.name}</Text>
                  <View style={[s.iconRow, { gap: 4 }]}>
                    <Text style={s.cardSub}>Code: {item.invite_code}</Text>
                    <MaterialCommunityIcons name={ICONS.actionForward as any} size={14} color={COLORS.inkMuted} />
                  </View>
                </TouchableOpacity>
                {item.created_by === session?.user.id ? (
                  <TouchableOpacity onPress={() => handleDeleteGroup(item.id, item.name)} style={[s.iconRow, { marginTop: 10, alignSelf: 'flex-start', gap: 4 }]}>
                    <MaterialCommunityIcons name={ICONS.actionDelete as any} size={ICON_SIZE.inline} color={COLORS.terracotta} />
                    <Text style={{ color: COLORS.terracotta, fontSize: 12, fontWeight: '600' }}>Gruppe löschen</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity onPress={() => handleLeaveGroup(item.id, item.name)} style={[s.iconRow, { marginTop: 10, alignSelf: 'flex-start', gap: 4 }]}>
                    <MaterialCommunityIcons name={ICONS.actionLogout as any} size={ICON_SIZE.inline} color={COLORS.terracotta} />
                    <Text style={{ color: COLORS.terracotta, fontSize: 12, fontWeight: '600' }}>Gruppe verlassen</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </ScrollView>
      }
      <View style={s.footer}>
        <TouchableOpacity style={[s.btn, s.iconRow, { justifyContent: 'center' }]} onPress={() => setScreen('create-group')}>
          <MaterialCommunityIcons name={ICONS.actionAddPoints as any} size={ICON_SIZE.inline} color={COLORS.onTerracotta} />
          <Text style={s.btnText}>Gruppe erstellen</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.btn, s.btnOutline]} onPress={() => setScreen('join-group')}><Text style={s.btnOutlineText}>Gruppe beitreten</Text></TouchableOpacity>
      </View>
      <StatusBar style="auto" />
    </View>
  );

  if (screen === 'group-detail') return (
    <View style={s.screen}>
      <View style={s.header}>
        <TouchableOpacity style={s.backRow} onPress={() => setScreen('groups')}>
          <MaterialCommunityIcons name={ICONS.actionBack as any} size={ICON_SIZE.inline} color={COLORS.terracotta} />
          <Text style={s.back}>Zurück</Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 4 }}>
          <Text style={s.headerTitle}>{selectedGroup?.name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <TouchableOpacity onPress={() => { setHelpTab('frauen'); setHelpReturnScreen('group-detail'); setScreen('help'); }}>
              <MaterialCommunityIcons name={ICONS.navHelp as any} size={ICON_SIZE.list} color={COLORS.inkMuted} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => Share.share({ message: `Tritt unserer Gruppe "${selectedGroup?.name}" bei! Code: ${selectedGroup?.invite_code}` })} style={s.codeBtn}>
              <Text style={s.codeBtnText}>{selectedGroup?.invite_code}</Text>
              <MaterialCommunityIcons name={ICONS.actionShare as any} size={14} color={COLORS.terracotta} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <View style={s.tabs}>
        {(['week', 'month', 'year'] as Period[]).map(p => (
          <TouchableOpacity key={p} style={[s.tab, period === p && s.tabActive]}
            onPress={() => { setPeriod(p); loadRankingForGroup(selectedGroup!.id, p); }}>
            <Text style={[s.tabText, period === p && s.tabTextActive]}>
              {p === 'week' ? 'Woche' : p === 'month' ? 'Monat' : 'Jahr'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={{ paddingHorizontal: 16, paddingVertical: 10, backgroundColor: COLORS.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}
        onPress={loadManageCategories}>
        <MaterialCommunityIcons name={ICONS.navSettings as any} size={ICON_SIZE.inline} color={COLORS.terracotta} />
        <Text style={{ fontSize: 12, color: COLORS.terracotta }}>Eigene Kategorien</Text>
      </TouchableOpacity>

      {loading
        ? <View style={s.center}><ActivityIndicator color={COLORS.terracotta} /></View>
        : <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 130 }}>

            <Text style={s.sectionLabel}>Ranking</Text>
            {rankingLoading
              ? <ActivityIndicator color={COLORS.terracotta} />
              : ranking.length === 0
                ? <Text style={s.empty}>Noch keine Punkte in diesem Zeitraum.</Text>
                : ranking.map((item, index) => {
                    const badges = earnedBadges.filter(b => b.partner_id === item.partner_id);
                    const leaderLabel = period === 'week' ? 'Spieler der Woche' : period === 'month' ? 'Monatssieger' : `Saisonsieger ${new Date().getFullYear()}`;
                    const isLeader = index === 0 && item.total > 0;
                    return (
                      <View key={item.partner_id} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 14 }]}>
                        <View style={{ width: 32, alignItems: 'center' }}>
                          {isLeader
                            ? <MaterialCommunityIcons name={ICONS.rankFirst as any} size={ICON_SIZE.list} color={COLORS.gold} />
                            : <Text style={{ fontSize: 18, fontWeight: '600', color: COLORS.inkMuted }}>{index + 1}.</Text>}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={s.cardTitle}>{item.name}</Text>
                          {isLeader && (
                            <Text style={{ fontSize: 11, color: COLORS.gold, fontWeight: '600', marginTop: 1 }}>{leaderLabel}</Text>
                          )}
                          {badges.length > 0 && (
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                              {badges.map((b, bi) => (
                                <MaterialCommunityIcons
                                  key={`${b.name}-${bi}`}
                                  name={iconFor(b.icon_key) as any}
                                  size={16}
                                  color={catColors(b.category_filter).stroke}
                                />
                              ))}
                            </View>
                          )}
                        </View>
                        <Text style={s.pts}>{item.total} Pkt</Text>
                      </View>
                    );
                  })
            }

            <Text style={s.sectionLabel}>Letzte Aktivitäten</Text>
            {activityLog.length === 0
              ? <Text style={s.empty}>Noch keine Einträge in dieser Gruppe.</Text>
              : activityLog.map(entry => {
                const cat = entry.point_categories as any;
                return (
                <View key={entry.id} style={[s.card, { flexDirection: 'row', gap: 12 }]}>
                  <CategoryIcon tag={cat?.category_tag} iconKey={cat?.icon_key} size={ICON_SIZE.list} circle={36} />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <Text style={[s.cardTitle, { flex: 1, marginRight: 8 }]}>
                        {(entry.partners as any).name} hat {cat?.name} erledigt
                      </Text>
                      {entry.created_by === session?.user.id && (
                        <TouchableOpacity onPress={() => handleDeletePointEntry(entry.id)} style={{ padding: 4 }}>
                          <MaterialCommunityIcons name={ICONS.actionClose as any} size={ICON_SIZE.inline} color={COLORS.inkMuted} />
                        </TouchableOpacity>
                      )}
                    </View>
                    {entry.without_request && (
                      <View style={[s.iconRow, { gap: 4, marginTop: 4 }]}>
                        <MaterialCommunityIcons name={ICONS.toggleUnprompted as any} size={14} color={COLORS.gold} />
                        <Text style={{ fontSize: 12, color: COLORS.gold, fontWeight: '600' }}>ohne Aufforderung</Text>
                      </View>
                    )}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                      <Text style={[s.cardSub, { flex: 1, marginRight: 8 }]}>{entry.note ? `„${entry.note}"` : ''}</Text>
                      <Text style={[s.pts, { fontSize: 13 }, entry.points === 0 && { color: COLORS.inkMuted }]}>
                        {entry.points === 0
                          ? (entry.capped_reason === 'task_repeat'
                              ? '0 Punkte – heute schon zweimal'
                              : '0 Punkte – Tageslimit erreicht')
                          : `+${entry.points}`} · {timeAgo(entry.created_at)}
                      </Text>
                    </View>
                  </View>
                </View>
                );
              })
            }

            {myAllPartners.length > 0 && (
              <>
                <Text style={s.sectionLabel}>Meine Partner in dieser Gruppe</Text>
                {myAllPartners.map(mp => {
                  const membership = groupPartnerMemberships.find(m => m.partner_id === mp.id);
                  const isActive = membership?.active ?? true;
                  return (
                    <View key={mp.id} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
                      <Avatar uri={mp.avatar_url} name={mp.name} size={36} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.cardTitle}>{mp.name}</Text>
                        <Text style={{ fontSize: 12, color: isActive ? COLORS.terracotta : COLORS.inkMuted, marginTop: 2 }}>
                          {isActive ? 'Aktiv im Ranking' : 'Deaktiviert'}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
                          backgroundColor: COLORS.sand, borderWidth: 1,
                          borderColor: isActive ? COLORS.terracotta : COLORS.inkMuted }}
                        onPress={() => handleTogglePartnerMembership(mp.id, isActive)}>
                        <Text style={{ fontSize: 13, fontWeight: '600', color: isActive ? COLORS.terracotta : COLORS.inkSoft }}>
                          {isActive ? 'Deaktivieren' : 'Aktivieren'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </>
            )}

            <TouchableOpacity style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
              onPress={() => setMembersExpanded(!membersExpanded)}>
              <Text style={s.sectionLabel}>Gruppenmitglieder</Text>
              <MaterialCommunityIcons
                name={(membersExpanded ? ICONS.actionCollapse : ICONS.actionExpand) as any}
                size={ICON_SIZE.inline} color={COLORS.inkMuted} />
            </TouchableOpacity>
            {membersExpanded && groupMembers.map(m => (
              <View key={m.user_id} style={[s.card, s.iconRow]}>
                <Avatar uri={m.partner?.avatar_url} name={m.partner?.name ?? '?'} size={32} />
                <Text style={s.cardTitle}>{m.partner?.name ?? '(kein Partner)'}</Text>
              </View>
            ))}

          </ScrollView>
      }
      <View style={s.footer}>
        <TouchableOpacity style={[s.btn, s.iconRow, { justifyContent: 'center' }]} onPress={async () => { if (await loadCategories()) setScreen('add-points'); }}>
          <MaterialCommunityIcons name={ICONS.actionAddPoints as any} size={ICON_SIZE.inline} color={COLORS.onTerracotta} />
          <Text style={s.btnText}>Punkte vergeben</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.btn, s.btnOutline, s.iconRow, { justifyContent: 'center' }]} onPress={async () => setScreen('create-category')}>
          <MaterialCommunityIcons name={ICONS.helpCustomCategory as any} size={ICON_SIZE.inline} color={COLORS.terracotta} />
          <Text style={s.btnOutlineText}>Eigene Kategorie</Text>
        </TouchableOpacity>
      </View>
      <StatusBar style="auto" />
    </View>
  );

  if (screen === 'add-points') {
    const activePartners = myAllPartners.filter(mp => groupPartnerMemberships.find(m => m.partner_id === mp.id)?.active !== false);
    const pointsPartnerName = activePartners.find(p => p.id === selectedPartnerIdForPoints)?.name ?? partner?.name ?? '';
    return (
    <View style={s.screen}>
      <View style={s.header}>
        <TouchableOpacity style={s.backRow} onPress={() => setScreen('group-detail')}>
          <MaterialCommunityIcons name={ICONS.actionBack as any} size={ICON_SIZE.inline} color={COLORS.terracotta} />
          <Text style={s.back}>Zurück</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Punkte vergeben</Text>
        <Text style={s.headerSub}>{selectedGroup?.name}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
        {activePartners.length > 1 && (
          <>
            <Text style={s.sectionLabel}>Für wen?</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
              {activePartners.map(ap => {
                const sel = selectedPartnerIdForPoints === ap.id;
                return (
                  <TouchableOpacity key={ap.id}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
                      backgroundColor: sel ? COLORS.terracotta : COLORS.surface,
                      borderWidth: 1, borderColor: sel ? COLORS.terracotta : COLORS.sandDeep }}
                    onPress={() => setSelectedPartnerIdForPoints(ap.id)}>
                    <Avatar uri={ap.avatar_url} name={ap.name} size={24} />
                    <Text style={{ color: sel ? COLORS.onTerracotta : COLORS.ink, fontWeight: '600', fontSize: 14 }}>
                      {ap.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}
        {activePartners.length === 1 && (
          <Text style={{ fontSize: 14, color: COLORS.inkSoft, marginBottom: 4 }}>für {pointsPartnerName}</Text>
        )}
        {categories.filter(c => !c.is_global).length > 0 && (
          <>
            <View style={[s.iconRow, { marginTop: 4, gap: 8 }]}>
              <MaterialCommunityIcons name={ICONS.helpCustomCategory as any} size={ICON_SIZE.inline}
                color={CATEGORY_COLORS.custom.stroke} />
              <Text style={[s.sectionLabel, { color: CATEGORY_COLORS.custom.stroke }]}>Eigene Kategorien</Text>
            </View>
            {categories.filter(c => !c.is_global).map(cat => (
              <TouchableOpacity key={cat.id} style={[s.card, s.iconRow, selectedCategory?.id === cat.id && s.cardSelected]} onPress={() => { setSelectedCategory(cat); setWithoutRequest(false); }}>
                <CategoryIcon tag={cat.category_tag} iconKey={cat.icon_key} />
                <Text style={[s.cardTitle, { flex: 1 }]}>{cat.name}</Text>
                <Text style={s.pts}>+{cat.points}</Text>
              </TouchableOpacity>
            ))}
          </>
        )}
        {!categories.some(c => !c.is_global) && <Text style={s.sectionLabel}>Kategorie wählen</Text>}
        {CATEGORY_TAG_ORDER.map(tag => {
          const catsInGroup = categories.filter(c => c.is_global && c.category_tag === tag)
            .sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0) || a.name.localeCompare(b.name));
          if (catsInGroup.length === 0) return null;
          const cc = catColors(tag);
          return (
            <View key={tag} style={{ gap: 8 }}>
              <View style={[s.iconRow, { marginTop: 12, gap: 8 }]}>
                <MaterialCommunityIcons name={CATEGORY_TAG_ICONS[tag] as any} size={ICON_SIZE.inline} color={cc.stroke} />
                <Text style={[s.sectionLabel, { color: cc.stroke }]}>{CATEGORY_TAG_LABELS[tag] ?? tag}</Text>
              </View>
              {catsInGroup.map(cat => (
                <TouchableOpacity key={cat.id} style={[s.card, s.iconRow, selectedCategory?.id === cat.id && s.cardSelected]} onPress={() => { setSelectedCategory(cat); setWithoutRequest(false); }}>
                  <CategoryIcon tag={cat.category_tag} iconKey={cat.icon_key} />
                  <Text style={[s.cardTitle, { flex: 1 }]}>{cat.name}</Text>
                  <Text style={s.pts}>+{cat.points}</Text>
                </TouchableOpacity>
              ))}
            </View>
          );
        })}
        {categories.filter(c => c.is_global && !CATEGORY_TAG_ORDER.includes(c.category_tag ?? '')).map(cat => (
          <TouchableOpacity key={cat.id} style={[s.card, s.iconRow, selectedCategory?.id === cat.id && s.cardSelected]} onPress={() => { setSelectedCategory(cat); setWithoutRequest(false); }}>
            <CategoryIcon tag={cat.category_tag} iconKey={cat.icon_key} />
            <Text style={[s.cardTitle, { flex: 1 }]}>{cat.name}</Text>
            <Text style={s.pts}>+{cat.points}</Text>
          </TouchableOpacity>
        ))}
        {selectedCategory?.multiplier_eligible && (
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              backgroundColor: COLORS.surface, borderWidth: 1,
              borderColor: withoutRequest ? COLORS.terracotta : COLORS.sandDeep, borderRadius: 10, padding: 14, marginTop: 8 }}
            onPress={() => setWithoutRequest(!withoutRequest)}>
            <View style={[s.iconRow, { flex: 1, marginRight: 8 }]}>
              {/* Blitz in Gold, damit der Bonus optisch heraussticht. */}
              <MaterialCommunityIcons name={ICONS.toggleUnprompted as any} size={ICON_SIZE.list}
                color={withoutRequest ? COLORS.gold : COLORS.inkMuted} />
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle}>Ohne Aufforderung</Text>
                <Text style={{ fontSize: 12, color: COLORS.inkSoft, marginTop: 2 }}>×1,5 Punkte, wenn er von selbst dran gedacht hat</Text>
              </View>
            </View>
            <View style={{ width: 44, height: 26, borderRadius: 13, backgroundColor: withoutRequest ? COLORS.terracotta : COLORS.sandDeep, padding: 3, justifyContent: 'center' }}>
              <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: COLORS.surface, marginLeft: withoutRequest ? 18 : 0 }} />
            </View>
          </TouchableOpacity>
        )}

        <Text style={[s.sectionLabel, { marginTop: 12 }]}>Notiz (optional)</Text>
        <TextInput style={[s.input, { height: 80, textAlignVertical: 'top' }]}
          placeholder="Was hat er besonders gut gemacht?"
          value={note} onChangeText={setNote} multiline />
      </ScrollView>
      <View style={s.footer}>
        {loading ? <ActivityIndicator /> : (
          <TouchableOpacity style={[s.btn, !selectedCategory && s.btnDisabled]} onPress={handleSavePoints} disabled={!selectedCategory}>
            <Text style={s.btnText}>
              {selectedCategory
                ? `${withoutRequest && selectedCategory.multiplier_eligible ? Math.ceil(selectedCategory.points * 1.5) : selectedCategory.points} Punkte speichern`
                : 'Kategorie wählen'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
      <StatusBar style="auto" />
    </View>
  ); }

  if (screen === 'manage-categories') return (
    <View style={s.screen}>
      <View style={s.header}>
        <TouchableOpacity style={s.backRow} onPress={() => setScreen('group-detail')}>
          <MaterialCommunityIcons name={ICONS.actionBack as any} size={ICON_SIZE.inline} color={COLORS.terracotta} />
          <Text style={s.back}>Zurück</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Eigene Kategorien</Text>
        <Text style={s.headerSub}>{selectedGroup?.name}</Text>
      </View>
      {loading
        ? <View style={s.center}><ActivityIndicator color={COLORS.terracotta} /></View>
        : <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 60 }}>
            <Text style={{ fontSize: 13, color: COLORS.inkSoft, lineHeight: 19 }}>
              Die Punktwerte der Standard-Aufgaben sind fest an ihre Aufwandsstufe gebunden
              und lassen sich nicht ändern — nur so bleiben Gruppen untereinander
              vergleichbar. Eigene Kategorien kannst du hier verwalten.
            </Text>

            {groupCustomCats.length === 0
              ? <View style={[s.center, { paddingVertical: 40 }]}>
                  <MaterialCommunityIcons name={ICONS.emptyState as any} size={40} color={COLORS.inkMuted} style={{ marginBottom: 8 }} />
                  <Text style={s.empty}>Noch keine eigenen Kategorien.</Text>
                </View>
              : groupCustomCats.map(cat => (
                <View key={cat.id} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
                  <CategoryIcon tag={cat.category_tag} iconKey={cat.icon_key} size={ICON_SIZE.inline} circle={32} />
                  <Text style={[s.cardTitle, { flex: 1, fontSize: 14 }]}>{cat.name}</Text>
                  <Text style={s.pts}>{cat.points} Pkt</Text>
                  <TouchableOpacity onPress={() => handleDeleteCustomCategory(cat.id, cat.name)}
                    style={{ borderRadius: 6, padding: 8 }}>
                    <MaterialCommunityIcons name={ICONS.actionDelete as any} size={ICON_SIZE.list} color={COLORS.terracotta} />
                  </TouchableOpacity>
                </View>
              ))
            }
          </ScrollView>
      }
      <StatusBar style="auto" />
    </View>
  );

  if (screen === 'create-category') return (
    <View style={s.screen}>
      <View style={s.header}>
        <TouchableOpacity style={s.backRow} onPress={() => setScreen('group-detail')}>
          <MaterialCommunityIcons name={ICONS.actionBack as any} size={ICON_SIZE.inline} color={COLORS.terracotta} />
          <Text style={s.back}>Zurück</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Eigene Kategorie</Text>
        <Text style={s.headerSub}>Neue Aufgabe für eure Gruppe</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
        <Text style={s.sectionLabel}>Name</Text>
        <TextInput style={s.input} placeholder="z.B. Abendspaziergang organisiert"
          value={newCatName} onChangeText={setNewCatName} />

        <Text style={s.sectionLabel}>Aufwandsstufe</Text>
        <View style={{ gap: 8 }}>
          {TIERS.map(t => {
            const sel = newCatTier === t.tier;
            return (
              <TouchableOpacity key={t.tier}
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                  borderWidth: 1, borderRadius: 8, padding: 12,
                  borderColor: sel ? COLORS.terracotta : COLORS.sandDeep,
                  backgroundColor: COLORS.surface }}
                onPress={() => setNewCatTier(t.tier)}>
                <Text style={{ fontSize: 15, fontWeight: sel ? '700' : '500', color: COLORS.ink }}>{t.label}</Text>
                {sel && <MaterialCommunityIcons name={ICONS.actionCheck as any} size={ICON_SIZE.inline} color={COLORS.terracotta} />}
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={{ fontSize: 12, color: COLORS.inkMuted }}>
          Tier 5 (40 Punkte) ist die maximale Aufwandsstufe für eigene Kategorien.
        </Text>

        <Text style={s.sectionLabel}>Symbol</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {CUSTOM_CATEGORY_ICON_CHOICES.map(key => {
            const sel = newCatIconKey === key;
            return (
              <TouchableOpacity key={key}
                style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center',
                  borderWidth: sel ? 2 : 1,
                  borderColor: sel ? COLORS.terracotta : COLORS.sandDeep,
                  backgroundColor: COLORS.surface }}
                onPress={() => setNewCatIconKey(key)}>
                <MaterialCommunityIcons name={ICONS[key] as any} size={ICON_SIZE.list}
                  color={sel ? COLORS.terracotta : COLORS.inkSoft} />
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
      <View style={s.footer}>
        {loading ? <ActivityIndicator /> : (
          <TouchableOpacity style={s.btn} onPress={handleCreateCategory}>
            <Text style={s.btnText}>Kategorie speichern</Text>
          </TouchableOpacity>
        )}
      </View>
      <StatusBar style="auto" />
    </View>
  );

  if (screen === 'help') return (
    <View style={s.screen}>
      <View style={s.header}>
        <TouchableOpacity style={s.backRow} onPress={() => setScreen(helpReturnScreen)}>
          <MaterialCommunityIcons name={ICONS.actionBack as any} size={ICON_SIZE.inline} color={COLORS.terracotta} />
          <Text style={s.back}>Zurück</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Hilfe & Anleitung</Text>
      </View>
      <View style={s.tabs}>
        {(['frauen', 'maenner', 'faq'] as const).map(tab => (
          <TouchableOpacity key={tab} style={[s.tab, helpTab === tab && s.tabActive]} onPress={() => setHelpTab(tab)}>
            <Text style={[s.tabText, helpTab === tab && s.tabTextActive]}>
              {tab === 'frauen' ? 'Für Frauen' : tab === 'maenner' ? 'Für Männer' : 'FAQ'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        {helpTab === 'frauen' && <>
          {[
            { icon: ICONS.navGroups, title: 'Gruppe erstellen', text: 'Tippe auf "Gruppe erstellen" und vergib einen Namen. Du bekommst automatisch einen 6-stelligen Code — teile ihn mit deinen Freundinnen.' },
            { icon: ICONS.inviteLink, title: 'Freundinnen einladen', text: 'Öffne deine Gruppe und tippe oben rechts auf den Code. Der Teilen-Dialog öffnet sich automatisch — ab zu WhatsApp!' },
            { icon: ICONS.helpPartner, title: 'Partner anlegen & verbinden', text: 'Beim ersten Start legst du deinen Partner an und bekommst automatisch einen Code (P-XXXXXXXX). Teile ihn mit ihm — dann kann er sich mit eigenem Login verbinden und seine Badges sehen.' },
            { icon: ICONS.actionAddPoints, title: 'Punkte vergeben', text: 'Wähle eine Aufgabe aus einer der vier Kategorien (Haushalt, Mental Load, Romantik, Verlässlichkeit). Jede hat einen festen Punktwert nach Aufwand: 2 / 5 / 10 / 20 / 40. Bei Haushalt & Mental Load kannst du zusätzlich "Ohne Aufforderung" aktivieren — gibt ×1,5 Punkte.' },
            { icon: ICONS.helpAntiFarming, title: 'Anti-Farming-Schutz', text: 'Dieselbe Aufgabe zählt am selben Tag beim 2. Mal nur halb, ab dem 3. Mal 0 Punkte. Außerdem gibt es ein hartes Tageslimit von 80 Punkten pro Partner — ein Eintrag, der darüber hinausgeht, wird auf den Rest gekappt. Der Tageswechsel richtet sich nach der Zeitzone deines Handys.' },
            { icon: ICONS.helpRanking, title: 'Ranking & Saisontitel', text: 'Wähle "Woche", "Monat" oder "Jahr". Wer zum Ende eines Zeitraums vorne liegt, bekommt automatisch den Titel "Spieler der Woche" / "Monatssieger" / "Saisonsieger" als Badge.' },
            { icon: ICONS.actionUndo, title: 'Punkte-Eintrag zurücknehmen', text: 'Neben deinen eigenen Einträgen im Aktivitäts-Log siehst du ein kleines Kreuz — damit kannst du versehentliche Einträge wieder löschen.' },
            { icon: ICONS.navSettings, title: 'Feste Punktwerte', text: 'Die Punktwerte der Standard-Aufgaben sind fest an ihre Aufwandsstufe gebunden und lassen sich nicht ändern — nur so bleiben eure Ergebnisse mit anderen Gruppen vergleichbar. Über "Eigene Kategorien" verwaltest du die selbst erfundenen Aufgaben.' },
            { icon: ICONS.helpCustomCategory, title: 'Eigene Kategorie', text: 'Erfinde eigene Aufgaben und wähle dafür eine der fünf Aufwandsstufen (2/5/10/20/40 Punkte) — kein freies Zahlenfeld mehr, damit die Werte fair und vergleichbar bleiben.' },
            { icon: ICONS.badgeSeasonWinner, title: 'Badges deines Partners ansehen', text: 'Tippe in "Meine Gruppen" auf seinen Namen — du siehst dieselbe Badge-Übersicht wie er selbst: Meilensteine, Kategorie-Spezialisten, Konsistenz-Serien, Saisontitel und versteckte Erfolge.' },
            { icon: ICONS.actionDelete, title: 'Gruppe löschen', text: 'Nur die Erstellerin einer Gruppe kann sie löschen — auf der Gruppenkarte in "Meine Gruppen" findest du dafür einen Löschen-Link.' },
          ].map(item => (
            <View key={item.title} style={s.card}>
              <View style={[s.iconRow, { marginBottom: 6 }]}>
                <MaterialCommunityIcons name={item.icon as any} size={ICON_SIZE.list} color={COLORS.terracotta} />
                <Text style={[s.cardTitle, { flex: 1 }]}>{item.title}</Text>
              </View>
              <Text style={{ fontSize: 14, color: COLORS.inkSoft, lineHeight: 20 }}>{item.text}</Text>
            </View>
          ))}
        </>}

        {helpTab === 'maenner' && <>
          <View style={s.card}>
            <View style={[s.iconRow, { marginBottom: 6 }]}>
              <MaterialCommunityIcons name={ICONS.helpPeek as any} size={ICON_SIZE.list} color={COLORS.terracotta} />
              <Text style={[s.cardTitle, { flex: 1 }]}>Hallo, du.</Text>
            </View>
            <Text style={{ fontSize: 14, color: COLORS.inkSoft, lineHeight: 20 }}>
              Das hier richtet sich eigentlich an deine Freundin. Aber schön, dass du reinschaust — das allein könnte schon Punkte geben.
            </Text>
          </View>
          {[
            { icon: ICONS.helpLogin, title: 'Anmelden & Code eingeben', text: 'Registrier dich mit E-Mail & Passwort, dann gib den Code ein, den dir deine Partnerin geschickt hat (P-XXXXXXXX). Du kannst mehrere Codes verbinden, falls mehr als eine Frau dich bewertet.' },
            { icon: ICONS.badgeLegend, title: 'Deine Badge-Übersicht', text: 'Nach dem Verbinden siehst du direkt alle Badges: verdiente sind farbig, offene nur mit ausgegrautem Symbol — mit Fortschrittsbalken bei Meilensteinen und Kategorie-Spezialisten.' },
            { icon: ICONS.badgeStreak4, title: 'Konsistenz zahlt sich aus', text: '"Die Serie", "Marathonmann" und "Ironman" belohnen mehrere Wochen in Folge mit mindestens 20 Punkten — Regelmäßigkeit schlägt Strohfeuer.' },
            { icon: ICONS.badgeWeekWinner, title: 'Saisontitel', text: '"Spieler der Woche", "Monatssieger" und "Saisonsieger" werden automatisch an den Erstplatzierten jeder Gruppe vergeben.' },
            { icon: ICONS.badgeClairvoyant, title: 'Geheime Badges', text: 'Es gibt sechs versteckte Erfolge, die du erst siehst, wenn du sie verdient hast. Mehr wird nicht verraten — der Überraschungsmoment ist die Belohnung.' },
          ].map(item => (
            <View key={item.title} style={s.card}>
              <View style={[s.iconRow, { marginBottom: 6 }]}>
                <MaterialCommunityIcons name={item.icon as any} size={ICON_SIZE.list} color={COLORS.terracotta} />
                <Text style={[s.cardTitle, { flex: 1 }]}>{item.title}</Text>
              </View>
              <Text style={{ fontSize: 14, color: COLORS.inkSoft, lineHeight: 20 }}>{item.text}</Text>
            </View>
          ))}
        </>}

        {helpTab === 'faq' && <>
          {[
            { q: 'Warum sehe ich meinen Partner nicht im Ranking?', a: 'Entweder wurden noch keine Punkte für ihn vergeben, oder er ist für diese Gruppe deaktiviert (siehe "Meine Partner in dieser Gruppe" im Gruppen-Detail).' },
            { q: 'Kann ich einen Punkteintrag rückgängig machen?', a: 'Ja — im Aktivitäts-Log deiner Gruppe kannst du eigene Einträge über das kleine Kreuz löschen.' },
            { q: 'Sieht mein Partner die Punkte?', a: 'Er sieht seine Badges und seinen Fortschritt über sein eigenes Profil, aber nicht das direkte Ranking oder die Gruppen-Ansicht — die bleibt euch Frauen vorbehalten.' },
            { q: 'Warum bekomme ich manchmal 0 oder weniger Punkte für einen Eintrag?', a: 'Entweder wurde dieselbe Aufgabe heute schon eingetragen (beim 2. Mal gibt es die Hälfte, ab dem 3. Mal nichts), oder das Tageslimit von 80 Punkten ist erreicht. Der jeweilige Grund steht im Aktivitäts-Log.' },
            { q: 'Wie kommt der Punktwert einer Aufgabe zustande?', a: 'Jede Aufgabe hat eine feste Aufwandsstufe (Tier 1–5 = 2/5/10/20/40 Punkte) nach Zeitaufwand und Unannehmlichkeit. Diese Werte sind unveränderlich — das macht Gruppen untereinander vergleichbar und verhindert Punkte-Inflation.' },
            { q: 'Kann ich eine Gruppe wieder verlassen?', a: 'Ja — auf der Gruppenkarte in der Übersicht. Dein Partner verschwindet dann aus dem Ranking dieser Gruppe, die bisherigen Punkte bleiben als Historie erhalten. Hast du die Gruppe selbst erstellt, kannst du sie nur löschen.' },
            { q: 'Kann ich Punkte für andere Partner vergeben?', a: 'Nein. Jede Nutzerin vergibt Punkte nur für ihren eigenen Partner. Fairplay.' },
            { q: 'Was passiert, wenn ich den Einladungscode teile?', a: 'Jede Person, die den Code eingibt, tritt der Gruppe bei. Also nur an Vertrauenswürdige weitergeben — oder an Frauen, die du besiegen willst.' },
            { q: 'Kann ich eine Gruppe löschen?', a: 'Nur wenn du sie erstellt hast — dann findest du einen "Gruppe löschen"-Link auf der Gruppenkarte in "Meine Gruppen".' },
            { q: 'Wie lösche ich meinen Account?', a: 'In "Profil & Einstellungen" unten auf "Konto löschen" tippen. Achtung: alle Daten werden unwiderruflich gelöscht.' },
          ].map(item => (
            <View key={item.q} style={s.card}>
              <View style={[s.iconRow, { marginBottom: 6 }]}>
                <MaterialCommunityIcons name={ICONS.navHelp as any} size={ICON_SIZE.inline} color={COLORS.terracotta} />
                <Text style={[s.cardTitle, { flex: 1, fontSize: 14 }]}>{item.q}</Text>
              </View>
              <Text style={{ fontSize: 14, color: COLORS.inkSoft, lineHeight: 20 }}>{item.a}</Text>
            </View>
          ))}
        </>}
      </ScrollView>
      <StatusBar style="auto" />
    </View>
  );

  if (screen === 'enter-invite-code') return (
    <View style={s.center}>
      <Text style={s.title}>Partner-Code eingeben</Text>
      <Text style={s.subtitle}>Gib den Code ein, den dir deine Partnerin geschickt hat.</Text>
      <TextInput
        style={[s.input, { fontSize: 18, letterSpacing: 3, textAlign: 'center' }]}
        placeholder="P-XXXXXXXX"
        value={partnerInviteInput}
        onChangeText={setPartnerInviteInput}
        autoCapitalize="characters"
      />
      {loading ? <ActivityIndicator style={{ marginTop: 16 }} /> : (
        <TouchableOpacity style={s.btn} onPress={handleEnterPartnerInviteCode}>
          <Text style={s.btnText}>Verbinden</Text>
        </TouchableOpacity>
      )}
      {manConnections.length > 0 && (
        <TouchableOpacity style={[s.iconRow, { marginTop: 12, gap: 4 }]} onPress={() => setScreen('man-profile')}>
          <MaterialCommunityIcons name={ICONS.actionBack as any} size={ICON_SIZE.inline} color={COLORS.terracotta} />
          <Text style={s.link}>Zurück zum Profil</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity onPress={handleLogout} style={{ marginTop: 8 }}>
        <Text style={[s.link, { color: COLORS.inkMuted }]}>Abmelden</Text>
      </TouchableOpacity>
      <StatusBar style="auto" />
    </View>
  );

  if (screen === 'man-profile') return (
    <View style={s.screen}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Mein Profil</Text>
        <Text style={s.headerSub}>{session?.user.email}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }}>
        {manConnections.length === 0
          ? <Text style={s.empty}>Noch keine Verbindungen aktiv.</Text>
          : manConnections.map(conn => (
            <View key={conn.id} style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Avatar uri={(conn.partners as any).avatar_url} name={(conn.partners as any).name} size={62} />
                <Text style={s.headerTitle}>{(conn.partners as any).name}</Text>
              </View>
              <BadgeGrid partnerId={(conn.partners as any).id} surroundingColor={COLORS.sand} />
            </View>
          ))
        }

        <View style={{ gap: 12 }}>
          <Text style={s.sectionLabel}>Verbunden mit</Text>
          {manConnections.map(conn => (
            <View key={conn.id} style={s.card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.cardTitle}>{(conn.partners as any).name}</Text>
                  <Text style={s.cardSub}>Code: {conn.invite_code}</Text>
                </View>
                <TouchableOpacity onPress={() => handleDisconnect(conn.id, (conn.partners as any).name)}
                  style={[s.iconRow, { borderRadius: 6, padding: 8, gap: 4 }]}>
                  <MaterialCommunityIcons name={ICONS.actionClose as any} size={ICON_SIZE.inline} color={COLORS.terracotta} />
                  <Text style={{ color: COLORS.terracotta, fontSize: 13, fontWeight: '600' }}>Trennen</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
          <TouchableOpacity style={[s.btn, s.btnOutline, s.iconRow, { justifyContent: 'center' }]} onPress={() => setScreen('enter-invite-code')}>
            <MaterialCommunityIcons name={ICONS.inviteCode as any} size={ICON_SIZE.inline} color={COLORS.terracotta} />
            <Text style={s.btnOutlineText}>Weiteren Code eingeben</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      <View style={s.footer}>
        <TouchableOpacity style={[s.btn, s.btnOutline]} onPress={handleLogout}>
          <Text style={s.btnOutlineText}>Abmelden</Text>
        </TouchableOpacity>
      </View>
      <StatusBar style="auto" />
    </View>
  );

  if (screen === 'partner-badges') return (
    <View style={s.screen}>
      <View style={s.header}>
        <TouchableOpacity style={s.backRow} onPress={() => setScreen('groups')}>
          <MaterialCommunityIcons name={ICONS.actionBack as any} size={ICON_SIZE.inline} color={COLORS.terracotta} />
          <Text style={s.back}>Zurück</Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 }}>
          {viewedPartner && <Avatar uri={viewedPartner.avatar_url} name={viewedPartner.name} size={62} />}
          <View>
            <Text style={s.headerTitle}>{viewedPartner?.name}</Text>
            <Text style={s.headerSub}>Badges & Erfolge</Text>
          </View>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        {viewedPartner && <BadgeGrid partnerId={viewedPartner.id} surroundingColor={COLORS.sand} />}
      </ScrollView>
      <StatusBar style="auto" />
    </View>
  );

  if (screen === 'profile') return (
    <View style={s.screen}>
      <View style={s.header}>
        <TouchableOpacity style={s.backRow} onPress={() => setScreen('groups')}>
          <MaterialCommunityIcons name={ICONS.actionBack as any} size={ICON_SIZE.inline} color={COLORS.terracotta} />
          <Text style={s.back}>Zurück</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Profil & Einstellungen</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 60 }}>

        <Text style={s.sectionLabel}>E-Mail-Adresse</Text>
        <View style={s.card}>
          <TextInput style={[s.input, { marginBottom: 8 }]}
            value={editEmail} onChangeText={setEditEmail}
            autoCapitalize="none" keyboardType="email-address" />
          <TouchableOpacity style={s.btn} onPress={handleUpdateEmail} disabled={loading}>
            <Text style={s.btnText}>E-Mail speichern</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 11, color: COLORS.inkMuted, marginTop: 6 }}>
            Änderungen müssen per E-Mail bestätigt werden.
          </Text>
        </View>

        <Text style={[s.sectionLabel, { marginTop: 4 }]}>Passwort ändern</Text>
        <View style={s.card}>
          <TextInput style={[s.input, { marginBottom: 8 }]}
            placeholder="Neues Passwort (min. 6 Zeichen)"
            value={editPassword} onChangeText={setEditPassword} secureTextEntry />
          <TextInput style={[s.input, { marginBottom: 8 }]}
            placeholder="Passwort bestätigen"
            value={editPasswordConfirm} onChangeText={setEditPasswordConfirm} secureTextEntry />
          <TouchableOpacity style={s.btn} onPress={handleUpdatePassword} disabled={loading}>
            <Text style={s.btnText}>Passwort speichern</Text>
          </TouchableOpacity>
        </View>

        <Text style={[s.sectionLabel, { marginTop: 4 }]}>Meine Partner & Einladungscodes</Text>
        {myPartners.map(p => (
          <View key={p.id} style={s.card}>
            <TouchableOpacity onPress={() => handlePickAvatar(p.id)} style={{ alignItems: 'center', marginBottom: 12 }}>
              <Avatar uri={p.avatar_url} name={editPartnerNames[p.id] ?? p.name} size={72} />
              <View style={[s.iconRow, { marginTop: 6, gap: 4 }]}>
                <MaterialCommunityIcons name={ICONS.actionPhoto as any} size={ICON_SIZE.inline} color={COLORS.terracotta} />
                <Text style={{ fontSize: 12, color: COLORS.terracotta, fontWeight: '600' }}>Foto ändern</Text>
              </View>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <TextInput
                style={[s.input, { flex: 1, marginBottom: 0 }]}
                value={editPartnerNames[p.id] ?? p.name}
                onChangeText={v => setEditPartnerNames(prev => ({ ...prev, [p.id]: v }))}
                placeholder="Name des Partners"
              />
              <TouchableOpacity
                style={{ padding: 10, backgroundColor: COLORS.sand, borderRadius: 8, borderWidth: 1, borderColor: COLORS.terracotta }}
                onPress={() => handleDeletePartner(p.id, editPartnerNames[p.id] ?? p.name)}>
                <MaterialCommunityIcons name={ICONS.actionDelete as any} size={ICON_SIZE.inline} color={COLORS.terracotta} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={[s.btn, { marginBottom: 14 }]}
              onPress={() => handleUpdatePartnerName(p.id)} disabled={loading}>
              <Text style={s.btnText}>Name speichern</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Text style={{ fontSize: 11, color: COLORS.inkMuted, marginBottom: 3 }}>Einladungscode</Text>
                <Text style={{ fontSize: 18, fontWeight: 'bold', color: COLORS.terracotta, letterSpacing: 2 }}>{p.invite_code}</Text>
              </View>
              <TouchableOpacity style={s.codeBtn}
                onPress={() => Share.share({ message: `Dein Einladungscode für die Partner Fantasy League: ${p.invite_code}` })}>
                <MaterialCommunityIcons name={ICONS.actionShare as any} size={ICON_SIZE.inline} color={COLORS.terracotta} />
                <Text style={s.codeBtnText}>Teilen</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        {showAddPartnerForm
          ? <View style={s.card}>
              <Text style={[s.cardTitle, { marginBottom: 10 }]}>Neuen Partner anlegen</Text>
              <TextInput style={[s.input, { marginBottom: 8 }]}
                placeholder="Name des Partners"
                value={newPartnerNameForProfile}
                onChangeText={setNewPartnerNameForProfile} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {loading
                  ? <ActivityIndicator style={{ flex: 1 }} />
                  : <>
                      <TouchableOpacity style={[s.btn, { flex: 1 }]} onPress={handleAddPartnerFromProfile}>
                        <Text style={s.btnText}>Anlegen</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[s.btn, s.btnOutline, { flex: 1 }]} onPress={() => setShowAddPartnerForm(false)}>
                        <Text style={s.btnOutlineText}>Abbrechen</Text>
                      </TouchableOpacity>
                    </>
                }
              </View>
            </View>
          : <TouchableOpacity style={[s.btn, s.btnOutline, s.iconRow, { justifyContent: 'center' }]} onPress={() => setShowAddPartnerForm(true)}>
              <MaterialCommunityIcons name={ICONS.actionAddPoints as any} size={ICON_SIZE.inline} color={COLORS.terracotta} />
              <Text style={s.btnOutlineText}>Weiteren Partner anlegen</Text>
            </TouchableOpacity>
        }

        <Text style={[s.sectionLabel, { marginTop: 4 }]}>Konto</Text>
        <TouchableOpacity style={[s.btn, s.btnOutline, s.iconRow, { justifyContent: 'center' }]} onPress={handleLogout}>
          <MaterialCommunityIcons name={ICONS.actionLogout as any} size={ICON_SIZE.inline} color={COLORS.terracotta} />
          <Text style={s.btnOutlineText}>Abmelden</Text>
        </TouchableOpacity>
        {loading
          ? <ActivityIndicator color={COLORS.terracotta} />
          : <TouchableOpacity
              style={[s.btn, s.btnDanger, s.iconRow, { justifyContent: 'center' }]}
              onPress={handleDeleteAccount}>
              <MaterialCommunityIcons name={ICONS.actionDelete as any} size={ICON_SIZE.inline} color={COLORS.terracotta} />
              <Text style={s.dangerText}>Konto löschen</Text>
            </TouchableOpacity>
        }
        <Text style={{ fontSize: 12, color: COLORS.inkMuted, textAlign: 'center' }}>
          Das Löschen entfernt alle deine Daten dauerhaft.
        </Text>
      </ScrollView>
      <StatusBar style="auto" />
    </View>
  );

  return null;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.sand },
  center: { flex: 1, backgroundColor: COLORS.sand, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: { backgroundColor: COLORS.sandDeep, paddingTop: 56, paddingBottom: 16, paddingHorizontal: 20 },
  headerTitle: { fontSize: 22, fontWeight: 'bold', color: COLORS.ink },
  headerSub: { fontSize: 13, color: COLORS.terracotta, marginTop: 2 },
  back: { fontSize: 14, color: COLORS.terracotta, marginBottom: 4 },
  backRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  codeBtn: { backgroundColor: COLORS.surface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 6 },
  codeBtnText: { fontSize: 13, color: COLORS.terracotta, fontWeight: '600' },
  footer: { padding: 20, paddingBottom: 60, backgroundColor: COLORS.sandDeep, gap: 10, alignItems: 'center' },
  sectionLabel: { fontSize: 12, fontWeight: '600', color: COLORS.inkMuted, textTransform: 'uppercase', letterSpacing: 1 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 8, color: COLORS.ink },
  subtitle: { fontSize: 15, color: COLORS.inkSoft, marginBottom: 24 },
  empty: { color: COLORS.inkMuted, fontSize: 15 },
  input: { width: '100%', borderWidth: 1, borderColor: COLORS.sandDeep, borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 16, backgroundColor: COLORS.surface, color: COLORS.ink },
  btn: { backgroundColor: COLORS.terracotta, borderRadius: 8, padding: 14, width: '100%', alignItems: 'center' },
  btnText: { color: COLORS.onTerracotta, fontWeight: 'bold', fontSize: 16 },
  btnOutline: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.terracotta },
  btnOutlineText: { color: COLORS.terracotta, fontWeight: 'bold', fontSize: 16 },
  btnDisabled: { opacity: 0.4 },
  btnDanger: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.terracotta },
  dangerText: { color: COLORS.terracotta, fontWeight: 'bold', fontSize: 16 },
  link: { color: COLORS.terracotta, fontSize: 14 },
  card: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 16, shadowColor: COLORS.ink, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  cardSelected: { borderWidth: 2, borderColor: COLORS.terracotta },
  cardTitle: { fontSize: 16, fontWeight: '600', color: COLORS.ink },
  cardSub: { fontSize: 13, color: COLORS.inkMuted },
  pts: { fontSize: 15, fontWeight: 'bold', color: COLORS.terracotta },
  tabs: { flexDirection: 'row', backgroundColor: COLORS.sandDeep },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: COLORS.terracotta },
  tabText: { fontSize: 14, color: COLORS.inkMuted },
  tabTextActive: { color: COLORS.terracotta, fontWeight: 'bold' },
  // Kreis mit Kategorie-Icon (Aufgabenlisten, Aktivitätslog)
  catCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  iconRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
