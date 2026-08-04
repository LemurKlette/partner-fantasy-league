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
type Category = { id: string; name: string; points: number; icon: string };
type RankingEntry = { partner_id: string; name: string; total: number };
type ActivityEntry = {
  id: string; points: number; created_at: string; note: string | null;
  partners: { name: string }; point_categories: { name: string };
};
type Period = 'week' | 'month' | 'year';
type Screen =
  | 'loading' | 'auth' | 'create-partner'
  | 'groups' | 'create-group' | 'join-group'
  | 'group-detail' | 'add-points' | 'profile';

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
    await Promise.all([loadRankingForGroup(group.id, 'week'), loadActivityLog(group.id)]);
    setScreen('group-detail');
    setLoading(false);
  }

  async function loadCategories() {
    const { data } = await supabase.from('point_categories').select('id, name, points, icon')
      .eq('is_global', true).order('name');
    setCategories((data ?? []) as Category[]);
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
      Alert.alert('✅ Gespeichert!', `${selectedCategory.points} Punkte für ${partner!.name} vergeben.`);
      setSelectedCategory(null);
      setNote('');
      await Promise.all([loadRankingForGroup(selectedGroup!.id, period), loadActivityLog(selectedGroup!.id)]);
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
          <TouchableOpacity onPress={() => setScreen('profile')}>
            <Text style={{ fontSize: 13, color: '#3ECF8E' }}>Profil ›</Text>
          </TouchableOpacity>
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
          <TouchableOpacity onPress={() => Share.share({ message: `Tritt unserer Gruppe "${selectedGroup?.name}" bei! Code: ${selectedGroup?.invite_code}` })} style={s.codeBtn}>
            <Text style={s.codeBtnText}>{selectedGroup?.invite_code} 🔗</Text>
          </TouchableOpacity>
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

      {loading
        ? <View style={s.center}><ActivityIndicator color="#3ECF8E" /></View>
        : <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 130 }}>

            <Text style={s.sectionLabel}>Ranking</Text>
            {rankingLoading
              ? <ActivityIndicator color="#3ECF8E" />
              : ranking.length === 0
                ? <Text style={s.empty}>Noch keine Punkte in diesem Zeitraum.</Text>
                : ranking.map((item, index) => (
                  <View key={item.partner_id} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 14 }]}>
                    <Text style={{ fontSize: 20, width: 36 }}>{index === 0 ? '🏆' : `${index + 1}.`}</Text>
                    <Text style={[s.cardTitle, { flex: 1 }]}>{item.name}</Text>
                    <Text style={s.pts}>{item.total} Pkt</Text>
                  </View>
                ))
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
        <TouchableOpacity style={[s.btn, s.btnOutline, s.btnDisabled]} disabled>
          <Text style={s.btnOutlineText}>+ Eigene Kategorie (bald)</Text>
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
        <Text style={s.sectionLabel}>Kategorie wählen</Text>
        {categories.map(cat => (
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
