import type { Debt, ParseResult, TransactionInput, Currency } from '../../shared/types';
import { minor, decimal } from './money';
const normalize = (text: string) =>
  text
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c');
function parseAmount(raw: string) {
  let s = raw.replace(/\s/g, '');
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) {
    if (/^\d{1,3}(?:,\d{3})+$/.test(s)) s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  return decimal(minor(s, true));
}
export function parseEntry(text: string, debts: Debt[]): ParseResult {
  const draft: Partial<TransactionInput> = { description: text?.trim() || '' },
    issues: string[] = [];
  if (typeof text !== 'string' || !text.trim())
    return { text: text ?? '', draft, certain: false, issues: ['Ne olduğunu yazın'] };
  const n = normalize(text);
  const numbers = text.match(/-?\d+(?:[.,]\d+)*/g) ?? [];
  if (numbers.length !== 1)
    issues.push(
      numbers.length ? 'Birden fazla tutar var; kaydedilecek tutarı seçin' : 'Bir tutar girin',
    );
  else
    try {
      draft.amount = parseAmount(numbers[0]);
      if (minor(draft.amount, true) <= 0) issues.push('Pozitif bir tutar girin');
    } catch {
      issues.push('Tutarın yazımını kontrol edin');
    }
  // A currency can touch its amount: 24USD and 24dolar must never default to TRY.
  const aliases: Record<string, string> = {
    try: 'try',
    tl: 'try',
    lira: 'try',
    lirasi: 'try',
    usd: 'usd',
    dolar: 'usd',
    dolari: 'usd',
    dollar: 'usd',
    dollars: 'usd',
    eur: 'eur',
    euro: 'eur',
    euros: 'eur',
    avro: 'eur',
    usdt: 'usdt',
    tether: 'usdt',
    gbp: 'gbp',
    sterlin: 'gbp',
    pound: 'gbp',
    pounds: 'gbp',
    btc: 'btc',
    bitcoin: 'btc',
    chf: 'chf',
    cad: 'cad',
    aud: 'aud',
    jpy: 'jpy',
    eth: 'eth',
    ethereum: 'eth',
    usdc: 'usdc',
    doge: 'doge',
  };
  // Recognize common Turkish case/amount suffixes without treating a foreign amount as TRY.
  for (const [root, currency, suffixes] of [
    [
      'dolar',
      'usd',
      ['lik', 'li', 'la', 'dan', 'a', 'i', 'in', 'im', 'ini', 'ina', 'inin', 'iyla'],
    ],
    ['euro', 'eur', ['luk', 'lu', 'yla', 'dan', 'ya', 'yu', 'nun', 'su']],
    ['avro', 'eur', ['luk', 'lu', 'yla', 'dan', 'ya', 'yu', 'nun', 'su']],
    ['lira', 'try', ['lik', 'li', 'yla', 'dan', 'ya', 'yi', 'nin', 'si']],
    ['sterlin', 'gbp', ['lik', 'le', 'den', 'e', 'i', 'in']],
  ] as const) {
    for (const suffix of suffixes) aliases[`${root}${suffix}`] = currency;
  }
  const currencyPattern = new RegExp(
    `(?<![a-z])(?:${Object.keys(aliases)
      .sort((a, b) => b.length - a.length)
      .join('|')})(?![a-z])`,
    'g',
  );
  const currencies = (n.match(currencyPattern) ?? []).map((word) => aliases[word]);
  if (text.includes('$')) currencies.push('usd');
  if (text.includes('€')) currencies.push('eur');
  if (text.includes('₺')) currencies.push('try');
  // Unknown short codes need review regardless of their letter case.
  // Ordinary Turkish finance words are not codes.
  const ordinaryWords = new Set([
    'kmh',
    'kira',
    'kart',
    'borc',
    'gelir',
    'geldi',
    'yatti',
    'maas',
    'iade',
    'odeme',
    'odedim',
    'yemek',
    'nakit',
    'bim',
    'alan',
    'adi',
    'kredi',
    'hesap',
    'banka',
    'faiz',
    'fee',
    'bir',
    'ile',
    'net',
    'son',
    'ilk',
    'her',
    'tek',
    'ay',
    'gun',
    'yil',
    'dun',
    'bugun',
    'yeni',
    'eski',
    'icin',
    'aldim',
    'aldi',
    'odedi',
    'gitti',
    'iptal',
    'pesin',
    'aylik',
  ]);
  const unknownCodes = [
    ...new Set(
      [...text.matchAll(/(?<!\p{L})([a-zçğıöşü]{3,5})(?!\p{L})/giu)]
        .map((match) => normalize(match[1]))
        .filter((word) => !aliases[word] && !ordinaryWords.has(word)),
    ),
  ];
  if (unknownCodes.length)
    issues.push(
      `Para birimi olabilecek ${unknownCodes.map((code) => code.toUpperCase()).join(', ')} ifadesini doğrulayın`,
    );
  const unique = [...new Set(currencies)];
  if (unique.length > 1) issues.push('Bir para birimi seçin');
  const c = unique[0] ?? 'try';
  if (!['try', 'usd', 'eur', 'usdt'].includes(c)) issues.push('Bu para birimi desteklenmiyor');
  else if (!unknownCodes.length) draft.currency = c.toUpperCase() as Currency;
  const income = /\b(geldi|yatti|kazandim|tahsilat|maas|gelir)\b/.test(n),
    payment = /\b(odedim|odendi|odeme yaptim|kapattim)\b/.test(n),
    usage = /\b(kullandim|cektim|borc aldim)\b/.test(n),
    isDebt = /\b(kmh|borc|kredi|kart[i]?|overdraft)\b/.test(n),
    refund = /\b(iade|refund|geri odeme)\b/.test(n);
  if (isDebt && (payment || usage)) {
    draft.type = payment ? 'DEBT_PAYMENT' : 'DEBT_USAGE';
    draft.category = payment ? 'Borç ödemesi' : 'Borç kullanımı';
    if (payment && usage) issues.push('Borç kullanımı ve ödeme ifadeleri çelişiyor');
    let matches = debts.filter((d) => d.currency === draft.currency);
    if (/\b(kmh|overdraft)\b/.test(n)) matches = matches.filter((d) => d.type === 'OVERDRAFT');
    else if (/\b(kart[i]?)\b/.test(n)) matches = matches.filter((d) => d.type === 'CREDIT_CARD');
    const named = matches.filter((d) => n.includes(normalize(d.name)));
    if (named.length) matches = named;
    if (matches.length === 1) draft.debtId = matches[0].id;
    else
      issues.push(
        matches.length
          ? 'Bu işlemin hangi borca ait olduğunu seçin'
          : 'Kaydetmeden önce borcu oluşturun veya seçin',
      );
  } else if (refund) {
    draft.type = 'REFUND';
    draft.category = 'Diğer';
  } else if (income) {
    draft.type = 'INCOME';
    draft.category = 'Gelir';
    if (payment || usage) issues.push('Gelir ve ödeme ifadeleri çelişiyor');
  } else if (/\b(transfer|havale|aktardim|virman)\b/.test(n)) {
    draft.type = 'TRANSFER';
    draft.category = 'Transfer';
    issues.push('Kaynak ve hedef hesapları seçin');
  } else if (/\b(birikim|biriktirdim|tasarruf|kenara ayirdim)\b/.test(n)) {
    draft.type = 'SAVINGS';
    draft.category = 'Birikim';
  } else {
    const categories: [RegExp, string][] = [
      [/\b(market|bakkal|manav|migros|a101|bim)\b/, 'Market'],
      [/\b(kira)\b/, 'Kira'],
      [/\b(yemek|restoran|kahve|yemeksepeti)\b/, 'Yemek'],
      [/\b(domain|alan adi)\b/, 'Alan adı'],
      [/\b(server|sunucu|hosting)\b/, 'Sunucu ve barındırma'],
      [/\b(elektrik|su faturasi|dogalgaz|fatura|internet|telefon)\b/, 'Faturalar'],
      [/\b(benzin|yakit|taksi|otobus|ulasim)\b/, 'Ulaşım'],
      [/\b(abonelik|subscription|netflix|spotify)\b/, 'Abonelikler'],
    ];
    const found = categories.filter(([pattern]) => pattern.test(n));
    if (found.length === 1) {
      draft.type = 'EXPENSE';
      draft.category = found[0][1];
    } else if (found.length > 1) issues.push('Birden fazla harcama kategorisi var; birini seçin');
    else issues.push('İşlem türünü ve kategorisini seçin');
  }
  if (isDebt && !draft.debtId && !issues.some((i) => i.toLocaleLowerCase('tr').includes('borç')))
    issues.push('İşlemin hangi borca ait olduğunu belirtin');
  return {
    text,
    draft,
    certain: issues.length === 0 && !!draft.type && !!draft.amount && !!draft.currency,
    issues,
  };
}
