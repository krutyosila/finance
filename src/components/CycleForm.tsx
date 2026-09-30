import { useState } from 'react';
import type { Cycle } from '../../shared/types';
import { api } from '../api';
import { date, localDateTime, transactionTimestamp } from '../format';
import { ErrorMessage, Field, FormFooter } from './ui';

export function CycleForm({
  cycle,
  onClose,
  onSaved,
}: {
  cycle?: Cycle;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [originalInstant] = useState(() => new Date().toISOString());
  const [name, setName] = useState('');
  const [timestamp, setTimestamp] = useState(() => localDateTime(originalInstant));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const instant = transactionTimestamp(timestamp, originalInstant);
      await api(
        cycle ? `/cycles/${cycle.id}/end` : '/cycles',
        'POST',
        cycle ? { end: instant } : { name: name.trim() || undefined, start: instant },
      );
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
        {!cycle && (
          <Field label="Dönem adı (isteğe bağlı)" wide>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Bu döneme bir ad verin"
              maxLength={200}
              autoFocus
            />
          </Field>
        )}
        <Field label={cycle ? 'Bitiş tarihi ve saati' : 'Başlangıç tarihi ve saati'} wide>
          <input
            type="datetime-local"
            value={timestamp}
            onChange={(event) => setTimestamp(event.target.value)}
            required
          />
        </Field>
      </div>
      <p className="form-note">
        {cycle
          ? `${cycle.name}, ${date(cycle.start)} tarihinde başladı. Dönemi bitirmek kayıtlarınızı korur ve dönemin kapanış durumunu gösterir.`
          : 'Kendi finansal ritminizi izleyin. Dönemin ne zaman başlayıp biteceğini siz seçin.'}
      </p>
      <FormFooter onClose={onClose} busy={busy} label={cycle ? 'Dönemi bitir' : 'Dönemi başlat'} />
    </form>
  );
}
