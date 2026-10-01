import type { CatalogLabel } from '../../shared/types';

export function LabelSelect({
  labels = [],
  value,
  onChange,
  disabled = false,
  preserveArchived = false,
  ariaLabel,
}: {
  labels?: CatalogLabel[];
  value?: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  preserveArchived?: boolean;
  ariaLabel?: string;
}) {
  const selected = labels.find((label) => label.id === value);
  return (
    <select
      value={value || ''}
      onChange={(event) => onChange(event.target.value || null)}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      <option value="">Etiket yok</option>
      {value && (!selected || selected.archived) && (
        <option value={value} disabled={!selected || !preserveArchived}>
          {selected ? `${selected.name} (arşivlenmiş)` : 'Etiket bulunamadı; yeniden seçin'}
        </option>
      )}
      {labels
        .filter((label) => !label.archived)
        .map((label) => (
          <option key={label.id} value={label.id}>
            {label.name}
          </option>
        ))}
    </select>
  );
}
