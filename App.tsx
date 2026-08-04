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
import { supabase } from './lib/supabase';
import type { Session } from '@supabase/supabase-js';
import BadgeGrid from './components/BadgeGrid';

type Partner = { id: string; name: string };
type Group = { id: string; name: string; invite_code: string; created_by: string };
type GroupMember = { user_id: string; partner: Partner | null };
type Category = { id: string; name: string; points: number; icon: string; is_global: boolean; tier: number | null; multiplier_eligible: boolean; category_tag: string | null };
type RankingEntry = { partner_id: string; name: string; total: number };
type EarnedBadge = { partner_id: string; icon: string; name: string };
type ManConnection = { id: string; invite_code: string; connected_at: string | null; partners: { id: string; name: string } };
type PartnerWithCode = { id: string; name: string; invite_code: string };
type ActivityEntry = {
  id: string; points: number; created_at: string; note: string | null; created_by: string;
  partners: { name: string }; point_categories: { name: string };
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
  haushalt: '🧹 Haushalt',
  mental_load: '🧠 Mental Load',
  romantik: '💐 Romantik & Aufmerksamkeit',
  verlaesslichkeit: '🛡️ Verlässlichkeit & Partnerschaft',
};

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
  const [newCatIcon, setNewCatIcon] = useState('');
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
  const [overrideInputs, setOverrideInputs] = useState<Record<string, string>>({});
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) { setSession(session); loadUserData(session); }
      else setScreen('auth');
    });
  }, []);

  async function loadUserData(session: Session) {
    const { data: pts } = await supabase.from('partners').select('id, name')
      .eq('owner_user_id', session.user.id).order('created_at');
    const p = (pts ?? [])[0] ?? null;
    if (p) { setPartner(p); await loadGroups(session); return; }
    const { data: conns } = await supabase.from('partner_connections')
      .select('id').eq('man_user_id', session.user.id).is('disconnected_at', null).limit(1);
    if (conns && conns.length > 0) { await loadManProfile(session.user.id); return; }
    setScreen('onboarding-choice');
  }

  async function loadManProfile(userId: string) {
    const { data } = await supabase.from('partner_connections')
      .select('id, invite_code, connected_at, partners(id, name)')
      .eq('man_user_id', userId)
      .is('disconnected_at', null);
    setManConnections((data ?? []) as ManConnection[]);
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
    const { data } = await supabase.from('group_members').select('groups(id, name, invite_code, created_by)')
      .eq('user_id', session.user.id);
    setGroups(((data ?? []) as any[]).map(r => r.groups).filter(Boolean));
    setScreen('groups');
  }

  async function loadRankingForGroup(groupId: string, p: Period) {
    setRankingLoading(true);
    const { data: memberRows } = await supabase.from('group_members').select('user_id').eq('group_id', groupId);
    const userIds = (memberRows ?? []).map((m: any) => m.user_id);
    const { data: partnerRows } = await supabase.from('partners').select('id, name, owner_user_id').in('owner_user_id', userIds);
    const { data: memberships } = await supabase.from('group_partner_memberships')
      .select('partner_id, active').eq('group_id', groupId).eq('active', true);
    const activeIds = new Set((memberships ?? []).map((m: any) => m.partner_id));
    const activePartners = ((partnerRows ?? []) as any[]).filter(pr => activeIds.has(pr.id));
    const { data: entries } = await supabase.from('point_entries').select('partner_id, points')
      .eq('group_id', groupId).gte('created_at', getStartDate(p));
    const totals: Record<string, number> = {};
    (entries ?? []).forEach((e: any) => { totals[e.partner_id] = (totals[e.partner_id] || 0) + e.points; });
    setRanking(activePartners
      .map(pr => ({ partner_id: pr.id, name: pr.name, total: totals[pr.id] || 0 }))
      .sort((a, b) => b.total - a.total));
    setRankingLoading(false);
  }

  async function loadEarnedBadges(groupId: string) {
    const { data } = await supabase.from('partner_badges')
      .select('partner_id, badges(icon, name)')
      .eq('group_id', groupId);
    setEarnedBadges(((data ?? []) as any[]).map(r => ({
      partner_id: r.partner_id,
      icon: (r.badges as any)?.icon ?? '🎖️',
      name: (r.badges as any)?.name ?? '',
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
    const [{ data: allBadges }, { data: earnedRows }, { data: allEntriesRaw }] = await Promise.all([
      supabase.from('badges').select('*').neq('badge_type', 4),
      supabase.from('partner_badges').select('badge_id, period_key').eq('partner_id', partnerId),
      supabase.from('point_entries')
        .select('points, created_at, without_request, point_categories(name, category_tag, tier, is_global)')
        .eq('partner_id', partnerId),
    ]);
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
      if (!insertErr) newBadgeNames.push(`${badge.icon} ${badge.name}`);
    }
    if (newBadgeNames.length > 0) {
      Alert.alert('🎖️ Badge verdient!', newBadgeNames.join('\n'));
      await loadEarnedBadges(groupId);
    }
  }

  async function loadActivityLog(groupId: string) {
    const { data } = await supabase.from('point_entries')
      .select('id, points, created_at, note, created_by, partners(name), point_categories(name)')
      .eq('group_id', groupId).order('created_at', { ascending: false }).limit(10);
    setActivityLog((data ?? []) as ActivityEntry[]);
  }

  async function openGroup(group: Group) {
    setSelectedGroup(group);
    setMembersExpanded(false);
    setLoading(true);
    const { data: memberRows } = await supabase.from('group_members').select('user_id').eq('group_id', group.id);
    const userIds = (memberRows ?? []).map((m: any) => m.user_id);
    const { data: partnerRows } = await supabase.from('partners').select('id, name, owner_user_id').in('owner_user_id', userIds);

    // Meine eigenen Partner laden (alle, nicht nur den ersten)
    const { data: myPts } = await supabase.from('partners').select('id, name')
      .eq('owner_user_id', session!.user.id).order('created_at');
    const myPtsList = (myPts ?? []) as Partner[];
    setMyAllPartners(myPtsList);

    // Partner-Mitgliedschaften laden
    const { data: memberships } = await supabase.from('group_partner_memberships')
      .select('partner_id, active').eq('group_id', group.id);
    const membershipMap = new Map<string, boolean>((memberships ?? []).map((m: any) => [m.partner_id, m.active as boolean]));

    // Neue Partner automatisch registrieren (die noch keinen Eintrag haben)
    const unregistered = myPtsList.map(p => p.id).filter(id => !membershipMap.has(id));
    for (const pid of unregistered) {
      await supabase.from('group_partner_memberships').insert({ group_id: group.id, partner_id: pid, active: true });
      membershipMap.set(pid, true);
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

  async function loadCategories() {
    const [{ data: cats }, { data: overrides }] = await Promise.all([
      supabase.from('point_categories')
        .select('id, name, points, icon, is_global, tier, multiplier_eligible, category_tag')
        .or(`is_global.eq.true,group_id.eq.${selectedGroup!.id}`)
        .order('name'),
      supabase.from('group_category_overrides')
        .select('category_id, points')
        .eq('group_id', selectedGroup!.id),
    ]);
    const overrideMap: Record<string, number> = {};
    (overrides ?? []).forEach((o: any) => { overrideMap[o.category_id] = o.points; });
    setCategories(((cats ?? []) as Category[]).map(c => ({
      ...c,
      points: overrideMap[c.id] ?? c.points,
    })));
  }

  async function loadManageCategories() {
    setLoading(true);
    const [{ data: globalCats }, { data: customCats }, { data: overrides }] = await Promise.all([
      supabase.from('point_categories').select('id, name, points, icon, is_global, tier, multiplier_eligible, category_tag').eq('is_global', true).order('name'),
      supabase.from('point_categories').select('id, name, points, icon, is_global, tier, multiplier_eligible, category_tag').eq('group_id', selectedGroup!.id).order('name'),
      supabase.from('group_category_overrides').select('category_id, points').eq('group_id', selectedGroup!.id),
    ]);
    const overrideMap: Record<string, string> = {};
    (overrides ?? []).forEach((o: any) => { overrideMap[o.category_id] = String(o.points); });
    (globalCats ?? []).forEach((c: any) => { if (!overrideMap[c.id]) overrideMap[c.id] = String(c.points); });
    setCategories((globalCats ?? []) as Category[]);
    setGroupCustomCats((customCats ?? []) as Category[]);
    setOverrideInputs(overrideMap);
    setLoading(false);
    setScreen('manage-categories');
  }

  async function handleSaveOverrides() {
    setLoading(true);
    const rows = categories.map(c => ({
      group_id: selectedGroup!.id,
      category_id: c.id,
      points: parseInt(overrideInputs[c.id] ?? String(c.points), 10) || c.points,
    }));
    const { error } = await supabase.from('group_category_overrides')
      .upsert(rows, { onConflict: 'group_id,category_id' });
    if (error) Alert.alert('Fehler', error.message);
    else {
      Alert.alert('Gespeichert!', 'Punktwerte für diese Gruppe wurden angepasst.');
      setScreen('group-detail');
    }
    setLoading(false);
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
        const { error } = await supabase.from('point_categories').delete().eq('id', catId);
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
      icon: newCatIcon.trim() || '⭐',
      is_global: false,
      created_by: session!.user.id,
      group_id: selectedGroup!.id,
    });
    if (error) Alert.alert('Fehler', error.message);
    else {
      setNewCatName(''); setNewCatTier(null); setNewCatIcon('');
      await loadCategories();
      setScreen('add-points');
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
      await supabase.from('group_members').insert({ group_id: data.id, user_id: session!.user.id });
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
      if (data?.capped_reason === 'daily_limit') {
        Alert.alert('😉', 'Er hatte heute wohl einen sehr guten Tag – weitere Punkte zählen ab morgen.');
      } else {
        Alert.alert('Gespeichert!', `${data?.points ?? requestedPoints} Punkte fuer ${effectivePartnerName} vergeben.`);
      }
      setScreen('group-detail');
    }
    setLoading(false);
  }

  async function loadProfileData() {
    const { data: pts } = await supabase.from('partners')
      .select('id, name').eq('owner_user_id', session!.user.id).order('created_at');
    if (!pts || pts.length === 0) { setMyPartners([]); return; }
    const { data: conns } = await supabase.from('partner_connections')
      .select('partner_id, invite_code').in('partner_id', pts.map((p: any) => p.id));
    const codeMap: Record<string, string> = {};
    (conns ?? []).forEach((c: any) => { codeMap[c.partner_id] = c.invite_code; });
    const nameMap: Record<string, string> = {};
    pts.forEach((p: any) => { nameMap[p.id] = p.name; });
    setMyPartners(pts.map((p: any) => ({ id: p.id, name: p.name, invite_code: codeMap[p.id] ?? '—' })));
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
    setMyPartners(prev => [...prev, { id: data.id, name: data.name, invite_code: code }]);
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
    <View style={s.center}><ActivityIndicator size="large" color="#3ECF8E" /><StatusBar style="auto" /></View>
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
      <Text style={s.title}>Willkommen! 👋</Text>
      <Text style={s.subtitle}>Wie möchtest du die App nutzen?</Text>
      <TouchableOpacity style={[s.btn, { marginBottom: 12 }]} onPress={() => setScreen('create-partner')}>
        <Text style={s.btnText}>Ich bin eine Frau 👩</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[s.btn, s.btnOutline]} onPress={() => setScreen('enter-invite-code')}>
        <Text style={s.btnOutlineText}>Ich habe einen Einladungscode 📬</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={handleLogout} style={{ marginTop: 20 }}>
        <Text style={[s.link, { color: '#aaa' }]}>Abmelden</Text>
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
      <Text style={s.title}>Partner angelegt! 🎉</Text>
      <Text style={s.subtitle}>Schick deinem Partner diesen Code:</Text>
      <View style={{ backgroundColor: '#f0fdf9', borderRadius: 12, padding: 24, marginBottom: 16, alignItems: 'center', width: '100%' }}>
        <Text style={{ fontSize: 26, fontWeight: 'bold', letterSpacing: 3, color: '#3ECF8E' }}>{generatedPartnerCode}</Text>
      </View>
      <Text style={{ fontSize: 13, color: '#aaa', textAlign: 'center', marginBottom: 20 }}>
        Dein Partner gibt diesen Code beim ersten Login ein, um sich mit dir zu verbinden.
      </Text>
      <TouchableOpacity style={[s.btn, s.btnOutline, { marginBottom: 12 }]}
        onPress={() => Share.share({ message: `Dein Einladungscode für die Partner Fantasy League: ${generatedPartnerCode}` })}>
        <Text style={s.btnOutlineText}>Code teilen</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.btn} onPress={() => loadGroups(session!)}>
        <Text style={s.btnText}>Weiter zur App →</Text>
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
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <View>
            <Text style={s.headerTitle}>Meine Gruppen</Text>
            {partner && (
              <TouchableOpacity onPress={() => { setViewedPartner(partner); setScreen('partner-badges'); }}>
                <Text style={[s.headerSub, { textDecorationLine: 'underline' }]}>{partner.name} ›</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <TouchableOpacity onPress={() => { loadProfileData(); setScreen('profile'); }}>
              <Text style={{ fontSize: 13, color: '#3ECF8E' }}>Profil ›</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setHelpTab('frauen'); setHelpReturnScreen('groups'); setScreen('help'); }}>
              <Text style={{ fontSize: 13, color: '#aaa' }}>? Hilfe</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
      {groups.length === 0
        ? <View style={s.center}><Text style={s.empty}>Du bist noch in keiner Gruppe.</Text></View>
        : <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            {groups.map(item => (
              <View key={item.id} style={s.card}>
                <TouchableOpacity onPress={() => openGroup(item)}>
                  <Text style={s.cardTitle}>{item.name}</Text>
                  <Text style={s.cardSub}>Code: {item.invite_code} ›</Text>
                </TouchableOpacity>
                {item.created_by === session?.user.id && (
                  <TouchableOpacity onPress={() => handleDeleteGroup(item.id, item.name)} style={{ marginTop: 10, alignSelf: 'flex-start' }}>
                    <Text style={{ color: '#ff4444', fontSize: 12, fontWeight: '600' }}>Gruppe löschen</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </ScrollView>
      }
      <View style={s.footer}>
        <TouchableOpacity style={s.btn} onPress={() => setScreen('create-group')}><Text style={s.btnText}>+ Gruppe erstellen</Text></TouchableOpacity>
        <TouchableOpacity style={[s.btn, s.btnOutline]} onPress={() => setScreen('join-group')}><Text style={s.btnOutlineText}>Gruppe beitreten</Text></TouchableOpacity>
      </View>
      <StatusBar style="auto" />
    </View>
  );

  if (screen === 'group-detail') return (
    <View style={s.screen}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => setScreen('groups')}><Text style={s.back}>← Zurück</Text></TouchableOpacity>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 4 }}>
          <Text style={s.headerTitle}>{selectedGroup?.name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity onPress={() => { setHelpTab('frauen'); setHelpReturnScreen('group-detail'); setScreen('help'); }}>
              <Text style={{ fontSize: 13, color: '#aaa' }}>?</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => Share.share({ message: `Tritt unserer Gruppe "${selectedGroup?.name}" bei! Code: ${selectedGroup?.invite_code}` })} style={s.codeBtn}>
              <Text style={s.codeBtnText}>{selectedGroup?.invite_code} 🔗</Text>
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
        style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee', alignItems: 'flex-end' }}
        onPress={loadManageCategories}>
        <Text style={{ fontSize: 12, color: '#3ECF8E' }}>⚙️ Kategorien anpassen</Text>
      </TouchableOpacity>

      {loading
        ? <View style={s.center}><ActivityIndicator color="#3ECF8E" /></View>
        : <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 130 }}>

            <Text style={s.sectionLabel}>Ranking</Text>
            {rankingLoading
              ? <ActivityIndicator color="#3ECF8E" />
              : ranking.length === 0
                ? <Text style={s.empty}>Noch keine Punkte in diesem Zeitraum.</Text>
                : ranking.map((item, index) => {
                    const badges = earnedBadges.filter(b => b.partner_id === item.partner_id);
                    const leaderLabel = period === 'week' ? 'Spieler der Woche' : period === 'month' ? 'Monatssieger' : `Saisonsieger ${new Date().getFullYear()}`;
                    return (
                      <View key={item.partner_id} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 14 }]}>
                        <Text style={{ fontSize: 20, width: 36 }}>{index === 0 ? '🏆' : `${index + 1}.`}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={s.cardTitle}>{item.name}</Text>
                          {index === 0 && item.total > 0 && (
                            <Text style={{ fontSize: 11, color: '#3ECF8E', fontWeight: '600', marginTop: 1 }}>{leaderLabel}</Text>
                          )}
                          {badges.length > 0 && (
                            <Text style={{ fontSize: 14, marginTop: 2 }}>{badges.map(b => b.icon).join(' ')}</Text>
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
              : activityLog.map(entry => (
                <View key={entry.id} style={s.card}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Text style={[s.cardTitle, { flex: 1, marginRight: 8 }]}>
                      {(entry.partners as any).name} hat {(entry.point_categories as any).name} erledigt
                    </Text>
                    {entry.created_by === session?.user.id && (
                      <TouchableOpacity onPress={() => handleDeletePointEntry(entry.id)} style={{ padding: 4 }}>
                        <Text style={{ fontSize: 15, color: '#ccc' }}>✕</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                    <Text style={[s.cardSub, { flex: 1, marginRight: 8 }]}>{entry.note ? `„${entry.note}"` : ''}</Text>
                    <Text style={[s.pts, { fontSize: 13 }, entry.points === 0 && { color: '#bbb' }]}>
                      {entry.points === 0 ? '0 Punkte – Tageslimit erreicht' : `+${entry.points}`} · {timeAgo(entry.created_at)}
                    </Text>
                  </View>
                </View>
              ))
            }

            {myAllPartners.length > 0 && (
              <>
                <Text style={s.sectionLabel}>Meine Partner in dieser Gruppe</Text>
                {myAllPartners.map(mp => {
                  const membership = groupPartnerMemberships.find(m => m.partner_id === mp.id);
                  const isActive = membership?.active ?? true;
                  return (
                    <View key={mp.id} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.cardTitle}>{mp.name}</Text>
                        <Text style={{ fontSize: 12, color: isActive ? '#3ECF8E' : '#bbb', marginTop: 2 }}>
                          {isActive ? 'Aktiv im Ranking' : 'Deaktiviert'}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
                          backgroundColor: isActive ? '#fff0f0' : '#f0fff8',
                          borderWidth: 1, borderColor: isActive ? '#ffc0c0' : '#a0e8c8' }}
                        onPress={() => handleTogglePartnerMembership(mp.id, isActive)}>
                        <Text style={{ fontSize: 13, fontWeight: '600', color: isActive ? '#ff4444' : '#3ECF8E' }}>
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
              <Text style={{ color: '#aaa', fontSize: 12 }}>{membersExpanded ? '▲ einklappen' : '▼ ausklappen'}</Text>
            </TouchableOpacity>
            {membersExpanded && groupMembers.map(m => (
              <View key={m.user_id} style={s.card}>
                <Text style={s.cardTitle}>{m.partner?.name ?? '(kein Partner)'}</Text>
              </View>
            ))}

          </ScrollView>
      }
      <View style={s.footer}>
        <TouchableOpacity style={s.btn} onPress={async () => { await loadCategories(); setScreen('add-points'); }}>
          <Text style={s.btnText}>+ Punkte vergeben</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.btn, s.btnOutline]} onPress={async () => { await loadCategories(); setScreen('create-category'); }}>
          <Text style={s.btnOutlineText}>+ Eigene Kategorie</Text>
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
        <TouchableOpacity onPress={() => setScreen('group-detail')}><Text style={s.back}>← Zurück</Text></TouchableOpacity>
        <Text style={s.headerTitle}>Punkte vergeben</Text>
        <Text style={s.headerSub}>{selectedGroup?.name}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
        {activePartners.length > 1 && (
          <>
            <Text style={s.sectionLabel}>Fuer wen?</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
              {activePartners.map(ap => (
                <TouchableOpacity key={ap.id}
                  style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                    backgroundColor: selectedPartnerIdForPoints === ap.id ? '#3ECF8E' : '#f5f5f5',
                    borderWidth: 1, borderColor: selectedPartnerIdForPoints === ap.id ? '#3ECF8E' : '#ddd' }}
                  onPress={() => setSelectedPartnerIdForPoints(ap.id)}>
                  <Text style={{ color: selectedPartnerIdForPoints === ap.id ? '#fff' : '#333', fontWeight: '600', fontSize: 14 }}>
                    {ap.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}
        {activePartners.length === 1 && (
          <Text style={{ fontSize: 14, color: '#888', marginBottom: 4 }}>fuer {pointsPartnerName}</Text>
        )}
        {categories.filter(c => !c.is_global).length > 0 && (
          <>
            <Text style={s.sectionLabel}>Eigene Kategorien</Text>
            {categories.filter(c => !c.is_global).map(cat => (
              <TouchableOpacity key={cat.id} style={[s.card, selectedCategory?.id === cat.id && s.cardSelected]} onPress={() => { setSelectedCategory(cat); setWithoutRequest(false); }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={[s.cardTitle, { flex: 1, marginRight: 8 }]}>{cat.icon}  {cat.name}</Text>
                  <Text style={s.pts}>+{cat.points}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}
        {!categories.some(c => !c.is_global) && <Text style={s.sectionLabel}>Kategorie wählen</Text>}
        {CATEGORY_TAG_ORDER.map(tag => {
          const catsInGroup = categories.filter(c => c.is_global && c.category_tag === tag)
            .sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0) || a.name.localeCompare(b.name));
          if (catsInGroup.length === 0) return null;
          return (
            <View key={tag} style={{ gap: 8 }}>
              <Text style={[s.sectionLabel, { marginTop: 8 }]}>{CATEGORY_TAG_LABELS[tag] ?? tag}</Text>
              {catsInGroup.map(cat => (
                <TouchableOpacity key={cat.id} style={[s.card, selectedCategory?.id === cat.id && s.cardSelected]} onPress={() => { setSelectedCategory(cat); setWithoutRequest(false); }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={[s.cardTitle, { flex: 1, marginRight: 8 }]}>{cat.icon}  {cat.name}</Text>
                    <Text style={s.pts}>+{cat.points}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          );
        })}
        {categories.filter(c => c.is_global && !CATEGORY_TAG_ORDER.includes(c.category_tag ?? '')).map(cat => (
          <TouchableOpacity key={cat.id} style={[s.card, selectedCategory?.id === cat.id && s.cardSelected]} onPress={() => { setSelectedCategory(cat); setWithoutRequest(false); }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={[s.cardTitle, { flex: 1, marginRight: 8 }]}>{cat.icon}  {cat.name}</Text>
              <Text style={s.pts}>+{cat.points}</Text>
            </View>
          </TouchableOpacity>
        ))}
        {selectedCategory?.multiplier_eligible && (
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              backgroundColor: withoutRequest ? '#f0fdf9' : '#fff', borderWidth: 1,
              borderColor: withoutRequest ? '#3ECF8E' : '#ddd', borderRadius: 10, padding: 14, marginTop: 8 }}
            onPress={() => setWithoutRequest(!withoutRequest)}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={s.cardTitle}>Ohne Aufforderung 🔮</Text>
              <Text style={{ fontSize: 12, color: '#888', marginTop: 2 }}>×1,5 Punkte, wenn er von selbst dran gedacht hat</Text>
            </View>
            <View style={{ width: 44, height: 26, borderRadius: 13, backgroundColor: withoutRequest ? '#3ECF8E' : '#ddd', padding: 3, justifyContent: 'center' }}>
              <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', marginLeft: withoutRequest ? 18 : 0 }} />
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
        <TouchableOpacity onPress={() => setScreen('group-detail')}><Text style={s.back}>← Zurück</Text></TouchableOpacity>
        <Text style={s.headerTitle}>Kategorien verwalten</Text>
        <Text style={s.headerSub}>{selectedGroup?.name}</Text>
      </View>
      {loading
        ? <View style={s.center}><ActivityIndicator color="#3ECF8E" /></View>
        : <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 130 }}>
            <Text style={s.sectionLabel}>Standard-Kategorien · Punkte anpassen</Text>
            {categories.map(cat => (
              <View key={cat.id} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
                <Text style={{ fontSize: 18 }}>{cat.icon}</Text>
                <Text style={[s.cardTitle, { flex: 1, fontSize: 14 }]}>{cat.name}</Text>
                <Text style={{ fontSize: 11, color: '#bbb' }}>Std:{cat.points}</Text>
                <TextInput
                  style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 6, width: 54, textAlign: 'center', fontSize: 15, backgroundColor: '#fff' }}
                  value={overrideInputs[cat.id] ?? String(cat.points)}
                  onChangeText={v => setOverrideInputs(prev => ({ ...prev, [cat.id]: v }))}
                  keyboardType="numeric"
                />
              </View>
            ))}

            {groupCustomCats.length > 0 && <>
              <Text style={[s.sectionLabel, { marginTop: 8 }]}>Eigene Kategorien · Löschen</Text>
              {groupCustomCats.map(cat => (
                <View key={cat.id} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
                  <Text style={{ fontSize: 18 }}>{cat.icon}</Text>
                  <Text style={[s.cardTitle, { flex: 1, fontSize: 14 }]}>{cat.name}</Text>
                  <Text style={s.pts}>{cat.points} Pkt</Text>
                  <TouchableOpacity onPress={() => handleDeleteCustomCategory(cat.id, cat.name)}
                    style={{ backgroundColor: '#fff0f0', borderRadius: 6, padding: 8 }}>
                    <Text style={{ color: '#ff4444', fontSize: 13, fontWeight: '600' }}>Löschen</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </>}
          </ScrollView>
      }
      <View style={s.footer}>
        {loading ? <ActivityIndicator /> : (
          <TouchableOpacity style={s.btn} onPress={handleSaveOverrides}>
            <Text style={s.btnText}>Änderungen speichern</Text>
          </TouchableOpacity>
        )}
      </View>
      <StatusBar style="auto" />
    </View>
  );

  if (screen === 'create-category') return (
    <View style={s.screen}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => setScreen('add-points')}><Text style={s.back}>← Zurück</Text></TouchableOpacity>
        <Text style={s.headerTitle}>Eigene Kategorie</Text>
        <Text style={s.headerSub}>Erstelle eine persönliche Punktekategorie</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
        <Text style={s.sectionLabel}>Name</Text>
        <TextInput style={s.input} placeholder="z.B. Abendspaziergang organisiert"
          value={newCatName} onChangeText={setNewCatName} />

        <Text style={s.sectionLabel}>Aufwandsstufe</Text>
        <View style={{ gap: 8 }}>
          {TIERS.map(t => (
            <TouchableOpacity key={t.tier}
              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                borderWidth: 1, borderRadius: 8, padding: 12,
                borderColor: newCatTier === t.tier ? '#3ECF8E' : '#ddd',
                backgroundColor: newCatTier === t.tier ? '#f0fdf9' : '#fff' }}
              onPress={() => setNewCatTier(t.tier)}>
              <Text style={{ fontSize: 15, fontWeight: newCatTier === t.tier ? '700' : '500' }}>{t.label}</Text>
              {newCatTier === t.tier && <Text style={{ color: '#3ECF8E', fontWeight: 'bold' }}>✓</Text>}
            </TouchableOpacity>
          ))}
        </View>
        <Text style={{ fontSize: 12, color: '#aaa' }}>
          Tier 5 (40 Punkte) ist die maximale Aufwandsstufe für eigene Kategorien.
        </Text>

        <Text style={s.sectionLabel}>Emoji-Icon</Text>
        <TextInput style={[s.input, { fontSize: 24, textAlign: 'center' }]}
          placeholder="⭐" value={newCatIcon} onChangeText={setNewCatIcon}
          maxLength={2} />
        <Text style={{ fontSize: 12, color: '#aaa', textAlign: 'center', marginTop: -8 }}>
          Tippe ein Emoji ein (leer lassen = ⭐)
        </Text>
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
        <TouchableOpacity onPress={() => setScreen(helpReturnScreen)}><Text style={s.back}>← Zurück</Text></TouchableOpacity>
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
            { icon: '👥', title: 'Gruppe erstellen', text: 'Tippe auf "Gruppe erstellen" und vergib einen Namen. Du bekommst automatisch einen 6-stelligen Code — teile ihn mit deinen Freundinnen.' },
            { icon: '🔗', title: 'Freundinnen einladen', text: 'Öffne deine Gruppe und tippe oben rechts auf den Code. Der Teilen-Dialog öffnet sich automatisch — ab zu WhatsApp!' },
            { icon: '💑', title: 'Partner anlegen', text: 'Beim ersten Start wirst du gefragt, wie dein Partner heißt. Das ist der Name, der im Ranking erscheint. (Wähle weise.)' },
            { icon: '⭐', title: 'Punkte vergeben', text: 'Öffne deine Gruppe, tippe "Punkte vergeben" und wähle eine Kategorie. Die Punkte landen sofort im Ranking — Rache ist süß.' },
            { icon: '📊', title: 'Ranking verstehen', text: 'Wähle "Woche", "Monat" oder "Jahr" um den Zeitraum zu wechseln. Wer oben steht, hat sich wirklich Mühe gegeben... angeblich.' },
            { icon: '⚙️', title: 'Kategorien anpassen', text: 'Über "Kategorien anpassen" in deiner Gruppe kannst du Punktwerte für eure Gruppe ändern — denn nicht alle Männer sind gleich faul.' },
            { icon: '✨', title: 'Eigene Kategorie', text: 'Du kannst auch eigene Kategorien erfinden. "Endlich mal spontan sein" — go for it. Alle in der Gruppe sehen und nutzen sie.' },
          ].map(item => (
            <View key={item.title} style={s.card}>
              <Text style={[s.cardTitle, { marginBottom: 4 }]}>{item.icon}  {item.title}</Text>
              <Text style={{ fontSize: 14, color: '#555', lineHeight: 20 }}>{item.text}</Text>
            </View>
          ))}
        </>}

        {helpTab === 'maenner' && <>
          <View style={[s.card, { backgroundColor: '#f0fdf9' }]}>
            <Text style={[s.cardTitle, { marginBottom: 6 }]}>👀 Hallo, du.</Text>
            <Text style={{ fontSize: 14, color: '#555', lineHeight: 20 }}>
              Das hier richtet sich eigentlich an deine Freundin. Aber schön, dass du reinschaust — das allein könnte schon Punkte geben.
            </Text>
          </View>
          {[
            { icon: '🎖️', title: 'Badges verdienen', text: 'Deine Freundin vergibt Punkte für dich — und wenn du genug davon sammelst, bekommst du Badges. Fang einfach an, Geschirrspüler einzuräumen.' },
            { icon: '🏠', title: 'Haushalt-Hero', text: '100 Punkte in Haushalt-Kategorien. Klingt nach viel. Ist es auch. Aber du schaffst das.' },
            { icon: '💕', title: 'Romantik-Champion', text: 'Bereits 50 Punkte in Romantik reichen. Blumen kaufen, Nachricht schreiben, Date planen — du weißt was zu tun ist.' },
            { icon: '👑', title: 'Legende', text: '200 Gesamtpunkte. Eine Legende entsteht nicht über Nacht. Aber vielleicht übers Wochenende.' },
          ].map(item => (
            <View key={item.title} style={s.card}>
              <Text style={[s.cardTitle, { marginBottom: 4 }]}>{item.icon}  {item.title}</Text>
              <Text style={{ fontSize: 14, color: '#555', lineHeight: 20 }}>{item.text}</Text>
            </View>
          ))}
          <View style={s.card}>
            <Text style={{ fontSize: 14, color: '#aaa', lineHeight: 20, fontStyle: 'italic' }}>
              Bald kannst du dich mit eigenem Login anmelden und dein Badge-Profil ansehen. Bis dahin: einfach weiter Punkte sammeln.
            </Text>
          </View>
        </>}

        {helpTab === 'faq' && <>
          {[
            { q: 'Warum sehe ich meinen Partner nicht im Ranking?', a: 'Er erscheint nur, wenn in dieser Gruppe Punkte für ihn vergeben wurden. Vielleicht ist er einfach noch nicht gut genug? 😅' },
            { q: 'Kann ich einen Punkteintrag rückgängig machen?', a: 'Noch nicht — das Feature kommt bald. Bis dahin: nächstes Mal genauer hinschauen.' },
            { q: 'Sieht mein Partner die Punkte?', a: 'Aktuell nur du und deine Freundinnen in der Gruppe. Dein Partner hat noch keinen eigenen Login — aber es kommt.' },
            { q: 'Kann ich Punkte für andere Partner vergeben?', a: 'Nein. Jede Nutzerin vergibt Punkte nur für ihren eigenen Partner. Fairplay.' },
            { q: 'Was passiert, wenn ich den Einladungscode teile?', a: 'Jede Person, die den Code eingibt, tritt der Gruppe bei. Also nur an Vertrauenswürdige weitergeben — oder an Frauen, die du besiegen willst.' },
            { q: 'Wie lösche ich meinen Account?', a: 'Profil & Einstellungen → "Konto löschen". Achtung: alle Daten werden unwiderruflich gelöscht.' },
          ].map(item => (
            <View key={item.q} style={s.card}>
              <Text style={[s.cardTitle, { fontSize: 14, marginBottom: 6 }]}>❓  {item.q}</Text>
              <Text style={{ fontSize: 14, color: '#555', lineHeight: 20 }}>{item.a}</Text>
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
        <TouchableOpacity onPress={() => setScreen('man-profile')}>
          <Text style={[s.link, { marginTop: 12 }]}>← Zurück zum Profil</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity onPress={handleLogout} style={{ marginTop: 8 }}>
        <Text style={[s.link, { color: '#aaa' }]}>Abmelden</Text>
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
              {manConnections.length > 1 && <Text style={s.sectionLabel}>{(conn.partners as any).name}</Text>}
              <BadgeGrid partnerId={(conn.partners as any).id} />
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
                  style={{ backgroundColor: '#fff0f0', borderRadius: 6, padding: 8 }}>
                  <Text style={{ color: '#ff4444', fontSize: 13, fontWeight: '600' }}>Trennen</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
          <TouchableOpacity style={[s.btn, s.btnOutline]} onPress={() => setScreen('enter-invite-code')}>
            <Text style={s.btnOutlineText}>+ Weiteren Code eingeben</Text>
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
        <TouchableOpacity onPress={() => setScreen('groups')}><Text style={s.back}>← Zurück</Text></TouchableOpacity>
        <Text style={s.headerTitle}>{viewedPartner?.name}</Text>
        <Text style={s.headerSub}>Badges & Erfolge</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        {viewedPartner && <BadgeGrid partnerId={viewedPartner.id} />}
      </ScrollView>
      <StatusBar style="auto" />
    </View>
  );

  if (screen === 'profile') return (
    <View style={s.screen}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => setScreen('groups')}><Text style={s.back}>← Zurück</Text></TouchableOpacity>
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
          <Text style={{ fontSize: 11, color: '#bbb', marginTop: 6 }}>
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
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <TextInput
                style={[s.input, { flex: 1, marginBottom: 0 }]}
                value={editPartnerNames[p.id] ?? p.name}
                onChangeText={v => setEditPartnerNames(prev => ({ ...prev, [p.id]: v }))}
                placeholder="Name des Partners"
              />
              <TouchableOpacity
                style={{ padding: 8, backgroundColor: '#fff0f0', borderRadius: 8, borderWidth: 1, borderColor: '#ffc0c0' }}
                onPress={() => handleDeletePartner(p.id, editPartnerNames[p.id] ?? p.name)}>
                <Text style={{ fontSize: 16 }}>🗑️</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={[s.btn, { marginBottom: 14 }]}
              onPress={() => handleUpdatePartnerName(p.id)} disabled={loading}>
              <Text style={s.btnText}>Name speichern</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Text style={{ fontSize: 11, color: '#aaa', marginBottom: 3 }}>Einladungscode</Text>
                <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#3ECF8E', letterSpacing: 2 }}>{p.invite_code}</Text>
              </View>
              <TouchableOpacity style={s.codeBtn}
                onPress={() => Share.share({ message: `Dein Einladungscode fuer die Partner Fantasy League: ${p.invite_code}` })}>
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
          : <TouchableOpacity style={[s.btn, s.btnOutline]} onPress={() => setShowAddPartnerForm(true)}>
              <Text style={s.btnOutlineText}>+ Weiteren Partner anlegen</Text>
            </TouchableOpacity>
        }

        <Text style={[s.sectionLabel, { marginTop: 4 }]}>Konto</Text>
        <TouchableOpacity style={[s.btn, s.btnOutline]} onPress={handleLogout}>
          <Text style={s.btnOutlineText}>Abmelden</Text>
        </TouchableOpacity>
        {loading
          ? <ActivityIndicator color="#ff4444" />
          : <TouchableOpacity
              style={[s.btn, { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ff4444' }]}
              onPress={handleDeleteAccount}>
              <Text style={{ color: '#ff4444', fontWeight: 'bold', fontSize: 16 }}>Konto löschen</Text>
            </TouchableOpacity>
        }
        <Text style={{ fontSize: 12, color: '#bbb', textAlign: 'center' }}>
          Das Löschen entfernt alle deine Daten dauerhaft.
        </Text>
      </ScrollView>
      <StatusBar style="auto" />
    </View>
  );

  return null;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f7f7f7' },
  center: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: { backgroundColor: '#fff', paddingTop: 56, paddingBottom: 16, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: '#eee' },
  headerTitle: { fontSize: 22, fontWeight: 'bold' },
  headerSub: { fontSize: 13, color: '#3ECF8E', marginTop: 2 },
  back: { fontSize: 14, color: '#3ECF8E', marginBottom: 4 },
  codeBtn: { backgroundColor: '#f0fdf9', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  codeBtnText: { fontSize: 13, color: '#3ECF8E', fontWeight: '600' },
  footer: { padding: 20, paddingBottom: 60, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#eee', gap: 10, alignItems: 'center' },
  sectionLabel: { fontSize: 12, fontWeight: '600', color: '#aaa', textTransform: 'uppercase', letterSpacing: 1 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#555', marginBottom: 24 },
  empty: { color: '#aaa', fontSize: 15 },
  input: { width: '100%', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 16, backgroundColor: '#fff' },
  btn: { backgroundColor: '#3ECF8E', borderRadius: 8, padding: 14, width: '100%', alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  btnOutline: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#3ECF8E' },
  btnOutlineText: { color: '#3ECF8E', fontWeight: 'bold', fontSize: 16 },
  btnDisabled: { opacity: 0.4 },
  link: { color: '#3ECF8E', fontSize: 14 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  cardSelected: { borderWidth: 2, borderColor: '#3ECF8E' },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  cardSub: { fontSize: 13, color: '#aaa' },
  pts: { fontSize: 15, fontWeight: 'bold', color: '#3ECF8E' },
  tabs: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#3ECF8E' },
  tabText: { fontSize: 14, color: '#aaa' },
  tabTextActive: { color: '#3ECF8E', fontWeight: 'bold' },
});
