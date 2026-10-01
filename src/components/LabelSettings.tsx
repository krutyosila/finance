import { useCallback, useState } from 'react';
import { Archive, Check, LoaderCircle, Pencil, Plus, Tag } from 'lucide-react';
import type { CatalogLabel, LabelInput } from '../../shared/types';
import { api, useResource } from '../api';
import { usePwa } from '../pwa';
import { Button, ErrorMessage, Field, Loading, Modal } from './ui';
import { LabelScan } from './LabelScan';

export function LabelSettings({ onChanged }: { onChanged?: () => void }) {
  const resource = useResource<CatalogLabel[]>('/labels');
  const { online } = usePwa();
  const [editing, setEditing] = useState<CatalogLabel | null | undefined>();
  const [archiving, setArchiving] = useState<CatalogLabel | null>(null);
  const [notice, setNotice] = useState('');
  const closeEditor = useCallback(() => setEditing(undefined), []);
  const closeArchive = useCallback(() => setArchiving(null), []);
  const labels = resource.data?.filter((label) => !label.archived) || [];
  const changed = (message: string) => {
    resource.refresh();
    onChanged?.();
    setNotice(message);
  };
  return (
    <section className="label-settings" aria-labelledby="label-settings-title">
      <div className="label-settings-heading">
        <div className="settings-section-head">
          <span className="settings-symbol" aria-hidden="true">
            <Tag size={23} />
          </span>
          <div>
            <h2 id="label-settings-title">Etiketler</h2>
            <p>İşlemlerinizi kendi adlarınızla düzenleyin.</p>
          </div>
        </div>
        <Button
          id="label-create-trigger"
          type="button"
          variant="secondary"
          disabled={!online}
          onClick={() => setEditing(null)}
        >
          <Plus size={16} aria-hidden="true" /> Etiket ekle
        </Button>
      </div>
      <p className="settings-hint">
        Kategoriden ayrı olarak her işleme tek etiket seçebilirsiniz. Kısa açıklama, yapay zekânın
        hızlı kayıtta uygun etiketi önermesine yardımcı olur.
      </p>
      <p className="settings-hint">
        Etkin etiket adları ve açıklamaları, notunuzu yorumlamak için OpenAI’ye gönderilir. Önerilen
        etiketi kaydetmeden önce değiştirebilirsiniz.
      </p>
      {notice && (
        <p className="label-settings-notice" role="status">
          {notice}
        </p>
      )}
      {resource.error ? (
        <ErrorMessage message={resource.error} retry={resource.refresh} />
      ) : resource.loading && !resource.data ? (
        <Loading text="Etiketler yükleniyor…" />
      ) : !labels.length ? (
        <p className="label-settings-empty">Henüz etiket yok. Etiket ekleyerek başlayın.</p>
      ) : (
        <ul className="label-settings-list" aria-label="Etkin etiketler">
          {labels.map((label) => (
            <li className="label-settings-row" key={label.id}>
              <div className="label-settings-copy">
                <strong>{label.name}</strong>
                <p>{label.description || 'Açıklama eklenmedi.'}</p>
              </div>
              <div className="label-settings-actions">
                <Button
                  id={`label-edit-${label.id}`}
                  type="button"
                  variant="secondary"
                  disabled={!online}
                  aria-label={`${label.name} etiketini düzenle`}
                  onClick={() => setEditing(label)}
                >
                  <Pencil size={15} aria-hidden="true" /> Düzenle
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!online}
                  aria-label={`${label.name} etiketini arşivle`}
                  onClick={() => setArchiving(label)}
                >
                  <Archive size={16} aria-hidden="true" /> Arşivle
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {resource.data && !resource.error && (
        <LabelScan
          labels={resource.data}
          onApplied={(updated) => changed(`${updated} işlemin etiketi güncellendi.`)}
        />
      )}
      {editing !== undefined && (
        <Modal title={editing ? 'Etiketi düzenle' : 'Etiket ekle'} onClose={closeEditor}>
          <LabelForm
            label={editing}
            onClose={closeEditor}
            onSaved={() => {
              changed(editing ? 'Etiket güncellendi.' : 'Etiket eklendi.');
              closeEditor();
            }}
          />
        </Modal>
      )}
      {archiving && (
        <Modal
          title={`${archiving.name} arşivlensin mi?`}
          subtitle="Bu etiket yeni işlemlerde seçilemeyecek. Eski işlemlerdeki etiket bağlantıları korunacak."
          onClose={closeArchive}
        >
          <ArchiveLabel
            label={archiving}
            onClose={closeArchive}
            onSaved={() => {
              changed('Etiket arşivlendi. Eski işlemlerde görünmeye devam eder.');
              closeArchive();
              requestAnimationFrame(() =>
                document.getElementById('label-create-trigger')?.focus({ preventScroll: true }),
              );
            }}
          />
        </Modal>
      )}
    </section>
  );
}

function LabelForm({
  label,
  onClose,
  onSaved,
}: {
  label: CatalogLabel | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { online } = usePwa();
  const [name, setName] = useState(label?.name || '');
  const [description, setDescription] = useState(label?.description || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !online) return;
    if (!name.trim()) {
      setError('Etikete bir ad verin.');
      return;
    }
    setBusy(true);
    setError('');
    const input: LabelInput = { name: name.trim(), description: description.trim() || null };
    try {
      await api(label ? `/labels/${label.id}` : '/labels', label ? 'PATCH' : 'POST', input);
      onSaved();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="record-form" onSubmit={save}>
      {error && <ErrorMessage message={error} />}
      <div className="form-grid">
        <Field label="Etiket adı" wide>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            required
            autoFocus
            disabled={busy}
            placeholder="Örn. İş gideri"
          />
        </Field>
        <Field
          label="Kısa açıklama (isteğe bağlı)"
          wide
          hint="Hangi işlemlerde kullanılacağını yazın. En fazla 500 karakter."
        >
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            maxLength={500}
            disabled={busy}
            placeholder="Örn. İş için yaptığım ulaşım ve malzeme harcamaları."
          />
        </Field>
      </div>
      <div className="form-footer">
        <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
          Vazgeç
        </Button>
        <Button type="submit" disabled={busy || !online || !name.trim()}>
          {busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}
          {busy ? 'Kaydediliyor…' : label ? 'Değişiklikleri kaydet' : 'Etiketi ekle'}
        </Button>
      </div>
    </form>
  );
}

function ArchiveLabel({
  label,
  onClose,
  onSaved,
}: {
  label: CatalogLabel;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { online } = usePwa();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function archive() {
    if (busy || !online) return;
    setBusy(true);
    setError('');
    try {
      await api(`/labels/${label.id}`, 'DELETE');
      onSaved();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="confirm-body">{error && <ErrorMessage message={error} />}</div>
      <div className="form-footer">
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Vazgeç
        </Button>
        <Button disabled={busy || !online} onClick={() => void archive()}>
          {busy ? <LoaderCircle size={16} className="spin" /> : <Archive size={16} />}
          {busy ? 'Arşivleniyor…' : 'Arşivle'}
        </Button>
      </div>
    </>
  );
}
