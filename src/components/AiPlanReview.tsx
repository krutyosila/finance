import { useRef, useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import type { AiPlan, AiPlanResult, FinancialContext } from '../../shared/types';
import { api } from '../api';
import { usePwa } from '../pwa';
import { Button, ErrorMessage, Field } from './ui';
import { appendPlanFollowUp, canConfirmPlan, describeAiItem } from './aiPlanPresentation';

export function AiPlanReview({
  initial,
  context,
  onSaved,
  onClose,
  onBusyChange,
}: {
  initial: AiPlan;
  context: FinancialContext;
  onSaved: () => void;
  onClose: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [plan, setPlan] = useState(initial);
  const [followUp, setFollowUp] = useState('');
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null);
  const [error, setError] = useState('');
  const requestId = useRef<string | null>(null);
  const inFlight = useRef(false);
  const { online } = usePwa();
  function replacePlan(next: AiPlan) {
    setPlan(next);
    requestId.current = null;
    setFollowUp('');
  }
  async function run(action: 'preview' | 'save') {
    if (
      inFlight.current ||
      !online ||
      (action === 'save' && (!canConfirmPlan(plan) || followUp.trim())) ||
      (action === 'preview' && !followUp.trim())
    )
      return;
    inFlight.current = true;
    setBusy(action);
    onBusyChange?.(true);
    setError('');
    try {
      if (action === 'preview') {
        const text = appendPlanFollowUp(plan, followUp);
        replacePlan(await api<AiPlan>('/ai/entry', 'POST', { text }));
      } else {
        requestId.current ||= crypto.randomUUID();
        const result = await api<AiPlanResult>('/ai/entry/confirm', 'POST', {
          plan,
          requestId: requestId.current,
        });
        if (result.saved) onSaved();
        else replacePlan(result.confirmation);
      }
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(null);
      onBusyChange?.(false);
    }
  }
  const complete = canConfirmPlan(plan);
  const remaining = Math.max(0, 12000 - plan.text.length - '\n\nEk bilgi: '.length);
  return (
    <div className="ai-plan-review" aria-busy={!!busy}>
      <p className="ai-preview-note">
        Henüz hiçbir kayıt eklenmedi. Aşağıdaki {plan.items.length} kaydı ve bağlantılarını kontrol
        edin.
      </p>
      {!complete && (
        <div className="notice" role="status">
          <div>
            <strong>Kaydetmeden önce ayrıntıları tamamlayın</strong>
            <ul>
              {plan.issues.map((issue, index) => (
                <li key={index}>{issue}</li>
              ))}
              {!plan.certain && !plan.issues.length && (
                <li>Notunuzu kesinleştirmek için ek bilgi gerekiyor.</li>
              )}
              {!plan.items.length && <li>Henüz oluşturulabilecek bir kayıt bulunamadı.</li>}
              {plan.items.length > 25 && (
                <li>Bir notta en fazla 25 kayıt olabilir. Notunuzu bölerek yeniden başlayın.</li>
              )}
              {plan.text.length > 12000 && <li>Not 12.000 karakteri aşamaz.</li>}
            </ul>
          </div>
        </div>
      )}
      {error && <ErrorMessage message={error} />}
      <ol className="ai-plan-items">
        {plan.items.map((item, index) => {
          const view = describeAiItem(item, plan, context);
          return (
            <li className="ai-plan-item" key={`${item.key}-${index}`}>
              <div className="ai-plan-item-heading">
                <span className="tag">{view.kind}</span>
                <h3>{view.title}</h3>
              </div>
              <dl>
                {view.fields.map(([label, value], index) => (
                  <div key={`${label}-${index}`}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              {view.note && <p className="form-note">{view.note}</p>}
            </li>
          );
        })}
      </ol>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run('preview');
        }}
        className="ai-follow-up"
      >
        <Field
          label={complete ? 'Düzeltme veya ek bilgi' : 'Eksik ayrıntıları yazın'}
          hint="İlk notunuz ve önceki ek bilgiler korunur. Yeni düzeltmeler sonraki önizlemede uygulanır."
        >
          <textarea
            rows={3}
            value={followUp}
            onChange={(event) => setFollowUp(event.target.value)}
            maxLength={remaining}
            disabled={!!busy || remaining === 0}
            placeholder="Örn. Kartın borcu 5.000 TL; kira her ayın 5’inde."
            aria-describedby="ai-follow-up-limit"
          />
        </Field>
        <div className="ai-follow-up-footer">
          <small id="ai-follow-up-limit">
            {followUp.length} / {remaining} karakter eklenebilir
          </small>
          <Button
            type="submit"
            variant="secondary"
            disabled={!!busy || !online || !followUp.trim()}
          >
            {busy === 'preview' ? <LoaderCircle size={16} className="spin" /> : null}
            {busy === 'preview' ? 'Yorumlanıyor…' : 'Önizlemeyi güncelle'}
          </Button>
        </div>
      </form>
      {followUp.trim() && (
        <p className="form-note" role="status">
          Düzeltmenizi uygulamak için önce önizlemeyi güncelleyin.
        </p>
      )}
      <div className="form-footer">
        <Button variant="secondary" disabled={!!busy} onClick={onClose}>
          Vazgeç
        </Button>
        <Button
          disabled={!complete || !!busy || !online || !!followUp.trim()}
          onClick={() => void run('save')}
        >
          {busy === 'save' ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{' '}
          {busy === 'save' ? 'Kaydediliyor…' : 'Tüm kayıtları onayla ve kaydet'}
        </Button>
      </div>
    </div>
  );
}
