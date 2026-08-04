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

type Partner = { id: string; name: string };
type Group = { id: string; name: string; invite_code: string };
type GroupMember = { user_id: string; partner: Partner | null };
type Category = { id: string; name: string; points: number; icon: string; is_global: boolean };
type RankingEntry = { partner_id: string; name: string; total: number };
type EarnedBadge = { partner_id: string; icon: string; name: string };
type ActivityEntry = {
  id: string; points: number; created_at: string; note: string | null;
  partners: { name: string }; point_categories: { name: string };
};
type Period = 'week' | 'month' | 'year';
type Screen =
  | 'loading' | 'auth' | 'create-partner'
  | 'groups' | 'create-group' | 'join-group'
  | 'group-detail' | 'add-points' | 'create-category' | 'manage-categories' | 'profile' | 'help';

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
  const [newCatPoints, setNewCatPoints] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('');
  const [earnedBadges, setEarnedBadges] = useState<EarnedBadge[]>([]);
  const [helpTab, setHelpTab] = useState<'frauen' | 'maenner' | 'faq'>('frauen');
  const [helpReturnScreen, setHelpReturnScreen] = useState<Screen>('groups');
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) { setSession(session); loadUserData(session); }
      else setScreen('auth');
    });
  }, []);

  async function loadUserData(session: Session) {
    const { data: p } = await supabase.from('partners').select('id, name')
      .eq('owner_user_id', session.user.id).maybeSingle();
    if (!p) { setScreen('create-partner'); return; }
    setPartner(p);
    await loadGroups(session);
  }

  async function loadGroups(session: Session) {
    const { data } = await supabase.from('group_members').select('groups(id, name, invite_code)')
      .eq('user_id', session.user.id);
    setGroups(((data ?? []) as any[]).map(r => r.groups).filter(Boolean));
    setScreen('groups');
  }

  async function loadRankingForGroup(groupId: string, p: Period) {
    setRankingLoading(true);
    const { data: memberRows } = await supabase.from('group_members').select('user_id').eq('group_id', groupId);
    const userIds = (memberRows ?? []).map((m: any) => m.user_id);
    const { data: partnerRows } = await supabase.from('partners').select('id, name, owner_user_id').in('owner_user_id', userIds);
    const { data: entries } = await supabase.from('point_entries').select('partner_id, points')
      .eq('group_id', groupId).gte('created_at', getStartDate(p));
    const totals: Record<string, number> = {};
    (entries ?? []).forEach((e: any) => { totals[e.partner_id] = (totals[e.partner_id] || 0) + e.points; });
    setRanking(((partnerRows ?? []) as any[])
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

  async function checkAndAwardBadges(partnerId: string, groupId: string) {
    const [{ data: allBadges }, { data: earnedRows }, { data: allEntries }, { data: weekEntries }, { data: monthEntries }] = await Promise.all([
      supabase.from('badges').select('*'),
      supabase.from('partner_badges').select('badge_id').eq('partner_id', partnerId).eq('group_id', groupId),
      supabase.from('point_entries').select('points, point_categories(category_tag)').eq('partner_id', partnerId).eq('group_id', groupId),
      supabase.from('point_entries').select('points').eq('partner_id', partnerId).eq('group_id', groupId).gte('created_at', getStartDate('week')),
      supabase.from('point_entries').select('points').eq('partner_id', partnerId).eq('group_id', groupId).gte('created_at', getStartDate('month')),
    ]);
    const earnedIds = new Set((earnedRows ?? []).map((b: any) => b.badge_id));
    const totalPoints = (allEntries ?? []).reduce((sum: number, e: any) => sum + e.points, 0);
    const weekPoints = (weekEntries ?? []).reduce((sum: number, e: any) => sum + e.points, 0);
    const monthPoints = (monthEntries ?? []).reduce((sum: number, e: any) => sum + e.points, 0);
    const catTotals: Record<string, number> = {};
    (allEntries ?? []).forEach((e: any) => {
      const tag = (e.point_categories as any)?.category_tag;
      if (tag) catTotals[tag] = (catTotals[tag] || 0) + e.points;
    });
    const newBadgeNames: string[] = [];
    for (const badge of (allBadges ?? []) as any[]) {
      if (earnedIds.has(badge.id)) continue;
      let earned = false;
      if (badge.trigger_type === 'total_points' && totalPoints >= badge.trigger_value) earned = true;
      if (badge.trigger_type === 'week_points' && weekPoints >= badge.trigger_value) earned = true;
      if (badge.trigger_type === 'month_points' && monthPoints >= badge.trigger_value) earned = true;
      if (badge.trigger_type === 'category_points' && badge.category_filter && (catTotals[badge.category_filter] || 0) >= badge.trigger_value) earned = true;
      if (earned) {
        await supabase.from('partner_badges').insert({ partner_id: partnerId, badge_id: badge.id, group_id: groupId });
        newBadgeNames.push(`${badge.icon} ${badge.name}`);
      }
    }
    if (newBadgeNames.length > 0) {
      Alert.alert('🎖️ Badge verdient!', newBadgeNames.join('\n'));
      await loadEarnedBadges(groupId);
    }
  }

  async function loadActivityLog(groupId: string) {
    const { data } = await supabase.from('point_entries')
      .select('id, points, created_at, note, partners(name), point_categories(name)')
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
    setGroupMembers(userIds.map(uid => ({
      user_id: uid,
      partner: (partnerRows ?? []).find((p: any) => p.owner_user_id === uid) ?? null,
    })));
    setPeriod('week');
    await Promise.all([loadRankingForGroup(group.id, 'week'), loadActivityLog(group.id), loadEarnedBadges(group.id)]);
    setScreen('group-detail');
    setLoading(false);
  }

  async function loadCategories() {
    const [{ data: cats }, { data: overrides }] = await Promise.all([
      supabase.from('point_categories')
        .select('id, name, points, icon, is_global')
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
      supabase.from('point_categories').select('id, name, points, icon, is_global').eq('is_global', true).order('name'),
      supabase.from('point_categories').select('id, name, points, icon, is_global').eq('group_id', selectedGroup!.id).order('name'),
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
    const pts = parseInt(newCatPoints, 10);
    if (!newCatName.trim()) { Alert.alert('Fehler', 'Bitte gib einen Namen ein.'); return; }
    if (isNaN(pts) || pts <= 0) { Alert.alert('Fehler', 'Bitte gib eine gültige Punktzahl ein.'); return; }
    setLoading(true);
    const { error } = await supabase.from('point_categories').insert({
      name: newCatName.trim(),
      points: pts,
      icon: newCatIcon.trim() || '⭐',
      is_global: false,
      created_by: session!.user.id,
      group_id: selectedGroup!.id,
    });
    if (error) Alert.alert('Fehler', error.message);
    else {
      setNewCatName(''); setNewCatPoints(''); setNewCatIcon('');
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
    if (error) Alert.alert('Fehler', error.message);
    else { setPartner(data); await loadGroups(session!); }
    setLoading(false);
  }

  async function handleCreateGroup() {
    if (!groupName.trim()) { Alert.alert('Fehler', 'Bitte gib einen Gruppennamen ein.'); return; }
    setLoading(true);
    const invite_code = generateInviteCode();
    const { data, error } = await supabase.from('groups')
      .insert({ name: groupName.trim(), created_by: session!.user.id, invite_code })
      .select('id, name, invite_code').single();
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

  async function handleSavePoints() {
    if (!selectedCategory) { Alert.alert('Fehler', 'Bitte wähle eine Kategorie.'); return; }
    setLoading(true);
    const { error } = await supabase.from('point_entries').insert({
      partner_id: partner!.id, group_id: selectedGroup!.id,
      category_id: selectedCategory.id, points: selectedCategory.points,
      note: note.trim() || null, created_by: session!.user.id,
    });
    if (error) Alert.alert('Fehler', error.message);
    else {
      setSelectedCategory(null);
      setNote('');
      await Promise.all([loadRankingForGroup(selectedGroup!.id, period), loadActivityLog(selectedGroup!.id)]);
      await checkAndAwardBadges(partner!.id, selectedGroup!.id);
      Alert.alert('✅ Gespeichert!', `${selectedCategory.points} Punkte für ${partner!.name} vergeben.`);
      setScreen('group-detail');
    }
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
            <Text style={s.headerSub}>{partner?.name}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <TouchableOpacity onPress={() => setScreen('profile')}>
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
              <TouchableOpacity key={item.id} style={s.card} onPress={() => openGroup(item)}>
                <Text style={s.cardTitle}>{item.name}</Text>
                <Text style={s.cardSub}>Code: {item.invite_code} ›</Text>
              </TouchableOpacity>
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
                    return (
                      <View key={item.partner_id} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 14 }]}>
                        <Text style={{ fontSize: 20, width: 36 }}>{index === 0 ? '🏆' : `${index + 1}.`}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={s.cardTitle}>{item.name}</Text>
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
                  <Text style={s.cardTitle}>
                    {(entry.partners as any).name} hat {(entry.point_categories as any).name} erledigt
                  </Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                    <Text style={[s.cardSub, { flex: 1, marginRight: 8 }]}>{entry.note ? `„${entry.note}"` : ''}</Text>
                    <Text style={[s.pts, { fontSize: 13 }]}>+{entry.points} · {timeAgo(entry.created_at)}</Text>
                  </View>
                </View>
              ))
            }

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

  if (screen === 'add-points') return (
    <View style={s.screen}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => setScreen('group-detail')}><Text style={s.back}>← Zurück</Text></TouchableOpacity>
        <Text style={s.headerTitle}>Punkte vergeben</Text>
        <Text style={s.headerSub}>für {partner?.name} · {selectedGroup?.name}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
        {categories.filter(c => !c.is_global).length > 0 && (
          <>
            <Text style={s.sectionLabel}>Eigene Kategorien</Text>
            {categories.filter(c => !c.is_global).map(cat => (
              <TouchableOpacity key={cat.id} style={[s.card, selectedCategory?.id === cat.id && s.cardSelected]} onPress={() => setSelectedCategory(cat)}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={[s.cardTitle, { flex: 1, marginRight: 8 }]}>{cat.icon}  {cat.name}</Text>
                  <Text style={s.pts}>+{cat.points}</Text>
                </View>
              </TouchableOpacity>
            ))}
            <Text style={[s.sectionLabel, { marginTop: 8 }]}>Standard-Kategorien</Text>
          </>
        )}
        {!categories.some(c => !c.is_global) && <Text style={s.sectionLabel}>Kategorie wählen</Text>}
        {categories.filter(c => c.is_global).map(cat => (
          <TouchableOpacity key={cat.id} style={[s.card, selectedCategory?.id === cat.id && s.cardSelected]} onPress={() => setSelectedCategory(cat)}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={[s.cardTitle, { flex: 1, marginRight: 8 }]}>{cat.icon}  {cat.name}</Text>
              <Text style={s.pts}>+{cat.points}</Text>
            </View>
          </TouchableOpacity>
        ))}
        <Text style={[s.sectionLabel, { marginTop: 12 }]}>Notiz (optional)</Text>
        <TextInput style={[s.input, { height: 80, textAlignVertical: 'top' }]}
          placeholder="Was hat er besonders gut gemacht?"
          value={note} onChangeText={setNote} multiline />
      </ScrollView>
      <View style={s.footer}>
        {loading ? <ActivityIndicator /> : (
          <TouchableOpacity style={[s.btn, !selectedCategory && s.btnDisabled]} onPress={handleSavePoints} disabled={!selectedCategory}>
            <Text style={s.btnText}>{selectedCategory ? `${selectedCategory.points} Punkte speichern` : 'Kategorie wählen'}</Text>
          </TouchableOpacity>
        )}
      </View>
      <StatusBar style="auto" />
    </View>
  );

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

        <Text style={s.sectionLabel}>Punkte</Text>
        <TextInput style={s.input} placeholder="z.B. 10"
          value={newCatPoints} onChangeText={setNewCatPoints}
          keyboardType="numeric" />

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

  if (screen === 'profile') return (
    <View style={s.screen}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => setScreen('groups')}><Text style={s.back}>← Zurück</Text></TouchableOpacity>
        <Text style={s.headerTitle}>Profil & Einstellungen</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
        <Text style={s.sectionLabel}>Konto</Text>
        <View style={s.card}>
          <Text style={{ fontSize: 12, color: '#aaa', marginBottom: 2 }}>E-Mail</Text>
          <Text style={{ fontSize: 16 }}>{session?.user.email}</Text>
        </View>
        <View style={s.card}>
          <Text style={{ fontSize: 12, color: '#aaa', marginBottom: 2 }}>Partner-Name</Text>
          <Text style={{ fontSize: 16 }}>{partner?.name}</Text>
        </View>

        <Text style={[s.sectionLabel, { marginTop: 16 }]}>Aktionen</Text>
        <TouchableOpacity style={[s.btn, s.btnOutline]} onPress={handleLogout}>
          <Text style={s.btnOutlineText}>Abmelden</Text>
        </TouchableOpacity>

        {loading
          ? <ActivityIndicator color="#ff4444" style={{ marginTop: 8 }} />
          : <TouchableOpacity
              style={[s.btn, { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ff4444' }]}
              onPress={handleDeleteAccount}>
              <Text style={{ color: '#ff4444', fontWeight: 'bold', fontSize: 16 }}>Konto löschen</Text>
            </TouchableOpacity>
        }
        <Text style={{ fontSize: 12, color: '#bbb', textAlign: 'center', marginTop: 4 }}>
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
