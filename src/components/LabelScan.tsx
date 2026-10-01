import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, LoaderCircle, Sparkles } from 'lucide-react';
import type { CatalogLabel, LabelScanSuggestion, Transaction } from '../../shared/types';
import { api } from '../api';
import { usePwa } from '../pwa';
import { LabelSelect } from './LabelSelect';
import { labelScanBatches, scanLabelsAvailable } from './labelScanBatch';
import { Button, ErrorMessage, Field, Modal } from './ui';

export function LabelScan({
  labels,
  onApplied,
}: {
  labels: CatalogLabel[];
  onApplied: (updated: number) => void;
}) {
  const { online } = usePwa();
  const generation = useRef(0);
  const running = useRef(false);
  const applying = useRef(false);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<'scan' | 'review' | 'error' | 'apply'>('scan');
  const [progress, setProgress] = useState({ processed: 0, total: 0 });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [suggestions, setSuggestions] = useState<LabelScanSuggestion[]>([]);
  const [reviewLabels, setReviewLabels] = useState<CatalogLabel[]>([]);
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const hasLabels = labels.some((label) => !label.archived);
  const close = useCallback(() => {
    if (applying.current) return;
    generation.current++;
    running.current = false;
    setOpen(false);
  }, []);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  async function scan() {
    if (!online || !hasLabels || running.current || applying.current) return;
    const token = ++generation.current;
    const current = () => token === generation.current;
    running.current = true;
    setOpen(true);
    setPhase('scan');
    setProgress({ processed: 0, total: 0 });
    setSuggestions([]);
    setPage(0);
    setError('');
    try {
      const records = await api<Transaction[]>('/transactions');
      if (!current()) return;
      if (records.length > 5000)
        throw new Error(
          'Bir taramada en fazla 5.000 işlem değerlendirilebilir. Hiçbir işlem taranmadı veya değiştirilmedi.',
        );
      setTransactions(records);
      setProgress({ processed: 0, total: records.length });
      const batches = labelScanBatches(records);
      const proposed: LabelScanSuggestion[] = [];
      let processed = 0;
      for (const batch of batches) {
        const result = await api<{ suggestions: LabelScanSuggestion[] }>(
          '/ai/labels/scan',
          'POST',
          { transactions: batch },
        );
        if (!current()) return;
        if (result.suggestions.length !== batch.length)
          throw new Error('Tarama tamamlanamadı. Hiçbir işlem değiştirilmedi; yeniden deneyin.');
        proposed.push(...result.suggestions);
        processed += batch.length;
        setProgress({ processed, total: records.length });
      }
      const catalog = await api<CatalogLabel[]>('/labels');
      if (!current()) return;
      if (!scanLabelsAvailable(proposed, catalog))
        throw new Error(
          'Etiketler tarama sırasında değişti. Güncel etiketlerle yeniden tarayın. Hiçbir değişiklik uygulanmadı.',
        );
      setReviewLabels(catalog);
      setSuggestions(
        proposed.filter((suggestion) => suggestion.labelId !== suggestion.previousLabelId),
      );
      setPhase('review');
    } catch (reason) {
      if (!current()) return;
      setSuggestions([]);
      setError((reason as Error).message);
      setPhase('error');
    } finally {
      if (current()) running.current = false;
    }
  }
  const changes = suggestions.filter(
    (suggestion) => suggestion.labelId !== suggestion.previousLabelId,
  );
  const cleared = changes.filter((suggestion) => suggestion.labelId === null).length;
  const pageStart = page * 50;
  const displayedSuggestions = suggestions.slice(pageStart, pageStart + 50);
  const labelsAvailable = scanLabelsAvailable(changes, reviewLabels);
  const transactionById = useMemo(
    () => new Map(transactions.map((record) => [record.id, record])),
    [transactions],
  );
  const labelName = (id: string | null) => {
    if (!id) return 'Etiketsiz';
    const label = reviewLabels.find((label) => label.id === id);
    return label ? `${label.name}${label.archived ? ' (arşivlenmiş)' : ''}` : 'Etiket bulunamadı';
  };
  async function apply() {
    if (!online || !changes.length || !labelsAvailable || applying.current || phase !== 'review')
      return;
    applying.current = true;
    setPhase('apply');
    setError('');
    try {
      const result = await api<{ updated: number }>('/ai/labels/apply', 'POST', {
        suggestions: changes,
      });
      applying.current = false;
      onApplied(result.updated);
      close();
    } catch (reason) {
      setError((reason as Error).message);
      setSuggestions([]);
      setPhase('error');
    } finally {
      applying.current = false;
    }
  }
  return (
    <>
      <div className="label-scan-start">
        <div>
          <h3>Mevcut işlemleri etiketle</h3>
          <p>
            Etiketli ve etiketsiz tüm işlemler yeniden değerlendirilir. Önce önerileri görür, sonra
            uygularsınız.
          </p>
          <p>
            İşlem açıklamaları, önceki sınıflandırmalar, karşı taraflar ve notlarla etkin etiket
            tanımları OpenAI’ye gönderilir.
          </p>
          {!hasLabels && <p>Tarama için önce bir etiket ekleyin.</p>}
        </div>
        <Button type="button" disabled={!online || !hasLabels || open} onClick={() => void scan()}>
          <Sparkles size={16} aria-hidden="true" /> Tümünü tara
        </Button>
      </div>
      {open && (
        <Modal
          title={phase === 'scan' ? 'İşlemler taranıyor' : 'Etiket önerilerini gözden geçirin'}
          subtitle={
            phase === 'apply'
              ? 'Onayladığınız etiket değişiklikleri uygulanıyor; tutarlar ve hesaplar korunur.'
              : 'Tarama yalnızca öneri hazırlar. Etiketler siz uyguladığınızda güncellenir; tutarlar ve hesaplar korunur.'
          }
          onClose={close}
          wide
        >
          <div className="label-scan-review" aria-busy={phase === 'scan' || phase === 'apply'}>
            {error && <ErrorMessage message={error} />}
            {phase === 'scan' ? (
              <div className="label-scan-progress" role="status">
                <LoaderCircle size={22} className="spin" aria-hidden="true" />
                <p>
                  {progress.total
                    ? `${progress.processed} / ${progress.total} işlem tarandı`
                    : 'İşlemler hazırlanıyor…'}
                </p>
                <progress
                  value={progress.processed}
                  max={Math.max(progress.total, 1)}
                  aria-label="Taranan işlemler"
                />
                <p>Öneriler hazırlanıyor. Vazgeçerseniz hiçbir kayıt değişmez.</p>
              </div>
            ) : (
              phase !== 'error' && (
                <>
                  <div className="label-scan-summary" role="status">
                    <strong>{changes.length} işlemin etiketi değişecek.</strong>
                    <p>{progress.total - changes.length} işlem mevcut etiketiyle kalacak.</p>
                    {cleared > 0 && <p>{cleared} işlemin etiketi kaldırılacak (Etiketsiz).</p>}
                  </div>
                  {!suggestions.length ? (
                    <p className="label-settings-empty">
                      {progress.total
                        ? 'Önerilen etiketlerde değişiklik yok.'
                        : 'Taranacak işlem bulunamadı.'}
                    </p>
                  ) : (
                    <>
                      {suggestions.length > 50 && (
                        <div
                          className="label-scan-pagination"
                          role="group"
                          aria-label="Etiket önerileri sayfaları"
                        >
                          <span aria-live="polite">
                            {pageStart + 1}–{Math.min(pageStart + 50, suggestions.length)} /{' '}
                            {suggestions.length} öneri
                          </span>
                          <div>
                            <Button
                              variant="secondary"
                              aria-label="Önceki öneriler"
                              disabled={page === 0 || phase === 'apply'}
                              onClick={() => setPage((previous) => previous - 1)}
                            >
                              Önceki
                            </Button>
                            <Button
                              variant="secondary"
                              aria-label="Sonraki öneriler"
                              disabled={pageStart + 50 >= suggestions.length || phase === 'apply'}
                              onClick={() => setPage((previous) => previous + 1)}
                            >
                              Sonraki
                            </Button>
                          </div>
                        </div>
                      )}
                      <ol className="label-scan-list" aria-label="Etiket değişiklikleri">
                        {displayedSuggestions.map((suggestion, index) => {
                          const globalIndex = pageStart + index;
                          const transaction = transactionById.get(suggestion.transactionId);
                          return (
                            <li key={suggestion.transactionId}>
                              <h3>{transaction?.description || 'İşlem'}</h3>
                              <div className="label-scan-change">
                                <div>
                                  <span>Eski etiket</span>
                                  <strong>{labelName(suggestion.previousLabelId)}</strong>
                                </div>
                                <ArrowRight size={18} aria-hidden="true" />
                                <Field label="Yeni etiket">
                                  <LabelSelect
                                    labels={reviewLabels}
                                    value={suggestion.labelId}
                                    disabled={phase === 'apply'}
                                    ariaLabel={`${globalIndex + 1}. işlemin yeni etiketi`}
                                    onChange={(labelId) =>
                                      setSuggestions((previous) =>
                                        previous.map((item, position) =>
                                          position === globalIndex ? { ...item, labelId } : item,
                                        ),
                                      )
                                    }
                                  />
                                </Field>
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    </>
                  )}
                </>
              )
            )}
          </div>
          <div className="form-footer">
            <Button variant="secondary" disabled={phase === 'apply'} onClick={close}>
              {phase === 'scan' ? 'Vazgeç' : 'Kapat'}
            </Button>
            {phase === 'error' && (
              <Button disabled={!online} onClick={() => void scan()}>
                Yeniden tara
              </Button>
            )}
            {(phase === 'review' || phase === 'apply') && (
              <Button
                disabled={!online || !changes.length || !labelsAvailable || phase === 'apply'}
                onClick={() => void apply()}
              >
                {phase === 'apply' ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Check size={16} />
                )}
                {phase === 'apply' ? 'Uygulanıyor…' : 'Tüm değişiklikleri uygula'}
              </Button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
