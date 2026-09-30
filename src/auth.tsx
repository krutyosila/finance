import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ArrowRight, Eye, EyeOff, LockKeyhole, ShieldCheck, Waves, WifiOff } from 'lucide-react';
import { api } from './api';
import {
  AUTH_REQUIRED_EVENT,
  canOpenFinancialWorkspace,
  createSessionChannel,
  privateRequests,
  type AuthSession,
} from './security';
import { InstallPanel, usePwa } from './pwa';
import { Button, ErrorMessage, Field, IconButton, Loading } from './components/ui';

interface AuthState {
  session: AuthSession;
  logout: () => Promise<void>;
}
const AuthContext = createContext<AuthState | null>(null);

function validateSession(value: AuthSession) {
  if (
    !value ||
    typeof value.required !== 'boolean' ||
    typeof value.authenticated !== 'boolean' ||
    (value.authenticated &&
      value.required &&
      (!value.user || typeof value.user.email !== 'string' || value.user.role !== 'ADMIN'))
  )
    throw new Error('Oturum doğrulanamadı. Yeniden deneyin.');
  return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [logoutError, setLogoutError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const sequence = useRef(0);
  const currentSession = useRef(session);
  currentSession.current = session;
  const sessionChannel = useRef<ReturnType<typeof createSessionChannel> | null>(null);
  const focusCheck = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refreshSession = useCallback(async (suspend = true) => {
    const current = ++sequence.current;
    clearTimeout(focusCheck.current);
    if (suspend) {
      privateRequests.clear();
      setChecking(true);
      setSession(null);
    }
    setError('');
    try {
      const value = validateSession(await api<AuthSession>('/auth/session'));
      if (current === sequence.current) {
        if (!canOpenFinancialWorkspace(value)) privateRequests.clear();
        setSession(value);
      }
    } catch (reason) {
      if (current === sequence.current) {
        privateRequests.clear();
        setSession(null);
        setError((reason as Error).message);
      }
    } finally {
      if (current === sequence.current) setChecking(false);
    }
  }, []);
  useEffect(() => {
    void refreshSession();
    const closePrivateWorkspace = (message: string) => {
      sequence.current += 1;
      clearTimeout(focusCheck.current);
      privateRequests.clear();
      setSession({ required: true, authenticated: false, user: null });
      setChecking(false);
      setError('');
      setMessage(message);
    };
    const expired = () =>
      closePrivateWorkspace('Oturumunuz sona erdi. Devam etmek için yeniden giriş yapın.');
    const channel = createSessionChannel((signal) => {
      if (signal === 'logout')
        closePrivateWorkspace('Başka bir sekmede çıkış yaptınız. Finansal alanınız kapatıldı.');
      else void refreshSession();
    });
    sessionChannel.current = channel;
    const checkOnFocus = () => {
      if (
        document.visibilityState !== 'visible' ||
        !currentSession.current ||
        !canOpenFinancialWorkspace(currentSession.current)
      )
        return;
      clearTimeout(focusCheck.current);
      focusCheck.current = setTimeout(() => {
        if (currentSession.current && canOpenFinancialWorkspace(currentSession.current))
          void refreshSession(false);
      }, 80);
    };
    const pageRestored = (event: PageTransitionEvent) => {
      if (event.persisted) void refreshSession();
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, expired);
    window.addEventListener('pageshow', pageRestored);
    window.addEventListener('focus', checkOnFocus);
    document.addEventListener('visibilitychange', checkOnFocus);
    return () => {
      sequence.current += 1;
      privateRequests.clear();
      window.removeEventListener(AUTH_REQUIRED_EVENT, expired);
      window.removeEventListener('pageshow', pageRestored);
      window.removeEventListener('focus', checkOnFocus);
      document.removeEventListener('visibilitychange', checkOnFocus);
      clearTimeout(focusCheck.current);
      channel.close();
      sessionChannel.current = null;
    };
  }, [refreshSession]);

  async function login(email: string, password: string) {
    await api('/auth/login', 'POST', { email, password });
    setMessage('');
    setLogoutError('');
    await refreshSession();
    sessionChannel.current?.notify('session-changed');
  }
  async function logout() {
    sequence.current += 1;
    clearTimeout(focusCheck.current);
    privateRequests.clear();
    sessionChannel.current?.notify('logout');
    setSession({ required: true, authenticated: false, user: null });
    setChecking(false);
    setMessage('Çıkış yapılıyor…');
    setLogoutError('');
    setLoggingOut(true);
    try {
      await api('/auth/logout', 'POST', {});
      sessionChannel.current?.notify('logout');
      setMessage('Çıkış yaptınız. Finansal alanınız kapatıldı.');
    } catch {
      setMessage('Finansal alanınız bu ekranda kapatıldı.');
      setLogoutError(
        'Çıkış sunucuda tamamlanamadı. Bağlantınız geldiğinde çıkışı yeniden deneyin.',
      );
    } finally {
      setLoggingOut(false);
    }
  }

  if (checking)
    return (
      <div className="auth-checking">
        <img src="/icons/icon.svg" alt="Still" />
        <Loading text="Oturumunuz doğrulanıyor…" />
      </div>
    );
  if (!session) return <AuthConnection error={error} retry={() => void refreshSession()} />;
  if (!canOpenFinancialWorkspace(session))
    return (
      <LoginGate
        login={login}
        message={message}
        logoutError={logoutError}
        retryLogout={() => void logout()}
        loggingOut={loggingOut}
      />
    );
  return <AuthContext.Provider value={{ session, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('Oturum alanı bulunamadı.');
  return context;
}

function AuthConnection({ error, retry }: { error: string; retry: () => void }) {
  const { online } = usePwa();
  return (
    <div className="auth-connection">
      <img src="/icons/icon.svg" alt="Still" />
      <WifiOff size={27} />
      <h1>Bağlantı gerekli.</h1>
      <p>
        {online
          ? 'Finansal alanınızı açmadan önce sunucudaki oturumunuz doğrulanmalı.'
          : 'Çevrimdışısınız. Finansal kayıtlarınızı açmak ve yeni işlem kaydetmek için sunucuya bağlantı gerekir.'}
      </p>
      <ErrorMessage message={error || 'Sunucuya şu anda ulaşılamıyor.'} retry={retry} />
      <p className="auth-privacy-note">
        Finansal veriler ve giriş bilgileri çevrimdışı önbelleğe alınmaz.
      </p>
    </div>
  );
}

function LoginGate({
  login,
  message,
  logoutError,
  retryLogout,
  loggingOut,
}: {
  login: (email: string, password: string) => Promise<void>;
  message: string;
  logoutError: string;
  retryLogout: () => void;
  loggingOut: boolean;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { online } = usePwa();
  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    if (busy || loggingOut) return;
    setBusy(true);
    setError('');
    try {
      await login(email.trim(), password);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPassword('');
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-story">
        <div className="brand">
          <span className="brand-mark">
            <Waves size={29} strokeWidth={1.7} />
          </span>
          <span>
            still<span className="brand-dot">.</span>
          </span>
        </div>
        <div className="auth-story-copy">
          <span className="eyebrow">FİNANSINIZA KİŞİSEL BİR ALAN</span>
          <h1>
            Biraz sakinlik.
            <br />
            Daha net bir bakış.
          </h1>
          <p>
            Geliriniz, harcamalarınız ve borçlarınız.
            <br />
            Hepsi kendi yerinde, tek bir güvenli alanda.
          </p>
          <div className="auth-story-detail">
            <ShieldCheck size={21} />
            <span>
              Parola ile korunan alanınız.
              <br />
              Telefonunuzda ve bilgisayarınızda.
            </span>
          </div>
        </div>
        <p className="auth-story-footer">Kendi rakamlarınız. Kendi ritminiz.</p>
      </section>
      <section className="auth-form-side">
        <div className="login-card">
          <div className="login-symbol">
            <LockKeyhole size={23} />
          </div>
          <span className="eyebrow">YENİDEN HOŞ GELDİNİZ</span>
          <h2>Finansal alanınıza giriş yapın.</h2>
          <p>E-posta adresiniz ve parolanızla devam edin.</p>
          {message && (
            <p className="auth-status" role="status">
              {message}
            </p>
          )}
          {logoutError && <ErrorMessage message={logoutError} retry={retryLogout} />}
          <form onSubmit={signIn}>
            {error && <ErrorMessage message={error} />}
            <Field label="E-posta adresi">
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="E-posta adresiniz"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                autoFocus
                maxLength={254}
              />
            </Field>
            <Field label="Parola">
              <div className="password-input">
                <input
                  type={visible ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Parolanız"
                  autoComplete="current-password"
                  required
                  maxLength={1024}
                />
                <IconButton
                  label={visible ? 'Parolayı gizle' : 'Parolayı göster'}
                  onClick={() => setVisible(!visible)}
                  aria-pressed={visible}
                >
                  {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                </IconButton>
              </div>
            </Field>
            <Button type="submit" disabled={busy || loggingOut || !online}>
              {busy ? 'Giriş yapılıyor…' : 'Giriş yap'}
              <ArrowRight size={17} />
            </Button>
          </form>
          {!online && (
            <p className="login-offline" role="status">
              <WifiOff size={15} />
              Giriş yapmak için sunucu bağlantısı gerekir.
            </p>
          )}
          <p className="auth-privacy-note">
            <ShieldCheck size={14} />
            Finansal içerik yalnızca doğrulanmış oturumda açılır.
          </p>
        </div>
        <InstallPanel compact />
      </section>
    </main>
  );
}
