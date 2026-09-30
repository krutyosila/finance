import { afterEach, beforeEach, expect, it } from 'vitest';
import { FinanceService } from '../server/core/service';

let service: FinanceService;
beforeEach(() => {
  service = new FinanceService(':memory:');
});
afterEach(() => {
  service.close();
});

it.each([
  ['24USD domain yenilendi', 'USD'],
  ['300USD ödeme geldi', 'USD'],
  ['24EUR domain yenilendi', 'EUR'],
  ['24USDT domain yenilendi', 'USDT'],
  ['24 dolar domain yenilendi', 'USD'],
  ['24dolar domain yenilendi', 'USD'],
  ['300 euro ödeme geldi', 'EUR'],
  ['300avro ödeme geldi', 'EUR'],
  ['300 Amerikan doları ödeme geldi', 'USD'],
  ['24 dolarlık domain yenilendi', 'USD'],
  ['24 dolarla domain yenilendi', 'USD'],
  ['24 euroya domain yenilendi', 'EUR'],
  ['24 euroluk domain yenilendi', 'EUR'],
  ['24 USD alan adı yenilendi', 'USD'],
  ['1200 liralık market', 'TRY'],
  ['1200 lira market', 'TRY'],
  ['1200TL market', 'TRY'],
])('preserves the explicitly stated currency in %s', (text, currency) => {
  const result = service.addText(text);
  expect(result.saved).toBe(true);
  expect(result.transaction?.currency).toBe(currency);
  expect(result.transaction?.amountTRY).toBeNull();
});

it.each([
  '24GBP domain yenilendi',
  '300GBP ödeme geldi',
  '24 sterlin domain yenilendi',
  '24XYZ domain yenilendi',
  'XYZ 24 domain yenilendi',
  '300 USDC ödeme geldi',
  '24xrp domain yenilendi',
  '24 ars domain yenilendi',
  'xrp 24 domain yenilendi',
  '24Xrp domain yenilendi',
  '24shib domain yenilendi',
  '24dash domain yenilendi',
  '24 mxnt domain yenilendi',
])('never silently converts an unsupported currency to TRY in %s', (text) => {
  const result = service.addText(text);
  expect(result.saved).toBe(false);
  expect(result.confirmation?.certain).toBe(false);
  expect(service.getContext().transactionCount).toBe(0);
});

it.each(['1200 MARKET', '30000 KİRA ÖDEDİM', '500 YEMEK', '128000 ÖDEME GELDİ', '1200 BİM'])(
  'keeps familiar uppercase Turkish entries usable: %s',
  (text) => {
    expect(service.parse(text).certain).toBe(true);
    expect(service.parse(text).draft.currency).toBe('TRY');
  },
);
