import { ArrowDown, LoaderCircle } from 'lucide-react';

export function PullRefresh({
  distance,
  ready,
  refreshing,
}: {
  distance: number;
  ready: boolean;
  refreshing: boolean;
}) {
  if (!distance && !refreshing) return null;
  return (
    <div
      className="pull-refresh"
      data-state={refreshing ? 'refreshing' : ready ? 'ready' : 'pulling'}
      role="status"
      aria-live="polite"
      style={{ transform: `translate(-50%, ${refreshing ? 16 : distance * 0.4}px)` }}
    >
      {refreshing ? (
        <LoaderCircle size={19} aria-hidden="true" />
      ) : (
        <ArrowDown size={19} aria-hidden="true" />
      )}
      <span>
        {refreshing
          ? 'Güncelleniyor…'
          : ready
            ? 'Yenilemek için bırakın'
            : 'Yenilemek için aşağı çekin'}
      </span>
    </div>
  );
}
