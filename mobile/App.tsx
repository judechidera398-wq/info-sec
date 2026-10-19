import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://infosec-one.vercel.app').replace(/\/$/, '');
const TOKEN_KEY = 'library_access_token';
type User = { id: number; username: string; role: string };
type Book = { id: number; title: string; author: string; category: string; copies_available: number; copies_total: number };
type Row = Record<string, string | number | null>;
type MfaSetup = { secret: string; qr: string };

async function api<T>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('X-App-Client', 'mobile');
  if (init.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [enrolled, setEnrolled] = useState(true);
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [members, setMembers] = useState<Row[]>([]);
  const [loans, setLoans] = useState<Row[]>([]);
  const [tab, setTab] = useState<'books' | 'members' | 'loans' | 'account'>('books');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    SecureStore.getItemAsync(TOKEN_KEY).then(async saved => {
      if (!saved) return;
      try {
        const me = await api<User>('/api/auth/me', saved);
        if (mounted) { setToken(saved); setUser(me); }
      } catch { await SecureStore.deleteItemAsync(TOKEN_KEY); }
    }).catch(() => undefined);
    return () => { mounted = false; };
  }, []);

  async function loadData(currentToken: string, selectedTab = tab, term = search) {
    const q = encodeURIComponent(term.trim());
    const [bookRows, memberRows, loanRows] = await Promise.all([
      api<Book[]>(`/api/books?q=${q}`, currentToken),
      user && ['admin', 'manager', 'inputer'].includes(user.role) ? api<Row[]>('/api/members', currentToken).catch(() => []) : Promise.resolve([]),
      user && ['admin', 'manager', 'inputer'].includes(user.role) ? api<Row[]>('/api/loans', currentToken).catch(() => []) : Promise.resolve([]),
    ]);
    setBooks(bookRows); setMembers(memberRows); setLoans(loanRows); setTab(selectedTab);
  }

  useEffect(() => { if (token && user) loadData(token).catch(e => setError(e.message)); }, [token, user]);

  async function signIn() {
    setBusy(true); setError('');
    try {
      const result = await api<{ pendingToken: string; mfaEnrolled: boolean }>('/api/auth/login', undefined, {
        method: 'POST', body: JSON.stringify({ username, password }),
      });
      setPendingToken(result.pendingToken); setEnrolled(result.mfaEnrolled); setPassword('');
      if (!result.mfaEnrolled) {
        const data = await api<MfaSetup>('/api/auth/mfa-setup', result.pendingToken);
        setSetup(data);
      }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function finishMfa() {
    if (!pendingToken) return;
    setBusy(true); setError('');
    try {
      const result = enrolled
        ? await api<{ token: string }>('/api/auth/verify', pendingToken, { method: 'POST', body: JSON.stringify({ code }) })
        : await api<{ token: string; recoveryCodes: string[] }>('/api/auth/mfa-setup', pendingToken, { method: 'POST', body: JSON.stringify({ code }) });
      await SecureStore.setItemAsync(TOKEN_KEY, result.token);
      const me = await api<User>('/api/auth/me', result.token);
      setToken(result.token); setUser(me); setPendingToken(null); setSetup(null); setCode('');
      if ('recoveryCodes' in result) setRecoveryCodes(result.recoveryCodes);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function signOut() {
    const current = token;
    setBusy(true);
    try { if (current) await api('/api/auth/logout', current, { method: 'POST' }); }
    catch { /* Remove the local token even when the server is unreachable. */ }
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setToken(null); setUser(null); setPendingToken(null); setSetup(null); setRecoveryCodes([]); setBusy(false);
  }

  const staff = !!user && ['admin', 'manager', 'inputer'].includes(user.role);
  const roleLabel = user?.role === 'inputer' ? 'Inputer' : user?.role ? user.role[0].toUpperCase() + user.role.slice(1) : '';

  return <SafeAreaView style={styles.safe}>
    <StatusBar style="light" />
    <View style={styles.topbar}><View><Text style={styles.brand}>VAULT<Text style={styles.brandAccent}>OF</Text>VALUE</Text><Text style={styles.topSub}>LIBRARY SYSTEM</Text></View><View style={styles.statusDot} /></View>
    {!user ? <ScrollView contentContainerStyle={styles.authWrap} keyboardShouldPersistTaps="handled">
      <Text style={styles.kicker}>{pendingToken ? 'IDENTITY CHECK' : 'SECURE ACCESS'}</Text>
      <Text style={styles.heading}>{pendingToken ? (enrolled ? 'Verify it’s you' : 'Set up two-factor') : 'Welcome back.'}</Text>
      <Text style={styles.subheading}>{pendingToken ? (enrolled ? 'Enter the 6-digit code from your authenticator app.' : 'Scan this QR code with an authenticator app, then enter the code it generates.') : 'Sign in to your library account.'}</Text>
      {pendingToken ? <>
        {setup && <View style={styles.qrCard}><Image source={{ uri: setup.qr }} style={styles.qr} /><Text style={styles.smallMuted}>Manual setup key</Text><Text selectable style={styles.secret}>{setup.secret}</Text></View>}
        <TextInput value={code} onChangeText={setCode} placeholder={useRecoveryCode ? 'Recovery code' : '000 000'} placeholderTextColor="#70817b" keyboardType={useRecoveryCode ? 'default' : 'number-pad'} autoCapitalize="none" autoComplete={useRecoveryCode ? 'off' : 'one-time-code'} style={[styles.input, !useRecoveryCode && styles.codeInput]} maxLength={32} />
        {enrolled && <Pressable onPress={() => { setUseRecoveryCode(!useRecoveryCode); setCode(''); }}><Text style={styles.link}>{useRecoveryCode ? 'Use authenticator code' : 'Use a recovery code'}</Text></Pressable>}
        <Pressable onPress={finishMfa} disabled={busy || code.trim().length < 6} style={[styles.primary, (busy || code.trim().length < 6) && styles.disabled]}>{busy ? <ActivityIndicator color="#06100c" /> : <Text style={styles.primaryText}>{enrolled ? 'VERIFY & CONTINUE' : 'ENABLE & CONTINUE'}</Text>}</Pressable>
        <Pressable onPress={() => { setPendingToken(null); setSetup(null); setCode(''); }}><Text style={styles.link}>Back to sign in</Text></Pressable>
      </> : <>
        <Text style={styles.label}>USERNAME</Text><TextInput value={username} onChangeText={setUsername} placeholder="Your username" placeholderTextColor="#70817b" autoCapitalize="none" style={styles.input} />
        <Text style={styles.label}>PASSWORD</Text><TextInput value={password} onChangeText={setPassword} placeholder="Your password" placeholderTextColor="#70817b" secureTextEntry style={styles.input} onSubmitEditing={signIn} />
        <Pressable onPress={signIn} disabled={busy || !username || !password} style={[styles.primary, (busy || !username || !password) && styles.disabled]}>{busy ? <ActivityIndicator color="#06100c" /> : <Text style={styles.primaryText}>CONTINUE SECURELY</Text>}</Pressable>
      </>}
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Text style={styles.footnote}>Protected with two-factor authentication</Text>
    </ScrollView> : <>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.welcome}><View><Text style={styles.kicker}>LIBRARY OVERVIEW</Text><Text style={styles.heading}>Your library.</Text></View><View style={styles.rolePill}><Text style={styles.roleText}>{roleLabel.toUpperCase()}</Text></View></View>
        <Text style={styles.welcomeSub}>Signed in as <Text style={styles.white}>{user.username}</Text></Text>
        {recoveryCodes.length > 0 && <View style={styles.recovery}><Text style={styles.cardTitle}>SAVE YOUR RECOVERY CODES</Text><Text style={styles.smallMuted}>These are shown once. Store them somewhere safe.</Text><Text selectable style={styles.recoveryText}>{recoveryCodes.join('\n')}</Text><Pressable onPress={() => setRecoveryCodes([])}><Text style={styles.link}>I’ve saved these</Text></Pressable></View>}
        {tab === 'books' && <>
          <View style={styles.statCard}><Text style={styles.stat}>{books.length}</Text><Text style={styles.statLabel}>CATALOGUE RESULTS</Text></View>
          <TextInput value={search} onChangeText={setSearch} onSubmitEditing={() => token && loadData(token, 'books', search).catch(e => setError(e.message))} placeholder="Search title or author" placeholderTextColor="#71827a" style={styles.input} returnKeyType="search" />
          {books.map(book => <View key={book.id} style={styles.bookCard}><View style={styles.bookIcon}><Text style={styles.bookIconText}>B</Text></View><View style={styles.bookInfo}><Text style={styles.bookTitle}>{book.title}</Text><Text style={styles.bookAuthor}>{book.author}</Text><Text style={styles.bookCategory}>{book.category || 'GENERAL'}</Text></View><Text style={[styles.available, book.copies_available < 1 && styles.unavailable]}>{book.copies_available}/{book.copies_total}</Text></View>)}
          {books.length === 0 && <Text style={styles.empty}>No books found.</Text>}
        </>}
        {tab === 'members' && <><Text style={styles.sectionTitle}>MEMBERS · {members.length}</Text>{members.map(row => <View key={String(row.id)} style={styles.rowCard}><Text style={styles.bookTitle}>{String(row.full_name)}</Text><Text style={styles.bookAuthor}>{String(row.member_code)} · {String(row.email || 'No email')}</Text></View>)}</>}
        {tab === 'loans' && <><Text style={styles.sectionTitle}>LOANS · {loans.length}</Text>{loans.map(row => <View key={String(row.id)} style={styles.rowCard}><Text style={styles.bookTitle}>{String(row.book_title)}</Text><Text style={styles.bookAuthor}>{String(row.member_name)} · due {String(row.due_at).slice(0, 10)}</Text><Text style={styles.bookCategory}>{String(row.status).replace('_', ' ').toUpperCase()}</Text></View>)}</>}
        {tab === 'account' && <View style={styles.accountCard}><Text style={styles.cardTitle}>ACCOUNT</Text><Text style={styles.accountName}>{user.username}</Text><Text style={styles.bookAuthor}>Role-based access · {roleLabel}</Text><Text style={styles.smallMuted}>Two-factor authentication is active.</Text><Pressable onPress={signOut} style={styles.outlineButton}><Text style={styles.outlineText}>SIGN OUT</Text></Pressable></View>}
        {!!error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
      <View style={styles.nav}>{(['books', ...(staff ? ['members', 'loans'] : []), 'account'] as Array<'books' | 'members' | 'loans' | 'account'>).map(item => <Pressable key={item} onPress={() => { setTab(item); setError(''); }} style={styles.navItem}><Text style={[styles.navText, tab === item && styles.navActive]}>{item.toUpperCase()}</Text></Pressable>)}</View>
    </>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#07110d' }, topbar: { height: 68, paddingHorizontal: 22, borderBottomWidth: 1, borderBottomColor: '#1d3026', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { color: '#eef6f0', letterSpacing: 2.4, fontSize: 16, fontWeight: '900' }, brandAccent: { color: '#59d58a' }, topSub: { color: '#80928a', fontSize: 8, letterSpacing: 2.1, marginTop: 3 }, statusDot: { width: 9, height: 9, backgroundColor: '#59d58a', borderRadius: 10 },
  authWrap: { padding: 24, paddingTop: 54, flexGrow: 1 }, kicker: { color: '#59d58a', fontSize: 10, letterSpacing: 2, fontWeight: '800', marginBottom: 12 }, heading: { color: '#f1f6f2', fontSize: 32, fontWeight: '700', letterSpacing: -0.8 }, subheading: { color: '#98a9a0', fontSize: 14, lineHeight: 21, marginTop: 9, marginBottom: 32 }, label: { color: '#a9b8b0', fontSize: 10, letterSpacing: 1.6, fontWeight: '700', marginBottom: 9, marginTop: 20 }, input: { borderWidth: 1, borderColor: '#294235', borderRadius: 12, backgroundColor: '#0c1912', color: '#edf6f0', paddingHorizontal: 15, height: 52, fontSize: 15 },
  primary: { height: 54, borderRadius: 12, marginTop: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#63dd91' }, primaryText: { color: '#07140c', fontSize: 11, fontWeight: '900', letterSpacing: 1.3 }, disabled: { opacity: 0.55 }, link: { textAlign: 'center', marginTop: 22, color: '#74dda0', fontSize: 13 }, footnote: { color: '#708178', fontSize: 11, textAlign: 'center', marginTop: 34 }, error: { color: '#ff9f9f', marginTop: 16, lineHeight: 20, textAlign: 'center' },
  codeInput: { textAlign: 'center', letterSpacing: 8, fontSize: 22 }, qrCard: { padding: 18, borderWidth: 1, borderColor: '#294235', backgroundColor: '#0c1912', borderRadius: 16, alignItems: 'center', marginBottom: 20 }, qr: { width: 180, height: 180, marginBottom: 14, backgroundColor: '#fff' }, smallMuted: { color: '#90a199', fontSize: 11, marginTop: 8, textAlign: 'center' }, secret: { color: '#dbebe0', fontSize: 13, letterSpacing: 1.4, marginTop: 7 },
  content: { padding: 20, paddingBottom: 30 }, welcome: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 22 }, welcomeSub: { color: '#879990', fontSize: 13, marginTop: 7, marginBottom: 22 }, white: { color: '#e9f4ec' }, rolePill: { borderWidth: 1, borderColor: '#315642', backgroundColor: '#10251a', borderRadius: 30, paddingVertical: 8, paddingHorizontal: 12 }, roleText: { color: '#75dfa0', fontWeight: '800', fontSize: 9, letterSpacing: 1.2 }, statCard: { backgroundColor: '#0e1e15', borderColor: '#20382a', borderWidth: 1, borderRadius: 15, padding: 18, marginBottom: 15 }, stat: { color: '#65dc93', fontWeight: '700', fontSize: 30 }, statLabel: { color: '#8da096', fontWeight: '700', fontSize: 9, letterSpacing: 1.6, marginTop: 4 },
  bookCard: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#1e3327', backgroundColor: '#0b1710', marginTop: 10 }, bookIcon: { width: 42, height: 48, borderRadius: 8, backgroundColor: '#163323', alignItems: 'center', justifyContent: 'center', marginRight: 12 }, bookIconText: { color: '#71e19d', fontSize: 17, fontWeight: '800' }, bookInfo: { flex: 1 }, bookTitle: { color: '#eaf3ed', fontSize: 14, fontWeight: '700' }, bookAuthor: { color: '#91a198', fontSize: 12, marginTop: 5 }, bookCategory: { color: '#5bc984', fontSize: 9, letterSpacing: 1, fontWeight: '700', marginTop: 7 }, available: { color: '#6de09a', fontSize: 11, fontWeight: '700' }, unavailable: { color: '#ff9c9c' }, empty: { color: '#95a69d', textAlign: 'center', marginTop: 40 },
  nav: { minHeight: 62, borderTopWidth: 1, borderTopColor: '#1d3026', backgroundColor: '#09140e', flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingBottom: 4 }, navItem: { padding: 12 }, navText: { fontSize: 9, letterSpacing: 1, fontWeight: '800', color: '#71847a' }, navActive: { color: '#6de09a' }, sectionTitle: { color: '#63d890', fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 12, marginTop: 12 }, rowCard: { padding: 15, borderRadius: 12, borderWidth: 1, borderColor: '#1e3327', backgroundColor: '#0c1912', marginBottom: 9 }, accountCard: { padding: 20, backgroundColor: '#0c1912', borderColor: '#20382a', borderWidth: 1, borderRadius: 15, marginTop: 8 }, cardTitle: { color: '#65dc93', fontWeight: '900', fontSize: 10, letterSpacing: 1.4 }, accountName: { color: '#edf5ef', fontSize: 20, fontWeight: '700', marginTop: 18 }, outlineButton: { marginTop: 28, borderWidth: 1, borderColor: '#3c5e4a', padding: 14, alignItems: 'center', borderRadius: 10 }, outlineText: { color: '#bfe9cd', fontSize: 10, fontWeight: '900', letterSpacing: 1.4 }, recovery: { padding: 16, borderWidth: 1, borderColor: '#795e2f', borderRadius: 14, backgroundColor: '#261e0c', marginBottom: 18 }, recoveryText: { color: '#f4dfa7', fontFamily: 'monospace', fontSize: 12, lineHeight: 21, marginTop: 14 },
});
