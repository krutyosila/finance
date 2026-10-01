import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, Check, LoaderCircle, X } from 'lucide-react';
import type { MoneyTotals } from '../../shared/types';
import { money } from '../format';

export function Button({
  children,
  variant = 'primary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  return (
    <button className={`button button-${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}
export function IconButton({
  children,
  label,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}
export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{children}</section>;
}
export function SectionHead({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-head">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function PageIntro({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-intro">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function Empty({
  icon,
  title,
  detail,
  action,
  compact = false,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty ${compact ? 'empty-compact' : ''}`}>
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}
export function Money({
  totals,
  empty = '—',
  className = '',
}: {
  totals: MoneyTotals;
  empty?: string;
  className?: string;
}) {
  const entries = Object.entries(totals);
  return (
    <div className={`money-values ${className}`}>
      {entries.length ? (
        entries.map(([currency, amount]) => (
          <span key={currency}>{money(amount, currency as keyof MoneyTotals)}</span>
        ))
      ) : (
        <span>{empty}</span>
      )}
    </div>
  );
}
export function Loading({ text = 'Finansal alanınız yükleniyor…' }: { text?: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle size={20} className="spin" />
      {text}
    </div>
  );
}
export function ErrorMessage({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="error-message" role="alert">
      <p>{message}</p>
      {retry && (
        <Button variant="secondary" onClick={retry}>
          Yeniden dene
        </Button>
      )}
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  wide?: boolean;
}) {
  return (
    <label className={`field ${wide ? 'field-wide' : ''}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Tag({ children, tone = '' }: { children: ReactNode; tone?: string }) {
  return <span className={`tag ${tone ? `tag-${tone}` : ''}`}>{children}</span>;
}

export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousId = previous?.id;
    const dialog = ref.current!;
    const close = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener('cancel', close);
    document.body.classList.add('dialog-open');
    const viewport = window.visualViewport;
    const resize = () => {
      if (!viewport || viewport.scale !== 1) return;
      dialog.style.setProperty('--dialog-viewport-height', `${viewport.height}px`);
      dialog.style.setProperty('--dialog-viewport-top', `${viewport.offsetTop}px`);
    };
    resize();
    dialog.showModal();
    dialog.scrollTop = 0;
    const body = dialog.querySelector<HTMLElement>('.modal-body');
    if (body) body.scrollTop = 0;
    viewport?.addEventListener('resize', resize);
    viewport?.addEventListener('scroll', resize);
    return () => {
      viewport?.removeEventListener('resize', resize);
      viewport?.removeEventListener('scroll', resize);
      dialog.removeEventListener('cancel', close);
      if (dialog.open) dialog.close();
      document.body.classList.remove('dialog-open');
      const restoreTarget = previous?.isConnected
        ? previous
        : previousId
          ? document.getElementById(previousId)
          : null;
      restoreTarget?.focus({ preventScroll: true });
    };
  }, [onClose]);
  return (
    <dialog
      className={`modal ${wide ? 'modal-wide' : ''}`}
      ref={ref}
      aria-labelledby={id}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-header">
        <div>
          <h2 id={id}>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <IconButton label="Pencereyi kapat" onClick={onClose}>
          <X size={20} />
        </IconButton>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
export function FormFooter({
  onClose,
  busy,
  label = 'Değişiklikleri kaydet',
}: {
  onClose: () => void;
  busy: boolean;
  label?: string;
}) {
  return (
    <div className="form-footer">
      <Button type="button" variant="secondary" onClick={onClose}>
        Vazgeç
      </Button>
      <Button type="submit" disabled={busy}>
        {busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}
        {busy ? 'Kaydediliyor…' : label}
      </Button>
    </div>
  );
}
export function LinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button className="text-button" onClick={onClick}>
      {children}
      <ArrowUpRight size={15} />
    </button>
  );
}

export function ConfirmDelete({
  name,
  detail,
  onDelete,
  onClose,
}: {
  name: string;
  detail: string;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal title={`${name} silinsin mi?`} subtitle={detail} onClose={onClose}>
      <div className="confirm-body">
        <p>Bu işlem geçmişinize kaydedilir.</p>
        {error && <ErrorMessage message={error} />}
      </div>
      <div className="form-footer">
        <Button variant="secondary" onClick={onClose}>
          Vazgeç
        </Button>
        <Button
          variant="danger"
          disabled={busy}
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            setError('');
            try {
              await onDelete();
              onClose();
            } catch (reason) {
              setError((reason as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Siliniyor…' : 'Sil'}
        </Button>
      </div>
    </Modal>
  );
}
