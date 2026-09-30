import { afterEach, beforeEach, expect, it } from 'vitest';
import { FinanceService } from '../server/core/service';
import { isoDateTime, localDateTime, money, transactionTimestamp } from '../src/format';

let service: FinanceService;
beforeEach(() => {
  service = new FinanceService(':memory:');
});
afterEach(() => {
  service.close();
});

it('preserves seconds and milliseconds when the visible minute is unchanged', () => {
  const original = '2026-09-30T10:05:45.678Z';
  expect(transactionTimestamp(localDateTime(original), original)).toBe(original);
});

it('converts an explicit Istanbul date edit to an exact UTC timestamp', () => {
  expect(isoDateTime('2026-09-30T13:06')).toBe('2026-09-30T10:06:00.000Z');
  expect(transactionTimestamp('2026-09-30T13:06', '2026-09-30T10:05:45.678Z')).toBe(
    '2026-09-30T10:06:00.000Z',
  );
});

it('keeps description edits from moving a repayment before its borrowing', () => {
  const debt = service.createDebt({ name: 'Deneme', type: 'OVERDRAFT', currency: 'TRY' });
  service.createTransaction({
    type: 'DEBT_USAGE',
    amount: '100',
    currency: 'TRY',
    description: 'Kullanım',
    debtId: debt.id,
    timestamp: '2026-09-30T10:05:30.123Z',
  });
  const payment = service.createTransaction({
    type: 'DEBT_PAYMENT',
    amount: '50',
    currency: 'TRY',
    description: 'Ödeme',
    debtId: debt.id,
    timestamp: '2026-09-30T10:05:45.678Z',
  });
  service.updateTransaction(payment.id, {
    description: 'Açıklama güncellendi',
    timestamp: transactionTimestamp(localDateTime(payment.timestamp), payment.timestamp),
  });
  expect(service.getTransaction(payment.id).timestamp).toBe(payment.timestamp);
  expect(service.listDebts()[0].currentBalance).toBe('50.00');
});

it('allows a cycle to end and the next cycle to start in the same visible minute', () => {
  const start = '2026-09-30T10:05:30.123Z';
  const end = '2026-09-30T10:05:30.456Z';
  const next = '2026-09-30T10:05:30.789Z';
  const first = service.startCycle({ start: transactionTimestamp(localDateTime(start), start) });
  service.endCycle(first.id, transactionTimestamp(localDateTime(end), end));
  const second = service.startCycle({ start: transactionTimestamp(localDateTime(next), next) });
  expect(second.start).toBe(next);
});

it('renders Turkish money without losing large minor units', () => {
  expect(money('128000.12', 'TRY')).toBe('₺128.000,12');
  expect(money('-90071992547409.91', 'USD')).toBe('−90.071.992.547.409,91 USD');
});
