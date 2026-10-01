import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Check, Download, MonitorSmartphone, Share2, WifiOff } from 'lucide-react';
import { Button } from './components/ui';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
interface PwaState {
  online: boolean;
  installed: boolean;
  canInstall: boolean;
  ios: boolean;
  install: () => Promise<void>;
}
const PwaContext = createContext<PwaState | null>(null);

export function PwaProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(navigator.onLine);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(
    () =>
      window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches ||
      !!(navigator as Navigator & { standalone?: boolean }).standalone,
  );
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  useEffect(() => {
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const didInstall = () => {
      setInstalled(true);
      setPrompt(null);
    };
    const wentOnline = () => setOnline(true);
    const wentOffline = () => setOnline(false);
    const media = window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)');
    const displayChanged = () => {
      if (media.matches) setInstalled(true);
    };
    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', didInstall);
    window.addEventListener('online', wentOnline);
    window.addEventListener('offline', wentOffline);
    media.addEventListener('change', displayChanged);
    return () => {
      window.removeEventListener('beforeinstallprompt', beforeInstall);
      window.removeEventListener('appinstalled', didInstall);
      window.removeEventListener('online', wentOnline);
      window.removeEventListener('offline', wentOffline);
      media.removeEventListener('change', displayChanged);
    };
  }, []);
  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    setPrompt(null);
    if (choice.outcome === 'accepted') setInstalled(true);
  }
  return (
    <PwaContext.Provider
      value={{ online, installed, canInstall: !!prompt && !installed, ios, install }}
    >
      {children}
    </PwaContext.Provider>
  );
}

export function usePwa() {
  const context = useContext(PwaContext);
  if (!context) throw new Error('Uygulama kurulum alanı bulunamadı.');
  return context;
}

export function InstallPanel({ compact = false }: { compact?: boolean }) {
  const { installed, canInstall, ios, install } = usePwa();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <section
      className={`install-panel ${compact ? 'install-panel-compact' : ''}`}
      aria-label="Uygulama kurulumu"
    >
      <span className="install-icon">
        {installed ? <Check size={20} /> : <MonitorSmartphone size={20} />}
      </span>
      <div>
        <h3>{installed ? 'Still uygulaması kurulu' : 'Her ekranda aynı alan'}</h3>
        <p>
          {installed
            ? 'Finansal alanınızı ana ekranınızdan veya masaüstünüzden açabilirsiniz.'
            : 'Still’i telefonunuza veya bilgisayarınıza uygulama olarak ekleyebilirsiniz.'}
        </p>
        {!installed && canInstall ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await install();
              } catch {
                setError('Kurulum açılamadı. Tarayıcınızın kurulum menüsünü deneyin.');
              } finally {
                setBusy(false);
              }
            }}
          >
            <Download size={16} />
            {busy ? 'Kurulum açılıyor…' : 'Uygulamayı yükle'}
          </Button>
        ) : (
          !installed && (
            <p className="install-instruction">
              {ios ? (
                <>
                  <Share2 size={14} />
                  Safari’de Paylaş menüsünden “Ana Ekrana Ekle”yi seçin.
                </>
              ) : (
                'Tarayıcınızın menüsündeki “Uygulamayı yükle” veya “Ana ekrana ekle” seçeneğini kullanın.'
              )}
            </p>
          )
        )}
        {error && (
          <p className="install-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

export function OfflineBanner() {
  const { online } = usePwa();
  if (online) return null;
  return (
    <div className="offline-banner" role="status">
      <WifiOff size={17} />
      <p>
        Çevrimdışısınız. Sunucuya bağlanmadan yeni işlem kaydedilemez; bekleyen işlem kuyruğu
        oluşturulmaz.
      </p>
    </div>
  );
}

export function registerProductionWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  const register = () => {
    void navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch(() => undefined);
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
