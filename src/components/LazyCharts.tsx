import { lazy, Suspense, type ComponentProps } from 'react';
import type { CategoryChart as CategoryChartType, TrendChart as TrendChartType } from './Charts';
import { Loading, Panel } from './ui';

const DeferredTrendChart = lazy(() =>
  import('./Charts').then((module) => ({ default: module.TrendChart })),
);
const DeferredCategoryChart = lazy(() =>
  import('./Charts').then((module) => ({ default: module.CategoryChart })),
);

export function TrendChart(props: ComponentProps<typeof TrendChartType>) {
  return (
    <Suspense
      fallback={
        <Panel className="trend-panel">
          <Loading text="Grafik hazırlanıyor…" />
        </Panel>
      }
    >
      <DeferredTrendChart {...props} />
    </Suspense>
  );
}

export function CategoryChart(props: ComponentProps<typeof CategoryChartType>) {
  return (
    <Suspense
      fallback={
        <Panel className="category-panel">
          <Loading text="Grafik hazırlanıyor…" />
        </Panel>
      }
    >
      <DeferredCategoryChart {...props} />
    </Suspense>
  );
}
