import { useState } from 'react';
import { Check, KeyRound, LoaderCircle, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react';
import { api, useResource } from '../api';
import { useAuth } from '../auth';
import { usePwa } from '../pwa';
import { Button, ErrorMessage, Field, Loading, PageIntro, Panel, Tag } from '../components/ui';

interface AiSettings {
  provider: 'openai';
  configured: boolean;
  model: string;
}

const modelPresets = [
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini (varsayılan)' },
  { value: 'gpt-5.4-nano', label: 'GPT-5.4 Nano' },
  { value: 'gpt-5.4', label: 'GPT-5.4' },
] as const;

function choiceForModel(model: string) {
  return modelPresets.some((preset) => preset.value === model) ? model : 'custom';
}

export function Settings() {
  const settings = useResource<AiSettings>('/settings/ai');
  const { session } = useAuth();
  return (
    <>
      <PageIntro
        eyebrow="KENDİ ALANINIZ, KENDİ TERCİHLERİNİZ"
        title="Ayarlar"
        description="Hızlı kayıt için OpenAI bağlantınızı ve hesap güvenliğinizi yönetin."
      />
      <div className="settings-layout">
        <Panel className="settings-panel">
          {settings.loading && !settings.data ? (
            <Loading text="OpenAI ayarları yükleniyor…" />
          ) : settings.error ? (
            <ErrorMessage message={settings.error} retry={settings.refresh} />
          ) : settings.data ? (
            <AiConnectionForm initial={settings.data} />
          ) : null}
        </Panel>
        {session.required && (
          <Panel className="settings-panel">
            <PasswordForm />
          </Panel>
        )}
      </div>
    </>
  );
}

function AiConnectionForm({ initial }: { initial: AiSettings }) {
  const { online } = usePwa();
  const [connection, setConnection] = useState(initial);
  const [model, setModel] = useState(initial.model);
  const [modelChoice, setModelChoice] = useState(() => choiceForModel(initial.model));
  const [customModel, setCustomModel] = useState(() =>
    choiceForModel(initial.model) === 'custom' ? initial.model : '',
  );
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const dirty = model.trim() !== connection.model || !!apiKey.trim();
  function clearFeedback() {
    setConfirmed(false);
    setMessage('');
    setError('');
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!model.trim()) {
      setError('Kaydetmeden önce bir model adı girin.');
      return;
    }
    setBusy('save');
    setError('');
    setMessage('');
    try {
      const value = await api<AiSettings>('/settings/ai', 'PATCH', {
        model: model.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setConnection(value);
      setModel(value.model);
      setModelChoice(choiceForModel(value.model));
      if (choiceForModel(value.model) === 'custom') setCustomModel(value.model);
      setApiKey('');
      setConfirmed(false);
      setMessage(
        value.configured
          ? 'Ayarlar kaydedildi. Bağlantıyı test ederek OpenAI erişimini doğrulayabilirsiniz.'
          : 'Model ayarı kaydedildi. Hızlı kayıt için bir API anahtarı ekleyin.',
      );
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function testConnection() {
    if (busy || dirty || !connection.configured) return;
    setBusy('test');
    setError('');
    setMessage('');
    setConfirmed(false);
    try {
      const result = await api<{ ok: true; provider: 'openai'; model: string }>(
        '/settings/ai/test',
        'POST',
        {},
      );
      if (!result.ok || result.provider !== 'openai')
        throw new Error('OpenAI bağlantısı doğrulanamadı. Ayarlarınızı kontrol edin.');
      if (result.model !== connection.model)
        throw new Error(
          'Model ayarı başka bir sekmede değişmiş. Sayfayı yenileyip yeniden deneyin.',
        );
      setConfirmed(true);
      setMessage(`OpenAI bağlantısı ${result.model} modeliyle doğrulandı.`);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <div className="settings-section-head">
        <span className="settings-symbol">
          <Sparkles size={23} />
        </span>
        <div>
          <h2>OpenAI ile hızlı kayıt</h2>
          <p>Bir not yazın. Açık işlemler otomatik kaydedilsin.</p>
        </div>
        <Tag tone={confirmed && !dirty ? 'teal' : connection.configured ? 'blue' : ''}>
          {confirmed && !dirty
            ? 'Bağlantı doğrulandı'
            : connection.configured
              ? 'Anahtar kayıtlı'
              : 'Anahtar bekleniyor'}
        </Tag>
      </div>
      <form className="settings-form" onSubmit={save}>
        {error && <ErrorMessage message={error} />}
        {message && (
          <p className="settings-success" role="status">
            <Check size={16} />
            {message}
          </p>
        )}
        <Field label="Sağlayıcı">
          <input value="OpenAI" readOnly />
        </Field>
        <Field label="Model" hint="Seçtiğiniz modelin hesabınızda erişilebilir olması gerekir.">
          <select
            value={modelChoice}
            onChange={(event) => {
              const choice = event.target.value;
              setModelChoice(choice);
              setModel(choice === 'custom' ? customModel : choice);
              clearFeedback();
            }}
            required
            disabled={!!busy}
          >
            {modelPresets.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
            <option value="custom">Diğer model</option>
          </select>
        </Field>
        {modelChoice === 'custom' && (
          <Field label="Model adı">
            <input
              value={customModel}
              onChange={(event) => {
                setCustomModel(event.target.value);
                setModel(event.target.value);
                clearFeedback();
              }}
              autoComplete="off"
              spellCheck={false}
              required
              maxLength={200}
              disabled={!!busy}
            />
          </Field>
        )}
        <Field
          label="API anahtarı"
          hint={
            connection.configured
              ? 'Yeni bir anahtar girmediğinizde kayıtlı anahtar korunur.'
              : 'OpenAI API anahtarınızı ekleyin. Kayıtlı anahtar tekrar gösterilmez.'
          }
        >
          <input
            type="password"
            name="openai-api-key"
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value);
              clearFeedback();
            }}
            placeholder={
              connection.configured ? 'Yeni anahtar için doldurun' : 'OpenAI API anahtarınız'
            }
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            maxLength={1024}
            disabled={!!busy}
          />
        </Field>
        <div className="settings-privacy">
          <ShieldCheck size={18} />
          <p>
            Yazdığınız not, hesap ve borç adlarınız işlemi anlamlandırmak için OpenAI’ye gönderilir.
            API anahtarınız bu ekranda geri gösterilmez.
          </p>
        </div>
        <div className="settings-actions">
          <Button type="submit" disabled={!!busy || !dirty || !online}>
            {busy === 'save' ? <LoaderCircle size={16} className="spin" /> : <KeyRound size={16} />}
            {busy === 'save' ? 'Kaydediliyor…' : 'Ayarları kaydet'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void testConnection()}
            disabled={!!busy || dirty || !connection.configured || !online}
          >
            {busy === 'test' && <LoaderCircle size={16} className="spin" />}
            {busy === 'test' ? 'Bağlantı deneniyor…' : 'Bağlantıyı test et'}
          </Button>
        </div>
        {dirty && (
          <p className="settings-hint">Bağlantı testinden önce değişikliklerinizi kaydedin.</p>
        )}
        {!connection.configured && (
          <p className="settings-hint">
            Anahtar eklenene kadar hızlı kayıt kullanılamaz. İşlemleri elle ekleyebilirsiniz.
          </p>
        )}
      </form>
    </>
  );
}

function PasswordForm() {
  const { logout } = useAuth();
  const { online } = usePwa();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (newPassword !== confirmation) {
      setError('Yeni parola ve tekrarı eşleşmiyor.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('Yeni parolanız mevcut parolanızdan farklı olmalı.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api('/auth/password', 'POST', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      await logout('Parolanız değiştirildi. Yeni parolanızla yeniden giriş yapın.');
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="settings-section-head">
        <span className="settings-symbol settings-symbol-blue">
          <LockKeyhole size={23} />
        </span>
        <div>
          <h2>Parolanızı değiştirin</h2>
          <p>Finansal alanınıza erişimi yalnızca siz yönetin.</p>
        </div>
      </div>
      <form className="settings-form" onSubmit={save}>
        {error && <ErrorMessage message={error} />}
        <Field label="Mevcut parola">
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            minLength={8}
            maxLength={1024}
            required
            disabled={busy}
          />
        </Field>
        <Field
          label="Yeni parola"
          hint="En az 8 karakter kullanın. Parola yöneticinizin önerdiği güçlü bir parola seçebilirsiniz."
        >
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            minLength={8}
            maxLength={1024}
            required
            disabled={busy}
          />
        </Field>
        <Field label="Yeni parola tekrar">
          <input
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            minLength={8}
            maxLength={1024}
            required
            disabled={busy}
          />
        </Field>
        <p className="settings-hint">
          Parolanız değiştirildiğinde tüm açık oturumlarınız kapanır. Yeni parolanızla yeniden giriş
          yapmanız gerekir.
        </p>
        <div className="settings-actions">
          <Button type="submit" disabled={busy || !online}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <LockKeyhole size={16} />}
            {busy ? 'Parola değiştiriliyor…' : 'Parolayı değiştir'}
          </Button>
        </div>
      </form>
    </>
  );
}
