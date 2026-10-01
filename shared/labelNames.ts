import type { CatalogLabel } from './types';

export const labelDisplayName = (value: string): string => value.trim().replace(/\s+/g, ' ');
export const labelNameKey = (value: string): string =>
  labelDisplayName(value).normalize('NFKC').toLocaleLowerCase('tr');

export function findCatalogLabel<T extends Pick<CatalogLabel, 'name' | 'archived'>>(
  labels: readonly T[] | undefined,
  name: string | undefined,
  activeOnly = false,
): T | undefined {
  if (!name?.trim()) return undefined;
  const key = labelNameKey(name);
  const matching = labels?.filter((label) => labelNameKey(label.name) === key) ?? [];
  return matching.find((label) => !label.archived) ?? (activeOnly ? undefined : matching[0]);
}
