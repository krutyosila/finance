import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  BellOff,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  CreditCard,
  Database,
  HardDrive,
  LayoutDashboard,
  LogOut,
  Landmark,
  Menu,
  Plus,
  ReceiptText,
  Repeat2,
  ShieldCheck,
  Settings2,
  Wallet,
  X,
} from 'lucide-react';
import type { FinancialContext, AiPlan, Transaction, TransactionInput } from '../shared/types';
import { api, useResource } from './api';
import { AiPlanReview } from './components/AiPlanReview';
import { Brand } from './components/Brand';
import { QuickEntry } from './components/QuickEntry';
import { RecordForm } from './components/RecordForms';
import { TransactionForm } from './components/TransactionForm';
import { CycleForm } from './components/CycleForm';
import { History } from './components/History';
import { Button, ConfirmDelete, ErrorMessage, IconButton, Loading, Modal } from './components/ui';
import { Dashboard } from './pages/Dashboard';
import { Transactions } from './pages/Transactions';
import { Records, type FinanceRecord, type RecordKind } from './pages/Records';
import { Reports } from './pages/Reports';
import { Settings } from './pages/Settings';
import { useAuth } from './auth';
import { InstallPanel, OfflineBanner, usePwa } from './pwa';
import { useMobileViewport } from './viewport';

const navigation = [
  { title: 'Genel bakış', icon: LayoutDashboard, path: 'dashboard' },
  { title: 'İşlemler', icon: ReceiptText, path: 'transactions' },
  { title: 'Hesaplar', icon: Wallet, path: 'accounts' },
  { title: 'Borçlar', icon: Landmark, path: 'debts' },
  { title: 'Düzenli ödemeler', icon: Repeat2, path: 'recurring' },
  { title: 'Abonelikler', icon: CreditCard, path: 'subscriptions' },
  { title: 'Raporlar', icon: ChartNoAxesCombined, path: 'reports' },
  { title: 'Ayarlar', icon: Settings2, path: 'settings' },
];
const mobileNavigation = navigation.filter((item) =>
  ['dashboard', 'transactions', 'accounts', 'reports'].includes(item.path),
);
const mobileLayout = '(max-width: 900px), (max-width: 1100px) and (max-height: 500px)';
type Mode =
  | { kind: 'quick' }
  | { kind: 'ai-review'; plan: AiPlan }
  | {
      kind: 'transaction';
      record?: Transaction;
      initial?: Partial<TransactionInput>;
      issues?: string[];
      payPath?: string;
    }
  | { kind: 'record'; collection: RecordKind; record?: FinanceRecord }
  | { kind: 'delete'; collection: RecordKind | 'transactions'; record: FinanceRecord | Transaction }
  | { kind: 'history'; id: string; name: string }
  | { kind: 'cycle'; end?: boolean }
  | { kind: 'workspace' }
  | null;
