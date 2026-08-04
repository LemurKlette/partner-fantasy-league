import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  ScrollView,
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
type Screen =
  | 'loading' | 'auth' | 'create-partner'
  | 'groups' | 'create-group' | 'join-group'
  | 'group-detail';

function generateInviteCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [partner, setPartner] = useState<Partner | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
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
    const { data: partnerData } = await supabase
      .from('partners').select('id, name')
      .eq('owner_user_id', session.user.id).maybeSingle();
    if (!partnerData) { setScreen('create-partner'); return; }
    setPartner(partnerData);
    await loadGroups(session);
  }

  async function loadGroups(session: Session) {
    const { data } = await supabase
      .from('group_members').select('groups(id, name, invite_code)')
      .eq('user_id', session.user.id);
    setGroups(((data ?? []) as any[]).map(r => r.groups).filter(Boolean));
    setScreen('groups');
  }

  async function openGroup(group: Group) {
    setSelectedGroup(group);
    setLoading(true);
    const { data: memberRows } = await supabase
      .from('group_members').select('user_id').eq('group_id', group.id);
    const userIds = (memberRows ?? []).map((m: any) => m.user_id);
    const { data: partnerRows } = await supabase
      .from('partners').select('id, name, owner_user_id').in('owner_user_id', userIds);
    setGroupMembers(userIds.map(uid => ({
      user_id: uid,
      partner: (partnerRows ?? []).find((p: any) => p.owner_user_id === uid) ?? null,
    })));
    setScreen('group-detail');
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
      .insert({ owner_user_id: session!.user.id, name: partnerName.trim() })
      .select('id, name').single();
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
    else { setGroups(prev => prev.find(g => g.id === data.id) ? prev : [...prev, data]); setInviteCodeInput(''); setScreen('groups'); }
    setLoading(false);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setSession(null); setPartner(null); setGroups([]);
    setEmail(''); setPassword(''); setScreen('auth');
  }

  if (screen === 'loading') return <View style={s.center}><ActivityIndicator size="large" color="#3ECF8E" /><StatusBar style="auto" /></View>;

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
        <Text style={s.headerTitle}>Meine Gruppen</Text>
        <Text style={s.headerSub}>{partner?.name}</Text>
      </View>
      {groups.length === 0
        ? <View style={s.center}><Text style={s.empty}>Du bist noch in keiner Gruppe.</Text></View>
        : <FlatList data={groups} keyExtractor={i => i.id} contentContainerStyle={{ padding: 16, gap: 12 }}
            renderItem={({ item }) => (
              <TouchableOpacity style={s.card} onPress={() => openGroup(item)}>
                <Text style={s.cardTitle}>{item.name}</Text>
                <Text style={s.cardSub}>Code: {item.invite_code} ›</Text>
              </TouchableOpacity>
            )} />
      }
      <View style={s.footer}>
        <TouchableOpacity style={s.btn} onPress={() => setScreen('create-group')}><Text style={s.btnText}>+ Gruppe erstellen</Text></TouchableOpacity>
        <TouchableOpacity style={[s.btn, s.btnOutline]} onPress={() => setScreen('join-group')}><Text style={s.btnOutlineText}>Gruppe beitreten</Text></TouchableOpacity>
        <TouchableOpacity onPress={handleLogout}><Text style={[s.link, { marginTop: 8 }]}>Logout</Text></TouchableOpacity>
      </View>
      <StatusBar style="auto" />
    </View>
  );

  if (screen === 'group-detail') return (
    <View style={s.screen}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => setScreen('groups')}><Text style={s.back}>← Zurück</Text></TouchableOpacity>
        <Text style={s.headerTitle}>{selectedGroup?.name}</Text>
        <Text style={s.headerSub}>Einladungscode: {selectedGroup?.invite_code}</Text>
      </View>
      {loading
        ? <View style={s.center}><ActivityIndicator color="#3ECF8E" /></View>
        : <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
            <Text style={s.sectionLabel}>Mitglieder</Text>
            {groupMembers.map(m => (
              <View key={m.user_id} style={s.card}>
                <Text style={s.cardTitle}>{m.partner?.name ?? '(kein Partner)'}</Text>
              </View>
            ))}
          </ScrollView>
      }
      <View style={s.footer}>
        <TouchableOpacity style={[s.btn, s.btnDisabled]} disabled><Text style={s.btnText}>+ Punkte vergeben (bald)</Text></TouchableOpacity>
        <TouchableOpacity style={[s.btn, s.btnOutline, s.btnDisabled]} disabled><Text style={s.btnOutlineText}>🏆 Ranking (bald)</Text></TouchableOpacity>
      </View>
      <StatusBar style="auto" />
    </View>
  );

  return null;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f7f7f7' },
  center: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: { backgroundColor: '#fff', paddingTop: 56, paddingBottom: 16, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: '#eee' },
  headerTitle: { fontSize: 22, fontWeight: 'bold', marginTop: 4 },
  headerSub: { fontSize: 13, color: '#3ECF8E', marginTop: 2 },
  back: { fontSize: 14, color: '#3ECF8E', marginBottom: 4 },
  footer: { padding: 20, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#eee', gap: 10, alignItems: 'center' },
  sectionLabel: { fontSize: 12, fontWeight: '600', color: '#aaa', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
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
  cardTitle: { fontSize: 16, fontWeight: '600' },
  cardSub: { fontSize: 13, color: '#aaa', marginTop: 4 },
});
