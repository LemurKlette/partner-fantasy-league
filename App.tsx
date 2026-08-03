import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
type Screen = 'loading' | 'auth' | 'create-partner' | 'create-group' | 'home';

function generateInviteCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [partner, setPartner] = useState<Partner | null>(null);
  const [group, setGroup] = useState<Group | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [groupName, setGroupName] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setSession(session);
        loadUserData(session);
      } else {
        setScreen('auth');
      }
    });
  }, []);

  async function loadUserData(session: Session) {
    const { data: partnerData } = await supabase
      .from('partners')
      .select('id, name')
      .eq('owner_user_id', session.user.id)
      .maybeSingle();

    if (!partnerData) {
      setScreen('create-partner');
      return;
    }
    setPartner(partnerData);

    const { data: memberData } = await supabase
      .from('group_members')
      .select('group_id, groups(id, name, invite_code)')
      .eq('user_id', session.user.id)
      .maybeSingle();

    if (!memberData) {
      setScreen('create-group');
      return;
    }

    const g = memberData.groups as unknown as Group;
    setGroup(g);
    setScreen('home');
  }

  async function handleLogin() {
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      Alert.alert('Fehler', error.message);
    } else {
      setSession(data.session);
      await loadUserData(data.session!);
    }
    setLoading(false);
  }

  async function handleRegister() {
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      Alert.alert('Fehler', error.message);
    } else if (data.session) {
      setSession(data.session);
      await loadUserData(data.session);
    } else {
      Alert.alert('Bestätigung', 'Bitte bestätige deine E-Mail-Adresse.');
    }
    setLoading(false);
  }

  async function handleCreatePartner() {
    if (!partnerName.trim()) {
      Alert.alert('Fehler', 'Bitte gib einen Namen ein.');
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('partners')
      .insert({ owner_user_id: session!.user.id, name: partnerName.trim() })
      .select('id, name')
      .single();

    if (error) {
      Alert.alert('Fehler', error.message);
    } else {
      setPartner(data);
      setScreen('create-group');
    }
    setLoading(false);
  }

  async function handleCreateGroup() {
    if (!groupName.trim()) {
      Alert.alert('Fehler', 'Bitte gib einen Gruppennamen ein.');
      return;
    }
    setLoading(true);

    const invite_code = generateInviteCode();

    const { data: groupData, error: groupError } = await supabase
      .from('groups')
      .insert({ name: groupName.trim(), created_by: session!.user.id, invite_code })
      .select('id, name, invite_code')
      .single();

    if (groupError) {
      Alert.alert('Fehler', groupError.message);
      setLoading(false);
      return;
    }

    const { error: memberError } = await supabase
      .from('group_members')
      .insert({ group_id: groupData.id, user_id: session!.user.id });

    if (memberError) {
      Alert.alert('Fehler', memberError.message);
    } else {
      setGroup(groupData);
      setScreen('home');
    }
    setLoading(false);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setSession(null);
    setPartner(null);
    setGroup(null);
    setEmail('');
    setPassword('');
    setScreen('auth');
  }

  if (screen === 'loading') {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#3ECF8E" />
        <StatusBar style="auto" />
      </View>
    );
  }

  if (screen === 'auth') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{authMode === 'login' ? 'Anmelden' : 'Registrieren'}</Text>
        <TextInput
          style={styles.input}
          placeholder="E-Mail"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          style={styles.input}
          placeholder="Passwort"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        {loading ? (
          <ActivityIndicator style={{ marginTop: 16 }} />
        ) : (
          <TouchableOpacity
            style={styles.button}
            onPress={authMode === 'login' ? handleLogin : handleRegister}
          >
            <Text style={styles.buttonText}>
              {authMode === 'login' ? 'Anmelden' : 'Registrieren'}
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>
          <Text style={styles.switchText}>
            {authMode === 'login'
              ? 'Noch kein Konto? Registrieren'
              : 'Bereits ein Konto? Anmelden'}
          </Text>
        </TouchableOpacity>
        <StatusBar style="auto" />
      </View>
    );
  }

  if (screen === 'create-partner') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Partner anlegen</Text>
        <Text style={styles.subtitle}>Wie heißt dein Partner?</Text>
        <TextInput
          style={styles.input}
          placeholder="Name des Partners"
          value={partnerName}
          onChangeText={setPartnerName}
        />
        {loading ? (
          <ActivityIndicator style={{ marginTop: 16 }} />
        ) : (
          <TouchableOpacity style={styles.button} onPress={handleCreatePartner}>
            <Text style={styles.buttonText}>Weiter</Text>
          </TouchableOpacity>
        )}
        <StatusBar style="auto" />
      </View>
    );
  }

  if (screen === 'create-group') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Gruppe erstellen</Text>
        <Text style={styles.subtitle}>Gebt eurer Gruppe einen Namen.</Text>
        <TextInput
          style={styles.input}
          placeholder="Gruppenname"
          value={groupName}
          onChangeText={setGroupName}
        />
        {loading ? (
          <ActivityIndicator style={{ marginTop: 16 }} />
        ) : (
          <TouchableOpacity style={styles.button} onPress={handleCreateGroup}>
            <Text style={styles.buttonText}>Gruppe erstellen</Text>
          </TouchableOpacity>
        )}
        <StatusBar style="auto" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Gruppe</Text>
      <Text style={styles.groupName}>{group?.name}</Text>
      <Text style={styles.inviteCode}>Einladungscode: {group?.invite_code}</Text>
      <Text style={styles.label} style={{ marginTop: 24 }}>Dein Partner</Text>
      <Text style={styles.partnerName}>{partner?.name}</Text>
      <Text style={styles.emailText}>{session?.user.email}</Text>
      <TouchableOpacity style={[styles.button, styles.logoutButton]} onPress={handleLogout}>
        <Text style={styles.buttonText}>Logout</Text>
      </TouchableOpacity>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#555',
    marginBottom: 24,
  },
  label: {
    fontSize: 12,
    color: '#aaa',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  groupName: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  inviteCode: {
    fontSize: 14,
    color: '#888',
    marginBottom: 8,
  },
  partnerName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#3ECF8E',
    marginBottom: 4,
  },
  emailText: {
    fontSize: 13,
    color: '#aaa',
    marginBottom: 32,
  },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#3ECF8E',
    borderRadius: 8,
    padding: 14,
    width: '100%',
    alignItems: 'center',
    marginTop: 8,
  },
  logoutButton: {
    backgroundColor: '#ccc',
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  switchText: {
    marginTop: 24,
    color: '#3ECF8E',
    fontSize: 14,
  },
});
