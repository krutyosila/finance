/** Two decimal minor units for every supported currency. No binary floating point arithmetic. */
export function minor(value: unknown, signed = false): number {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d{1,2})?$/.test(value.trim()))
    throw new Error('Tutarı en fazla iki ondalık basamakla yazın (ör. 1200.50)');
  const raw = value.trim();
  const neg = raw.startsWith('-');
  const [whole, fraction = ''] = raw.replace(/^-/, '').split('.');
  const n = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))) * (neg ? -1n : 1n);
  if (!signed && n < 0n) throw new Error('Tutar negatif olamaz');
  if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER))
    throw new Error('Tutar güvenli kayıt sınırını aşıyor');
  return Number(n);
}
export function decimal(value: number): string {
  if (!Number.isSafeInteger(value)) throw new Error('Toplam tutar güvenli biçimde hesaplanamadı');
  const b = BigInt(value);
  const n = b < 0n ? -b : b;
  return `${b < 0n ? '-' : ''}${n / 100n}.${String(n % 100n).padStart(2, '0')}`;
}
export function add(a: number, b: number): number {
  const n = BigInt(a) + BigInt(b);
  if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER))
    throw new Error('Toplam tutar güvenli hesaplama sınırını aşıyor');
  return Number(n);
}
export function converted(amount: number, rate: string): number {
  if (!/^\d+(?:\.\d{1,12})?$/.test(rate) || /^0(?:\.0+)?$/.test(rate))
    throw new Error('Döviz kurunu pozitif bir ondalık sayı olarak yazın');
  const [w, f = ''] = rate.split('.');
  const denominator = 10n ** BigInt(f.length);
  const numerator = BigInt(w) * denominator + BigInt(f || '0');
  const product = BigInt(amount) * numerator;
  const absolute = product < 0n ? -product : product;
  const rounded = ((absolute + denominator / 2n) / denominator) * (product < 0n ? -1n : 1n);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER) || rounded < BigInt(Number.MIN_SAFE_INTEGER))
    throw new Error('Çevrilen tutar güvenli hesaplama sınırını aşıyor');
  return Number(rounded);
}
