import { useRef, useState } from 'react';
import { ArrowRight, LoaderCircle, Sparkles } from 'lucide-react';
import type { AiPlan } from '../../shared/types';
import { api } from '../api';
import { Button, ErrorMessage } from './ui';
import { useAuth } from '../auth';
import { usePwa } from '../pwa';

export function QuickEntry({
  onReview,
  onSettings,
  compact = false,
}: {
  onReview: (result: AiPlan) => void;
  onSettings: () => void;
  compact?: boolean;
}) {
  const { session } = useAuth();
  const { online } = usePwa();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  async function review(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim() || inFlight.current || !online) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const note = text.trim();
      const result = await api<AiPlan>('/ai/entry', 'POST', { text: note });
      onReview(result);
      setText('');
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <section className={`quick-entry ${compact ? 'quick-entry-compact' : ''}`}>
      <div className="quick-heading">
        <span className="eyebrow">
          <Sparkles size={14} /> Küçük bir not. Daha net bir görünüm.
        </span>
        <span className="private-badge">
          {session.required ? 'Güvenli alanınızda' : 'Bilgisayarınızda'}
        </span>
      </div>
      <form onSubmit={review}>
        <label className="quick-label" htmlFor={compact ? 'quick-text-modal' : 'quick-text'}>
          Ne oldu?
        </label>
        <div className="quick-input-row">
          <textarea
            rows={3}
            id={compact ? 'quick-text-modal' : 'quick-text'}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Paribu'ya 2500 USD geldi; 100000 TL'ye çevirdim; 90000 TL'yi VakıfBank'a aktardım."
            autoComplete="off"
            autoFocus={compact}
            maxLength={12000}
            disabled={busy}
          />
          <Button
            disabled={!text.trim() || busy || !online}
            type="submit"
            aria-label="Yapay zekâ ile kayıtları önizle"
          >
            {busy ? <LoaderCircle size={19} className="spin" /> : <ArrowRight size={20} />}
            <span>{busy ? 'Yorumlanıyor…' : 'Önizle'}</span>
          </Button>
        </div>
        <div className="quick-foot">
          <p>
            Eksik hesaplar önerilir; dönüşüm tutarı eksikse sorulur. Önce kontrol edin, sonra
            onaylayın.
          </p>
          <span>{text.length.toLocaleString('tr-TR')} / 12.000 karakter</span>
        </div>
      </form>
      {error && <ErrorMessage message={error} />}
      <div className="quick-ai-note">
        <p>Notunuz; hesap, borç, abonelik ve düzenli ödeme adlarınız OpenAI ile paylaşılır.</p>
        <button type="button" className="text-button" onClick={onSettings}>
          OpenAI ayarları
        </button>
      </div>
    </section>
  );
}
