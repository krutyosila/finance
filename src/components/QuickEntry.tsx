import { useState } from 'react';
import { ArrowRight, CornerDownLeft, LoaderCircle, Sparkles } from 'lucide-react';
import type { ParseResult } from '../../shared/types';
import { api } from '../api';
import { Button, ErrorMessage } from './ui';
import { useAuth } from '../auth';
import { usePwa } from '../pwa';

export function QuickEntry({
  onReview,
  compact = false,
}: {
  onReview: (result: ParseResult) => void;
  compact?: boolean;
}) {
  const { session } = useAuth();
  const { online } = usePwa();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function review(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      onReview(await api<ParseResult>('/parse', 'POST', { text: text.trim() }));
      setText('');
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
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
          <input
            id={compact ? 'quick-text-modal' : 'quick-text'}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="1200 market · 300 USD ödeme geldi"
            autoComplete="off"
            autoFocus={compact}
            maxLength={2000}
          />
          <Button
            disabled={!text.trim() || busy || !online}
            type="submit"
            aria-label="İşlemi gözden geçirin"
          >
            {busy ? <LoaderCircle size={19} className="spin" /> : <ArrowRight size={20} />}
            <span>Gözden geçir</span>
          </Button>
        </div>
        <div className="quick-foot">
          <p>Doğal bir dille yazın. Kaydetmeden önce ayrıntıları kontrol edin.</p>
          <span>
            <CornerDownLeft size={13} /> Enter ile gözden geçir
          </span>
        </div>
      </form>
      {error && <ErrorMessage message={error} />}
    </section>
  );
}