function currentPage() {
  return (
    navigation.find((item) => item.path === location.hash.replace(/^#\/?/, ''))?.title ||
    'Genel bakış'
  );
}
function recordName(record: FinanceRecord | Transaction) {
  return 'service' in record
    ? record.service
    : 'description' in record
      ? record.description
      : record.name;
}

export function App() {
  const { session, logout } = useAuth();
  const { online } = usePwa();
  const [page, setPage] = useState(currentPage);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobile, setMobile] = useState(() => window.matchMedia(mobileLayout).matches);
  useMobileViewport(mobile);
  const [revision, setRevision] = useState(0);
  const [mode, setMode] = useState<Mode>(null);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);
  const [workspaceResult, setWorkspaceResult] = useState('');
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const resource = useResource<FinancialContext>('/context', revision);
  const context = resource.data;
  const close = useCallback(() => setMode(null), []);
  const notify = useCallback((message: string, error = false) => setToast({ message, error }), []);
  const openQuickEntry = useCallback(() => {
    if (context && online && !reviewBusy) {
      setMobileOpen(false);
      setMode({ kind: 'quick' });
    }
  }, [context, online, reviewBusy]);
  const saved = useCallback(() => {
    setRevision((value) => value + 1);
    close();
    notify('Kaydedildi. Finansal görünümünüz güncel.');
  }, [close, notify]);
  useEffect(() => {
    const onHash = () => {
      setPage(currentPage());
      setMobileOpen(false);
      window.scrollTo({ top: 0, behavior: 'instant' });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openQuickEntry();
      }
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, [openQuickEntry]);
  useEffect(() => {
    const media = window.matchMedia(mobileLayout);
    const update = () => {
      setMobile(media.matches);
      if (!media.matches) setMobileOpen(false);
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!mobileOpen) return;
    const sidebar = document.getElementById('main-navigation')!;
    const controls = () =>
      Array.from(sidebar.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)'));
    controls()[0]?.focus();
    document.body.classList.add('mobile-nav-open');
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
      if (event.key !== 'Tab') return;
      const elements = controls();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.classList.remove('mobile-nav-open');
      document.removeEventListener('keydown', onKeyDown);
      document
        .querySelector<HTMLButtonElement>('.mobile-menu-button')
        ?.focus({ preventScroll: true });
    };
  }, [mobileOpen]);
  useEffect(() => {
    const update = () => {
      if (document.visibilityState === 'visible') setRevision((value) => value + 1);
    };
    window.addEventListener('focus', update);
    const timer = window.setInterval(update, 30000);
    return () => {
      window.removeEventListener('focus', update);
      window.clearInterval(timer);
    };
  }, []);
  function navigate(title: string) {
    const item = navigation.find((item) => item.title === title);
    if (item) {
      location.hash = `/${item.path}`;
      setPage(item.title);
      setMobileOpen(false);
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }
  function review(result: AiPlan) {
    setMode({ kind: 'ai-review', plan: result });
  }
  function openSettings() {
    close();
    navigate('Ayarlar');
  }
  function addRecord(collection: RecordKind) {
    setMode({ kind: 'record', collection });
  }
  async function action(path: string, message: string) {
    try {
      await api(path, 'POST', {});
      setRevision((value) => value + 1);
      notify(message);
    } catch (reason) {
      notify((reason as Error).message, true);
    }
  }
  async function exportRecords() {
    setWorkspaceBusy(true);
    try {
      const result = await api<{ snapshot: string; csv: string }>('/export', 'POST', {});
      setWorkspaceResult(`Dosyalar oluşturuldu: ${result.snapshot} ve ${result.csv}`);
      notify('Finansal kayıtlarınız dışa aktarıldı.');
    } catch (reason) {
      notify((reason as Error).message, true);
    } finally {
      setWorkspaceBusy(false);
    }
  }
  async function backup() {
    setWorkspaceBusy(true);
    try {
      const result = await api<{ path: string }>('/backup', 'POST', {});
      setWorkspaceResult(`Yedek oluşturuldu: ${result.path}`);
      notify('Kayıtlarınızın yedeği oluşturuldu.');
    } catch (reason) {
      notify((reason as Error).message, true);
    } finally {
      setWorkspaceBusy(false);
    }
  }
  const recordLabels: Record<RecordKind, string> = {
    accounts: 'Yeni hesap',
    debts: 'Yeni borç',
    recurring: 'Yeni düzenli ödeme',
    subscriptions: 'Yeni abonelik',
  };
  const editLabels: Record<RecordKind, string> = {
    accounts: 'Hesabı düzenle',
    debts: 'Borcu düzenle',
    recurring: 'Düzenli ödemeyi düzenle',
    subscriptions: 'Aboneliği düzenle',
  };
  const title =
    mode?.kind === 'record' ? (mode.record ? editLabels : recordLabels)[mode.collection] : '';
  const quickAddButton = (
    <button
      id="quick-entry-trigger"
      type="button"
      className="quick-add-fab"
      aria-label="Yapay zekâ ile kayıt ekle"
      aria-haspopup="dialog"
      title="Yapay zekâ ile kayıt ekle (⌘ / Ctrl K)"
      disabled={!context || !online || reviewBusy}
      onClick={openQuickEntry}
      inert={mobileOpen}
    >
      <Plus size={28} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        inert={mobileOpen}
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        İçeriğe geç
      </a>
      {mobileOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Menüyü kapat"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        id="main-navigation"
        className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}
        aria-label="Ana menü"
        aria-hidden={mobile && !mobileOpen ? true : undefined}
        inert={mobile && !mobileOpen}
      >
        <div className="sidebar-heading">
          <a
            className="brand"
            href="#/dashboard"
            onClick={() => setMobileOpen(false)}
            aria-label="Kasa ana sayfa"
          >
            <Brand mark decorative />
          </a>
          <IconButton
            label="Menüyü kapat"
            className="mobile-sidebar-close"
            onClick={() => setMobileOpen(false)}
          >
            <X size={21} />
          </IconButton>
        </div>
        <div className="sidebar-caption">KİŞİSEL ALANINIZ</div>
        <nav>
          {navigation.map((item) => (
            <a
              key={item.path}
              href={`#/${item.path}`}
              aria-current={page === item.title ? 'page' : undefined}
              className={`nav-item ${page === item.title ? 'active' : ''}`}
              onClick={() => setMobileOpen(false)}
            >
              <item.icon size={19} strokeWidth={1.65} />
              <span className="nav-label">{item.title}</span>
              {page === item.title && <span className="nav-current" />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {session.required && (
            <button
              type="button"
              className="sidebar-logout"
              aria-label="Çıkış yap"
              onClick={() => {
                setMobileOpen(false);
                void logout();
              }}
            >
              <LogOut size={18} aria-hidden="true" />
              <span>Çıkış yap</span>
            </button>
          )}
          <div className="sidebar-note">
            <ShieldCheck size={19} />
            <strong>Yalnızca siz ve finansınız.</strong>
            <p>
              {session.required ? 'Finansal alanınız,' : 'Kayıtlarınız burada,'}
              <br />
              {session.required ? 'parolanızla korunur.' : 'bilgisayarınızda kalır.'}
            </p>
          </div>
          <button
            className="workspace-button"
            onClick={() => {
              setMobileOpen(false);
              setWorkspaceResult('');
              setMode({ kind: 'workspace' });
            }}
          >
            <span className="workspace-avatar">
              <img src="/brand/kasa-mark-mint.svg" alt="" width={24} height={24} />
            </span>
            <span>
              <strong>Kişisel alanım</strong>
              <small>
                <i />
                {session.required ? 'Güvenli oturum' : 'Yerel olarak saklanıyor'}
              </small>
            </span>
            <ChevronRight size={15} />
          </button>
        </div>
      </aside>
      <div className="main-shell" inert={mobileOpen}>
        <header className="topbar">
          <div className="topbar-left">
            <a className="topbar-brand" href="#/dashboard" aria-label="Kasa ana sayfa">
              <Brand mark decorative />
            </a>
            <div className="breadcrumb">
              <a href="#/dashboard" aria-label="Ana sayfaya dön">
                Ana sayfa
              </a>
              <ChevronRight size={14} />
              <strong>{page === 'Genel bakış' ? 'Genel bakış' : page}</strong>
            </div>
          </div>
          <div className="topbar-actions">
            <span className="local-status">
              <i />
              {session.required ? 'Size ait. Güvenli oturum.' : 'Size ait. Bilgisayarınızda.'}
            </span>
            <IconButton
              label={mobileOpen ? 'Menüyü kapat' : 'Menüyü aç'}
              className="mobile-menu-button"
              aria-expanded={mobileOpen}
              aria-controls="main-navigation"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              <Menu size={21} aria-hidden="true" />
            </IconButton>
          </div>
        </header>
        <main id="main-content" className="main-content" tabIndex={-1}>
          <OfflineBanner />
          {page === 'Ayarlar' ? (
            <Settings />
          ) : resource.error ? (
            <div className="connection-error">
              <Database size={34} />
              <h1>Finansal alanınıza yeniden bağlanalım.</h1>
              <p>
                Sunucuya ulaşılamadı. Bağlantınızı kontrol edip yeniden deneyin. Yeni kayıtlar
                sunucu bağlantısı gerektirir.
              </p>
              <ErrorMessage message={resource.error} retry={resource.refresh} />
            </div>
          ) : !context ? (
            <Loading />
          ) : (
            <>
              {page === 'Genel bakış' && (
                <Dashboard
                  context={context}
                  onQuickEntry={openQuickEntry}
                  navigate={navigate}
                  onCreate={addRecord}
                  onCycle={() => setMode({ kind: 'cycle' })}
                  onEndCycle={() => setMode({ kind: 'cycle', end: true })}
                  onTransaction={(record) => setMode({ kind: 'transaction', record })}
                />
              )}
              {page === 'İşlemler' && (
                <Transactions
                  context={context}
                  revision={revision}
                  onAdd={() => setMode({ kind: 'transaction' })}
                  onEdit={(record) => setMode({ kind: 'transaction', record })}
                  onDelete={(record) =>
                    setMode({ kind: 'delete', collection: 'transactions', record })
                  }
                  onRestore={(record) =>
                    void action(`/transactions/${record.id}/restore`, 'İşlem geri yüklendi.')
                  }
                  onDuplicate={(record) =>
                    void action(`/transactions/${record.id}/duplicate`, 'İşlem çoğaltıldı.')
                  }
                  onHistory={(record) =>
                    setMode({ kind: 'history', id: record.id, name: record.description })
                  }
                />
              )}
              {['Hesaplar', 'Borçlar', 'Düzenli ödemeler', 'Abonelikler'].includes(page) && (
                <Records
                  kind={navigation.find((item) => item.title === page)!.path as RecordKind}
                  context={context}
                  onAdd={() =>
                    addRecord(navigation.find((item) => item.title === page)!.path as RecordKind)
                  }
                  onEdit={(record) =>
                    setMode({
                      kind: 'record',
                      collection: navigation.find((item) => item.title === page)!
                        .path as RecordKind,
                      record,
                    })
                  }
                  onDelete={(record) =>
                    setMode({
                      kind: 'delete',
                      collection: navigation.find((item) => item.title === page)!
                        .path as RecordKind,
                      record,
                    })
                  }
                  onHistory={(record) =>
                    setMode({ kind: 'history', id: record.id, name: recordName(record) })
                  }
                  onPay={(payPath, initial) =>
                    setMode({ kind: 'transaction', initial, payPath: payPath || undefined })
                  }
                />
              )}
              {page === 'Raporlar' && (
                <Reports
                  context={context}
                  revision={revision}
                  onExport={() => {
                    setWorkspaceResult('');
                    setMode({ kind: 'workspace' });
                    void exportRecords();
                  }}
                  onCycle={() => setMode({ kind: 'cycle' })}
                  onEndCycle={() => setMode({ kind: 'cycle', end: true })}
                />
              )}
            </>
          )}
        </main>
      </div>
      <nav className="mobile-bottom-nav" aria-label="Hızlı gezinme" inert={mobileOpen}>
        {mobileNavigation.map((item, index) => (
          <Fragment key={item.path}>
            {index === 2 && mobile && quickAddButton}
            <a
              href={`#/${item.path}`}
              aria-label={item.title}
              aria-current={page === item.title ? 'page' : undefined}
              className={page === item.title ? 'active' : ''}
            >
              <item.icon size={22} strokeWidth={1.7} aria-hidden="true" />
              <span className="sr-only">{item.title}</span>
            </a>
          </Fragment>
        ))}
      </nav>
      {!mobile && quickAddButton}
      {context && mode?.kind === 'quick' && (
        <Modal
          title="Bir not ekleyin"
          subtitle="Başlamak için kısa bir not yeterli."
          onClose={close}
          wide
        >
          <QuickEntry onReview={review} onSettings={openSettings} compact />
          <div className="quick-manual">
            <span>Ayrıntıları kendiniz girmek ister misiniz?</span>
            <button className="text-button" onClick={() => setMode({ kind: 'transaction' })}>
              Elle ekle
              <ArrowRight size={15} />
            </button>
          </div>
        </Modal>
      )}
      {context && mode?.kind === 'ai-review' && (
        <Modal
          title="Kayıtları gözden geçirin"
          subtitle="Onayladığınızda tüm kayıtlar birlikte kaydedilir."
          onClose={reviewBusy ? () => {} : close}
          wide
        >
          <AiPlanReview
            initial={mode.plan}
            context={context}
            onClose={close}
            onSaved={saved}
            onBusyChange={setReviewBusy}
          />
        </Modal>
      )}
      {context && mode?.kind === 'transaction' && (
        <Modal
          title={
            mode.record
              ? 'İşlemi düzenle'
              : mode.payPath
                ? 'Gerçekleşen ödemeyi kaydet'
                : 'İşlemi gözden geçirin'
          }
          subtitle={
            mode.record
              ? 'Her değişiklik işlem geçmişine kaydedilir.'
              : 'Ayrıntıları kontrol edin, ardından kaydedin.'
          }
          onClose={close}
          wide
        >
          <TransactionForm
            key={mode.record?.id || JSON.stringify(mode.initial) || 'new'}
            context={context}
            transaction={mode.record}
            initial={mode.initial}
            issues={mode.issues}
            payPath={mode.payPath}
            onClose={close}
            onSaved={saved}
          />
        </Modal>
      )}
      {context && mode?.kind === 'record' && (
        <Modal title={title} subtitle="Başlangıç noktanız, kendi rakamlarınızla." onClose={close}>
          <RecordForm
            key={mode.record?.id || mode.collection}
            kind={mode.collection}
            record={mode.record}
            context={context}
            onClose={close}
            onSaved={saved}
          />
        </Modal>
      )}
      {mode?.kind === 'delete' && (
        <ConfirmDelete
          name={recordName(mode.record)}
          detail={
            mode.collection === 'transactions'
              ? 'İşlem silinen kayıtlara taşınır. Daha sonra geri yükleyebilirsiniz.'
              : 'İşlem geçmişiyle bağlantılı kayıtlar silinemez.'
          }
          onClose={close}
          onDelete={async () => {
            await api(`/${mode.collection}/${mode.record.id}`, 'DELETE');
            setRevision((value) => value + 1);
            notify('Kayıt silindi.');
          }}
        />
      )}
      {mode?.kind === 'history' && (
        <Modal title="İşlem geçmişi" subtitle={mode.name} onClose={close} wide>
          <History entityId={mode.id} context={context || undefined} />
        </Modal>
      )}
      {context && mode?.kind === 'cycle' && (
        <Modal
          title={mode.end ? 'Bu finansal dönemi kapat' : 'Finansal dönem başlat'}
          subtitle="Finansal döneminiz takvime bağlı olmak zorunda değil."
          onClose={close}
        >
          <CycleForm
            cycle={mode.end ? context.currentCycle || undefined : undefined}
            onClose={close}
            onSaved={saved}
          />
        </Modal>
      )}
      {mode?.kind === 'workspace' && (
        <Modal
          title="Kişisel alanınız"
          subtitle={
            session.required
              ? 'Parola ile korunan finansal alanınız.'
              : 'Finansal kayıtlarınız için bilgisayarınızda bir alan.'
          }
          onClose={close}
        >
          <div className="workspace-dialog">
            <div className="storage-note">
              <HardDrive size={25} />
              <div>
                <strong>
                  {session.required ? 'Sunucunuzda saklanıyor' : 'Bu bilgisayarda saklanıyor'}
                </strong>
                <p>Kayıtlarınızı istediğiniz zaman yedekleyin veya dışa aktarın.</p>
              </div>
            </div>
            {session.user && <p className="workspace-user">Oturum: {session.user.email}</p>}
            <InstallPanel />
            <div className="workspace-tools">
              <Button variant="secondary" onClick={() => void backup()} disabled={workspaceBusy}>
                <Database size={17} />
                Yedek oluştur
              </Button>
              <Button
                variant="secondary"
                onClick={() => void exportRecords()}
                disabled={workspaceBusy}
              >
                <ArrowDownToLine size={17} />
                Dışa aktar
              </Button>
            </div>
            {workspaceBusy && <Loading text="Dosyalarınız hazırlanıyor…" />}
            {workspaceResult && (
              <p className="workspace-result" role="status">
                <Check size={17} />
                {workspaceResult}
              </p>
            )}
            <p className="page-note">
              Dışa aktarma, finansal durum dosyasını ve işlem tablosunu içerir. Yedekler tüm
              veritabanınızı korur.
            </p>
          </div>
        </Modal>
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? 'toast-error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          <span>{toast.error ? <BellOff size={18} /> : <Check size={18} />}</span>
          <p>{toast.message}</p>
          <IconButton label="Bildirimi kapat" onClick={() => setToast(null)}>
            <X size={16} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
