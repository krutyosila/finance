import { useState } from 'react';
import { ArrowRight, CornerDownLeft, LoaderCircle, Sparkles } from 'lucide-react';
import type { EntryResult, ParseResult } from '../../shared/types';
import { api } from '../api';
import { Button, ErrorMessage } from './ui';
import { useAuth } from '../auth';
import { usePwa } from '../pwa';

export function QuickEntry({
  onReview,
  onSaved,
  getRequestId,
  onSettings,
  compact = false,
}: {
  onReview: (result: ParseResult) => void;
  onSaved: () => void;
  getRequestId: (text: string) => string;
  onSettings: () => void;
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
      const note = text.trim();
      const result = await api<EntryResult>('/ai/transaction', 'POST', {
        text: note,
        requestId: getRequestId(note),
      });
      if (result.saved && result.transaction) onSaved();
      else if (!result.saved && result.confirmation) onReview(result.confirmation);
      else throw new Error('İşlemin sonucu doğrulanamadı. Aynı notla yeniden deneyin.');
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
            disabled={busy}
          />
          <Button
            disabled={!text.trim() || busy || !online}
            type="submit"
            aria-label="Yapay zekâ ile işlemi ekle"
          >
            {busy ? <LoaderCircle size={19} className="spin" /> : <ArrowRight size={20} />}
            <span>{busy ? 'Yorumlanıyor…' : 'AI ile ekle'}</span>
          </Button>
        </div>
        <div className="quick-foot">
          <p>Açık işlemler kaydedilir; eksik ayrıntılar sizden istenir.</p>
          <span>
            <CornerDownLeft size={13} /> Enter ile ekle
          </span>
        </div>
      </form>
      {error && <ErrorMessage message={error} />}
      <div className="quick-ai-note">
        <p>Notunuz, hesap ve borç adlarınız OpenAI ile paylaşılır.</p>
        <button type="button" className="text-button" onClick={onSettings}>
          OpenAI ayarları
        </button>
      </div>
    </section>
  );
}
