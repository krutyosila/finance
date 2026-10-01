import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AiSettingsService } from '../server/ai/settings';
import { OpenAiInterpreter } from '../server/ai/client';
import { AiPlanService } from '../server/ai/plan';
import { FinanceService } from '../server/core/service';
import { decimal, minor } from '../server/core/money';
import type { AiPlan, Currency, Transaction, TransactionType } from '../shared/types';

// This evaluation deliberately uses the real configured provider, but every
// ledger and provider reference is synthetic and every database is in memory.
// It is separate from npm test; importing/listing fixtures makes no API calls.
interface EvaluationCase {
  id: string;
  text: string;
  certain: boolean;
  seed?: (finance: FinanceService) => void;
  inspect: (finance: FinanceService, plan: AiPlan) => void;
}

function normalized(value: string) {
  return value
    .toLocaleLowerCase('tr')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ı/g, 'i')
    .replace(/[^\p{L}\p{N}]/gu, '');
}
function account(finance: FinanceService, name: string, currency: Currency) {
  const matches = finance
    .listAccounts()
    .filter(
      (item) => normalized(item.name).includes(normalized(name)) && item.currency === currency,
    );
  assert.equal(matches.length, 1, `Exactly one ${name} ${currency} account is required`);
  return matches[0];
}
function debt(finance: FinanceService, name: string) {
  const matches = finance
    .listDebts()
    .filter((item) => normalized(item.name).includes(normalized(name)));
  assert.equal(matches.length, 1, `Exactly one ${name} debt is required`);
  return matches[0];
}
function tx(
  finance: FinanceService,
  type: TransactionType,
  amount: string,
  currency: Currency = 'TRY',
): Transaction {
  const matches = finance
    .listTransactions()
    .filter(
      (item) =>
        item.type === type &&
        item.amount === decimal(minor(amount, true)) &&
        item.currency === currency,
    );
  assert.equal(matches.length, 1, `Exactly one ${type} ${amount} ${currency} movement is required`);
  return matches[0];
}
function balance(finance: FinanceService, name: string, currency: Currency, expected: string) {
  assert.equal(account(finance, name, currency).currentBalance, decimal(minor(expected, true)));
}
function fields(actual: object, expected: Record<string, unknown>) {
  for (const [key, value] of Object.entries(expected))
    assert.deepEqual((actual as Record<string, unknown>)[key], value, `${key} field`);
}
function count(
  finance: FinanceService,
  expected: Partial<
    Record<
      'accounts' | 'debts' | 'transactions' | 'obligations' | 'subscriptions' | 'cycles',
      number
    >
  >,
) {
  const values = {
    accounts: finance.listAccounts().length,
    debts: finance.listDebts().length,
    transactions: finance.listTransactions().length,
    obligations: finance.listObligations().length,
    subscriptions: finance.listSubscriptions().length,
    cycles: finance.listCycles().length,
  };
  const expectedCounts = {
    accounts: 0,
    debts: 0,
    transactions: 0,
    obligations: 0,
    subscriptions: 0,
    cycles: 0,
    ...expected,
  };
  for (const [kind, value] of Object.entries(expectedCounts))
    assert.equal(values[kind as keyof typeof values], value, `${kind} count`);
}
function snapshot(finance: FinanceService) {
  return JSON.stringify({
    accounts: finance.listAccounts(),
    debts: finance.listDebts(),
    transactions: finance.listTransactions(),
    obligations: finance.listObligations(),
    subscriptions: finance.listSubscriptions(),
    cycles: finance.listCycles(),
    audit: finance.listAudit(),
    receipts: finance.sqlite.prepare('SELECT * FROM ai_entry_receipts ORDER BY request_id').all(),
  });
}
function seedBank(
  finance: FinanceService,
  name = 'Deneme Bankası',
  amount = '10000',
  currency: Currency = 'TRY',
) {
  return finance.createAccount({ name, type: 'BANK', currency, openingBalance: amount });
}
function noFlows(finance: FinanceService) {
  assert.deepEqual(finance.getContext({ all: true }).metrics.income, {});
  assert.deepEqual(finance.getContext({ all: true }).metrics.expenses, {});
}
const paribu =
  'Paribu hesabıma 2500 dolar geldi, bunu TL ye çevirdim ve 90000 TL sini VakıfBank hesabıma attım. Kalanı Paribu hesabımda.';
function inspectParibu(finance: FinanceService, existing = false) {
  count(finance, { accounts: 3, debts: 0, transactions: 3 });
  balance(finance, 'Paribu', 'USD', existing ? '10' : '0');
  balance(finance, 'Paribu', 'TRY', existing ? '13000' : '10000');
  balance(finance, 'VakıfBank', 'TRY', existing ? '90500' : '90000');
  const income = tx(finance, 'INCOME', '2500', 'USD');
  const fx = tx(finance, 'TRANSFER', '2500', 'USD');
  const onward = tx(finance, 'TRANSFER', '90000');
  assert.equal(fx.destinationAmount, '100000.00');
  assert.equal(income.accountId, account(finance, 'Paribu', 'USD').id);
  assert.equal(fx.accountId, income.accountId);
  assert.equal(fx.destinationAccountId, onward.accountId);
  assert.equal(onward.destinationAccountId, account(finance, 'VakıfBank', 'TRY').id);
  assert.deepEqual(
    (
      finance.sqlite.prepare('SELECT type FROM transactions ORDER BY timestamp, rowid').all() as {
        type: string;
      }[]
    ).map((item) => item.type),
    ['INCOME', 'TRANSFER', 'TRANSFER'],
  );
  assert.deepEqual(finance.getContext({ all: true }).metrics.income, { USD: '2500.00' });
  assert.deepEqual(finance.getContext({ all: true }).metrics.expenses, {});
}

const cases: EvaluationCase[] = [
  {
    id: 'account_snapshots',
    certain: true,
    text: 'Dört yeni hesap tanımla; bunlar açılış bakiyeleridir ve para hareketi değildir: Deneme Bankası banka hesabı, sahibi Ayşe, 1234,56 TL açılış, notu "Test hesabı". Ev Nakit adlı nakit hesap 500 TL açılış. Test Cüzdan adlı cüzdan 25 USDT açılış. Acil Birikim adlı birikim hesabı 100 EUR açılış.',
    inspect(finance) {
      count(finance, { accounts: 4, debts: 0, transactions: 0 });
      noFlows(finance);
      const bank = account(finance, 'Deneme Bankası', 'TRY');
      assert.equal(bank.type, 'BANK');
      assert.equal(bank.owner, 'Ayşe');
      assert.equal(bank.notes, 'Test hesabı');
      balance(finance, 'Deneme Bankası', 'TRY', '1234.56');
      assert.equal(account(finance, 'Ev Nakit', 'TRY').type, 'CASH');
      balance(finance, 'Ev Nakit', 'TRY', '500');
      assert.equal(account(finance, 'Test Cüzdan', 'USDT').type, 'WALLET');
      balance(finance, 'Test Cüzdan', 'USDT', '25');
      assert.equal(account(finance, 'Acil Birikim', 'EUR').type, 'SAVINGS');
      balance(finance, 'Acil Birikim', 'EUR', '100');
    },
  },
  {
    id: 'credit_and_overdraft',
    certain: true,
    text: 'İki yeni hesap tanımla: Test Kart kredi kartımın limiti 50000 TL, mevcut borcu 12000 TL, sahibi Ayşe, notu "Test kartı". Test KMH adlı kredili mevduat hesabımın limiti 20000 TL, mevcut borcu 3000 TL. Bunlar mevcut borç açılışları; ödeme veya yeni borç kullanımı yok.',
    inspect(finance) {
      count(finance, { accounts: 2, debts: 2, transactions: 0 });
      noFlows(finance);
      const card = account(finance, 'Test Kart', 'TRY'),
        overdraft = account(finance, 'Test KMH', 'TRY');
      assert.equal(card.type, 'CREDIT_CARD');
      assert.equal(card.creditLimit, '50000.00');
      assert.equal(card.currentDebt, '12000.00');
      assert.equal(card.owner, 'Ayşe');
      assert.equal(card.notes, 'Test kartı');
      assert.equal(overdraft.type, 'OVERDRAFT');
      assert.equal(overdraft.creditLimit, '20000.00');
      assert.equal(overdraft.currentDebt, '3000.00');
      assert.equal(debt(finance, 'Test Kart').accountId, card.id);
      assert.equal(debt(finance, 'Test KMH').accountId, overdraft.id);
    },
  },
  {
    id: 'debt_snapshots',
    certain: true,
    text: 'Yeni üç mevcut borç tanımı ekle, para hareketi ekleme: Eğitim Kredisi türü banka kredisi, 10000 TL açılış borcu, kredi limiti 15000 TL, notu "Test kredi borcu"; Ali Borcu kişisel borç 2000 USD açılış; Diğer Borç türü diğer, 50 EUR açılış.',
    seed(finance) {
      seedBank(finance);
    },
    inspect(finance) {
      count(finance, { accounts: 1, debts: 3, transactions: 0 });
      noFlows(finance);
      const loan = debt(finance, 'Eğitim Kredisi');
      assert.equal(loan.type, 'LOAN');
      assert.equal(loan.currency, 'TRY');
      assert.equal(loan.currentBalance, '10000.00');
      assert.equal(loan.creditLimit, '15000.00');
      assert.equal(loan.notes, 'Test kredi borcu');
      assert.equal(loan.accountId, null);
      assert.equal(debt(finance, 'Ali Borcu').type, 'PERSONAL');
      assert.equal(debt(finance, 'Ali Borcu').currency, 'USD');
      assert.equal(debt(finance, 'Ali Borcu').currentBalance, '2000.00');
      assert.equal(debt(finance, 'Diğer Borç').type, 'OTHER');
      assert.equal(debt(finance, 'Diğer Borç').currency, 'EUR');
      assert.equal(debt(finance, 'Diğer Borç').currentBalance, '50.00');
    },
  },
  {
    id: 'unassigned_multicurrency',
    certain: true,
    text: 'Hiçbir hesaba bağlamadan dört hareket ekle: 125,50 TL yemek gideri, 10 dolar gelir, 20 EUR gelir ve 30 USDT gelir. USDT olan tutar dolar değildir.',
    inspect(finance) {
      count(finance, { accounts: 0, debts: 0, transactions: 4 });
      assert.equal(tx(finance, 'EXPENSE', '125.50').accountId, null);
      for (const [amount, currency] of [
        ['10', 'USD'],
        ['20', 'EUR'],
        ['30', 'USDT'],
      ] as const)
        assert.equal(tx(finance, 'INCOME', amount, currency).accountId, null);
      assert.deepEqual(finance.getContext({ all: true }).metrics.income, {
        USD: '10.00',
        EUR: '20.00',
        USDT: '30.00',
      });
      assert.deepEqual(finance.getContext({ all: true }).metrics.expenses, { TRY: '125.50' });
    },
  },
  {
    id: 'business_expense_metadata',
    certain: true,
    text: 'Deneme Bankası TL hesabımdan 100 USD yazılım harcaması yaptım; gerçek TL tahsilatı 3500 TL, bu işlemin açık net kuru 1 USD = 35 TL. Tarih 1 Ekim 2026 saat 12:30 İstanbul. İş kapsamı BUSINESS, kategori tam olarak "Yazılım", karşı taraf tam olarak "Örnek Ltd", ödeme yöntemi tam olarak "Havale", not tam olarak "Fatura TEST001".',
    seed(finance) {
      seedBank(finance);
    },
    inspect(finance) {
      count(finance, { accounts: 1, transactions: 1 });
      const item = tx(finance, 'EXPENSE', '100', 'USD');
      assert.equal(item.accountId, account(finance, 'Deneme Bankası', 'TRY').id);
      assert.equal(item.amountTRY, '3500.00');
      assert.ok(item.exchangeRate);
      assert.equal(Number(item.exchangeRate), 35);
      assert.equal(item.timestamp, '2026-10-01T09:30:00.000Z');
      assert.equal(item.scope, 'BUSINESS');
      assert.equal(item.category, 'Yazılım');
      assert.equal(item.counterparty, 'Örnek Ltd');
      assert.equal(item.paymentMethod, 'Havale');
      assert.equal(item.notes, 'Fatura TEST001');
      balance(finance, 'Deneme Bankası', 'TRY', '6500');
      assert.deepEqual(finance.getContext({ all: true }).scopeTotals.BUSINESS, { USD: '100.00' });
    },
  },
  {
    id: 'refund_and_adjustment',
    certain: true,
    text: 'Deneme Bankası hesabımdan önce 100 TL alışveriş yaptım, sonra aynı hesaba bunun 40 TL iadesi geldi. Son olarak açık bakiye düzeltmesi olarak hesaptan 10 TL düş: düzeltme tutarı -10 TL. İade gelir değildir; düzeltme gider değildir.',
    seed(finance) {
      seedBank(finance, 'Deneme Bankası', '1000');
    },
    inspect(finance) {
      count(finance, { accounts: 1, transactions: 3 });
      tx(finance, 'EXPENSE', '100');
      tx(finance, 'REFUND', '40');
      tx(finance, 'ADJUSTMENT', '-10');
      balance(finance, 'Deneme Bankası', 'TRY', '930');
      assert.deepEqual(finance.getContext({ all: true }).metrics.income, {});
      assert.deepEqual(finance.getContext({ all: true }).metrics.expenses, { TRY: '60.00' });
    },
  },
  {
    id: 'loan_usage_and_payment',
    certain: true,
    text: 'Yeni Eğitim Kredisi adlı TL kredi borcu tanımı oluştur, bu hareketlerden önce açılış borcu 0 TL. Bu krediden 10000 TL yeni borç kullandım ve Deneme Bankası hesabıma geçti. Ardından bu hesaptan Eğitim Kredisi borcuna 2000 TL anapara ödedim. Yeni borç gelir, borç ödemesi gider değildir.',
    seed(finance) {
      seedBank(finance, 'Deneme Bankası', '1000');
    },
    inspect(finance) {
      count(finance, { accounts: 1, debts: 1, transactions: 2 });
      const loan = debt(finance, 'Eğitim Kredisi');
      assert.equal(loan.type, 'LOAN');
      assert.equal(loan.currentBalance, '8000.00');
      assert.equal(loan.newUsage, '10000.00');
      assert.equal(loan.payments, '2000.00');
      assert.equal(tx(finance, 'DEBT_USAGE', '10000').debtId, loan.id);
      assert.equal(tx(finance, 'DEBT_PAYMENT', '2000').debtId, loan.id);
      balance(finance, 'Deneme Bankası', 'TRY', '9000');
      noFlows(finance);
    },
  },
  {
    id: 'debt_interest_and_fee',
    certain: true,
    text: 'Test KMH borcuna 50 TL faiz ve 20 TL masraf işlendi. Bunlar kredili mevduat hesabına yazılan iki ayrı EXPENSE harcama; faiz bileşeni INTEREST, masraf bileşeni FEE. Ardından Deneme Bankası hesabımdan Test KMH borcuna 200 TL borç ödemesi yaptım.',
    seed(finance) {
      seedBank(finance, 'Deneme Bankası', '1000');
      finance.createAccount({
        name: 'Test KMH',
        type: 'OVERDRAFT',
        currency: 'TRY',
        currentDebt: '1000',
        creditLimit: '5000',
      });
    },
    inspect(finance) {
      count(finance, { accounts: 2, debts: 1, transactions: 3 });
      const cardDebt = debt(finance, 'Test KMH');
      assert.equal(tx(finance, 'EXPENSE', '50').debtComponent, 'INTEREST');
      assert.equal(tx(finance, 'EXPENSE', '20').debtComponent, 'FEE');
      assert.equal(cardDebt.interest, '50.00');
      assert.equal(cardDebt.fees, '20.00');
      assert.equal(cardDebt.currentBalance, '870.00');
      assert.equal(tx(finance, 'DEBT_PAYMENT', '200').debtId, cardDebt.id);
      balance(finance, 'Deneme Bankası', 'TRY', '800');
      assert.deepEqual(finance.getContext({ all: true }).metrics.expenses, { TRY: '70.00' });
    },
  },
  {
    id: 'card_expense_and_refund',
    certain: true,
    text: 'Test Kart kredi kartımla 300 TL market harcaması yaptım, sonra aynı karta bu alışverişin 50 TL iadesi geldi. Bunlar kartın anapara harcaması ve iadesi. Ardından Deneme Bankası hesabımdan Test Kart kredi kartı borcuma 1000 TL ödeme yaptım.',
    seed(finance) {
      seedBank(finance);
      finance.createAccount({
        name: 'Test Kart',
        type: 'CREDIT_CARD',
        currency: 'TRY',
        currentDebt: '1000',
        creditLimit: '5000',
      });
    },
    inspect(finance) {
      count(finance, { accounts: 2, debts: 1, transactions: 3 });
      const card = account(finance, 'Test Kart', 'TRY');
      assert.equal(tx(finance, 'EXPENSE', '300').accountId, card.id);
      assert.equal(tx(finance, 'REFUND', '50').accountId, card.id);
      assert.equal(card.currentDebt, '250.00');
      const payment = tx(finance, 'DEBT_PAYMENT', '1000');
      assert.equal(payment.debtId, debt(finance, 'Test Kart').id);
      assert.equal(payment.accountId, account(finance, 'Deneme Bankası', 'TRY').id);
      balance(finance, 'Deneme Bankası', 'TRY', '9000');
      assert.deepEqual(finance.getContext({ all: true }).metrics.expenses, { TRY: '250.00' });
    },
  },
  {
    id: 'same_currency_transfer',
    certain: true,
    text: 'Deneme Bankası TL hesabımdan Diğer Banka TL hesabıma 1000 TL aktardım. Kendi hesaplarım arası tek transfer.',
    seed(finance) {
      seedBank(finance, 'Deneme Bankası', '5000');
      seedBank(finance, 'Diğer Banka', '250');
    },
    inspect(finance) {
      count(finance, { accounts: 2, transactions: 1 });
      const item = tx(finance, 'TRANSFER', '1000');
      assert.equal(item.accountId, account(finance, 'Deneme Bankası', 'TRY').id);
      assert.equal(item.destinationAccountId, account(finance, 'Diğer Banka', 'TRY').id);
      balance(finance, 'Deneme Bankası', 'TRY', '4000');
      balance(finance, 'Diğer Banka', 'TRY', '1250');
      noFlows(finance);
    },
  },
  {
    id: 'savings_add_and_withdraw',
    certain: true,
    text: 'Deneme Bankası hesabımdan Acil Birikim hesabıma 2000 TL birikime ayırdım. Sonra bu birikimden 500 TL çekip Deneme Bankası hesabıma geri aldım. İkisi de birikim hareketi (SAVINGS); çekim eksi tutarla kaydedilmeli.',
    seed(finance) {
      seedBank(finance, 'Deneme Bankası', '5000');
      finance.createAccount({
        name: 'Acil Birikim',
        type: 'SAVINGS',
        currency: 'TRY',
        openingBalance: '1000',
      });
    },
    inspect(finance) {
      count(finance, { accounts: 2, transactions: 2 });
      const add = tx(finance, 'SAVINGS', '2000'),
        withdrawal = tx(finance, 'SAVINGS', '-500');
      assert.equal(add.accountId, account(finance, 'Deneme Bankası', 'TRY').id);
      assert.equal(add.destinationAccountId, account(finance, 'Acil Birikim', 'TRY').id);
      assert.equal(withdrawal.accountId, add.accountId);
      assert.equal(withdrawal.destinationAccountId, add.destinationAccountId);
      balance(finance, 'Deneme Bankası', 'TRY', '3500');
      balance(finance, 'Acil Birikim', 'TRY', '2500');
      noFlows(finance);
      assert.deepEqual(finance.getContext({ all: true }).metrics.savingsAdded, { TRY: '1500.00' });
    },
  },
  {
    id: 'schedule_frequencies_and_inactive',
    certain: true,
    text: 'Yalnız dört yeni plan ekle, ödeme yapma: adı tam olarak "Haftalık Temizlik" olan düzenli ödeme 100 TL, haftalık, sonraki ödeme 2026-10-05; Netflix aboneliği 300 TL aylık, yenileme 2026-10-15; Ofis Bakımı düzenli ödemesi 900 TL üç aylık, sonraki ödeme 2026-12-01, BUSINESS kapsamı, kategori "Ofis"; Arşiv Hizmeti aboneliği 120 EUR yıllık, yenileme 2027-01-01, pasif olarak ekle (active=false), kategori "Arşiv", PERSONAL kapsamı.',
    inspect(finance) {
      count(finance, { accounts: 0, transactions: 0, obligations: 2, subscriptions: 2 });
      noFlows(finance);
      const weekly = finance
        .listObligations()
        .find((item) => normalized(item.name).includes(normalized('Haftalık Temizlik')))!;
      const quarterly = finance
        .listObligations()
        .find((item) => normalized(item.name).includes(normalized('Ofis Bakımı')))!;
      assert.ok(weekly);
      assert.ok(quarterly);
      assert.equal(weekly.frequency, 'WEEKLY');
      assert.equal(weekly.dueDate, '2026-10-05');
      fields(weekly, { amount: '100.00', currency: 'TRY' });
      assert.equal(quarterly.frequency, 'QUARTERLY');
      assert.equal(quarterly.scope, 'BUSINESS');
      assert.equal(quarterly.category, 'Ofis');
      fields(quarterly, { amount: '900.00', currency: 'TRY', dueDate: '2026-12-01' });
      const monthly = finance
        .listSubscriptions()
        .find((item) => normalized(item.service).includes('netflix'))!;
      const yearly = finance
        .listSubscriptions()
        .find((item) => normalized(item.service).includes(normalized('Arşiv Hizmeti')))!;
      assert.ok(monthly);
      assert.ok(yearly);
      assert.equal(monthly.frequency, 'MONTHLY');
      assert.equal(monthly.nextRenewal, '2026-10-15');
      fields(monthly, { amount: '300.00', currency: 'TRY' });
      assert.equal(yearly.frequency, 'YEARLY');
      assert.equal(yearly.active, false);
      assert.equal(yearly.currency, 'EUR');
      assert.equal(yearly.category, 'Arşiv');
      fields(yearly, { amount: '120.00', nextRenewal: '2027-01-01', scope: 'PERSONAL' });
    },
  },
  {
    id: 'new_subscription_and_payment',
    certain: true,
    text: 'Yeni Test Yazılım aboneliği tanımla: aylık 300 TL, ilk yenileme 2026-10-15, ödeme hesabı Deneme Bankası, BUSINESS kapsamı, kategori "Yazılım", aktif. Bu aboneliğin 300 TL ilk ödemesini de şimdi yaptım. Hem abonelik tanımı hem tek gerçek ödeme ekle.',
    seed(finance) {
      seedBank(finance, 'Deneme Bankası', '1000');
    },
    inspect(finance) {
      count(finance, { accounts: 1, transactions: 1, subscriptions: 1 });
      const subscription = finance.listSubscriptions()[0],
        payment = tx(finance, 'EXPENSE', '300');
      assert.equal(subscription.frequency, 'MONTHLY');
      assert.equal(subscription.amount, '300.00');
      assert.equal(subscription.nextRenewal, '2026-10-15');
      assert.equal(subscription.status, 'PAID');
      fields(subscription, {
        scope: 'BUSINESS',
        category: 'Yazılım',
        active: true,
        currency: 'TRY',
      });
      assert.equal(payment.subscriptionId, subscription.id);
      assert.equal(payment.accountId, subscription.accountId);
      assert.equal(payment.scope, 'BUSINESS');
      assert.equal(payment.category, 'Yazılım');
      balance(finance, 'Deneme Bankası', 'TRY', '700');
    },
  },
  {
    id: 'existing_subscription_inheritance',
    certain: true,
    text: 'Mevcut Test Bulut aboneliğinin 35 USD ödemesini yaptım. Aboneliğin kayıtlı ödeme hesabını, kategorisini ve kapsamını kullan.',
    seed(finance) {
      const wallet = finance.createAccount({
        name: 'Test Cüzdan',
        type: 'WALLET',
        currency: 'USD',
        openingBalance: '100',
      });
      finance.createSubscription({
        service: 'Test Bulut',
        amount: '35',
        currency: 'USD',
        frequency: 'WEEKLY',
        nextRenewal: '2026-10-05',
        accountId: wallet.id,
        category: 'Sunucu',
        scope: 'BUSINESS',
      });
    },
    inspect(finance) {
      count(finance, { accounts: 1, transactions: 1, subscriptions: 1 });
      const subscription = finance.listSubscriptions()[0],
        payment = tx(finance, 'EXPENSE', '35', 'USD');
      assert.equal(payment.subscriptionId, subscription.id);
      assert.equal(payment.accountId, subscription.accountId);
      assert.equal(payment.category, 'Sunucu');
      assert.equal(payment.scope, 'BUSINESS');
      assert.equal(subscription.status, 'PAID');
      balance(finance, 'Test Cüzdan', 'USD', '65');
    },
  },
  {
    id: 'existing_obligation_inheritance',
    certain: true,
    text: 'Mevcut Ofis Kirası düzenli ödememin 6000 TL ödemesini yaptım. Kayıtlı ödeme hesabını, kategorisini ve kapsamını kullan.',
    seed(finance) {
      const bank = seedBank(finance);
      finance.createObligation({
        name: 'Ofis Kirası',
        amount: '6000',
        currency: 'TRY',
        frequency: 'MONTHLY',
        dueDate: '2026-10-05',
        accountId: bank.id,
        category: 'Kira',
        scope: 'BUSINESS',
      });
    },
    inspect(finance) {
      count(finance, { accounts: 1, transactions: 1, obligations: 1 });
      const obligation = finance.listObligations()[0],
        payment = tx(finance, 'EXPENSE', '6000');
      assert.equal(payment.obligationId, obligation.id);
      assert.equal(payment.accountId, obligation.accountId);
      assert.equal(payment.category, 'Kira');
      assert.equal(payment.scope, 'BUSINESS');
      assert.equal(obligation.status, 'PAID');
      balance(finance, 'Deneme Bankası', 'TRY', '4000');
    },
  },
  {
    id: 'all_six_record_kinds',
    certain: true,
    text: 'Şu altı kaydı birlikte ekle: Deneme Bankası BANK TL hesabı, bu hareketlerden önce açılış bakiyesi 10000 TL. Ali Borcu PERSONAL TL borç, mevcut açılış borcu 2000 TL. Test Kira düzenli ödemesi aylık 1000 TL, vade 2026-10-05, hesabı Deneme Bankası. Test Müzik aboneliği aylık 200 TL, yenileme 2026-10-15, hesabı Deneme Bankası. Test Ekim adlı yeni finans dönemi 2026-10-01 tarihinde başlasın. 2026-10-02 tarihinde Deneme Bankası hesabından 100 TL market harcaması yaptım. Plan tanımları için ödeme yapılmadı.',
    inspect(finance, plan) {
      assert.deepEqual([...new Set(plan.items.map((item) => item.kind))].sort(), [
        'account',
        'cycle',
        'debt',
        'obligation',
        'subscription',
        'transaction',
      ]);
      count(finance, {
        accounts: 1,
        debts: 1,
        transactions: 1,
        obligations: 1,
        subscriptions: 1,
        cycles: 1,
      });
      const bank = account(finance, 'Deneme Bankası', 'TRY');
      balance(finance, 'Deneme Bankası', 'TRY', '9900');
      assert.equal(debt(finance, 'Ali Borcu').currentBalance, '2000.00');
      assert.equal(finance.listSubscriptions()[0].accountId, bank.id);
      assert.equal(finance.listObligations()[0].accountId, bank.id);
      fields(finance.listSubscriptions()[0], {
        service: 'Test Müzik',
        amount: '200.00',
        frequency: 'MONTHLY',
        nextRenewal: '2026-10-15',
        currency: 'TRY',
      });
      fields(finance.listObligations()[0], {
        name: 'Test Kira',
        amount: '1000.00',
        frequency: 'MONTHLY',
        dueDate: '2026-10-05',
        currency: 'TRY',
      });
      assert.equal(finance.listCycles()[0].name, 'Test Ekim');
      assert.equal(finance.listCycles()[0].start, '2026-09-30T21:00:00.000Z');
      assert.equal(tx(finance, 'EXPENSE', '100').timestamp, '2026-10-01T21:00:00.000Z');
      assert.deepEqual(finance.getContext().metrics.expenses, { TRY: '100.00' });
    },
  },
  {
    id: 'default_cycle_and_undated_flows',
    certain: true,
    text: 'Şimdi Yeni Test Dönemi adlı finans dönemini başlat. Sonra hesapsız 500 TL gelir ve 100 TL gider ekle. Hareketler bu yeni döneme ait, hepsi şimdi; ayrıca tarih belirtmiyorum.',
    inspect(finance) {
      count(finance, { accounts: 0, transactions: 2, cycles: 1 });
      const cycle = finance.listCycles()[0],
        income = tx(finance, 'INCOME', '500'),
        expense = tx(finance, 'EXPENSE', '100');
      assert.equal(cycle.name, 'Yeni Test Dönemi');
      assert.equal(income.timestamp, expense.timestamp);
      assert.ok(
        cycle.start <= income.timestamp,
        'Undated flows must belong to the newly started cycle',
      );
      assert.deepEqual(finance.getContext().metrics.income, { TRY: '500.00' });
      assert.deepEqual(finance.getContext().metrics.expenses, { TRY: '100.00' });
    },
  },
  {
    id: 'paribu_missing_fx_total',
    certain: false,
    text: paribu,
    inspect(_finance, plan) {
      const movements = plan.items.filter((item) => item.kind === 'transaction');
      assert.equal(plan.items.length, 6);
      assert.equal(movements.length, 3);
      assert.equal(plan.items.filter((item) => item.kind === 'account').length, 3);
      assert.deepEqual(
        movements.map((item) => item.data.type),
        ['INCOME', 'TRANSFER', 'TRANSFER'],
      );
      assert.equal(decimal(minor(movements[0].data.amount)), '2500.00');
      assert.equal(movements[0].data.currency, 'USD');
      fields(movements[1].data, { type: 'TRANSFER', currency: 'USD' });
      assert.equal(decimal(minor(movements[1].data.amount)), '2500.00');
      assert.equal(movements[1].data.destinationAmount, undefined);
      assert.equal(decimal(minor(movements[2].data.amount)), '90000.00');
      assert.equal(movements[2].data.currency, 'TRY');
      assert.equal(movements[0].data.accountId, movements[1].data.accountId);
      assert.equal(movements[1].data.destinationAccountId, movements[2].data.accountId);
      const links = [
        movements[0].data.accountId,
        movements[1].data.destinationAccountId,
        movements[2].data.destinationAccountId,
      ];
      for (const [index, link] of links.entries()) {
        assert.ok(typeof link === 'string' && link.startsWith('@'));
        const linkedKey = link.slice(1);
        const linked = plan.items.find((item) => item.kind === 'account' && item.key === linkedKey);
        assert.ok(linked && linked.kind === 'account');
        assert.equal(linked.data.currency, index === 0 ? 'USD' : 'TRY');
        assert.ok(
          normalized(linked.data.name!).includes(normalized(index === 2 ? 'VakıfBank' : 'Paribu')),
        );
      }
      assert.ok(plan.issues.length > 0);
    },
  },
  {
    id: 'paribu_complete_with_remaining',
    certain: true,
    text: `${paribu}\nEk bilgi: Çevrimde toplam net 100000 TL aldım, Paribu'da kalan 10000 TL.`,
    inspect(finance) {
      inspectParibu(finance);
    },
  },
  {
    id: 'paribu_reuse_existing_accounts',
    certain: true,
    text: `${paribu}\nEk bilgi: Çevrimde toplam net 100000 TL aldım. Bu üç harekete dair kalan 10000 TL; eski bakiyelerimi değiştirme.`,
    seed(finance) {
      finance.createAccount({
        name: 'Paribu',
        type: 'WALLET',
        currency: 'USD',
        openingBalance: '10',
      });
      finance.createAccount({
        name: 'Paribu',
        type: 'WALLET',
        currency: 'TRY',
        openingBalance: '3000',
      });
      seedBank(finance, 'VakıfBank', '500');
    },
    inspect(finance, plan) {
      assert.equal(plan.items.filter((item) => item.kind === 'account').length, 0);
      inspectParibu(finance, true);
    },
  },
  {
    id: 'paribu_explicit_net_rate',
    certain: true,
    text: `${paribu}\nEk bilgi: 2500 USD'nin tamamını bozdurdum. Açık net çevrim kuru her 1 USD için 40 TL; kesinti yok.`,
    inspect(finance) {
      inspectParibu(finance);
      const item = tx(finance, 'TRANSFER', '2500', 'USD');
      assert.ok(item.exchangeRate);
      assert.equal(Number(item.exchangeRate), 40);
    },
  },
  {
    id: 'eur_usdt_and_cross_currency',
    certain: true,
    text: 'İki ayrı kendi hesaplarım arası döviz çevrimi kaydet: Binance EUR cüzdanımdan 50 EUR çevirerek Binance USD cüzdanıma net 55 USD aldım. Sonra Binance USDT cüzdanımdan 100 USDT çevirerek Deneme Bankası TL hesabıma net 4000 TL aldım. USDT dolar değildir. Yalnız bu iki hareket; gelir veya gider yok.',
    seed(finance) {
      for (const [currency, openingBalance] of [
        ['EUR', '100'],
        ['USD', '0'],
        ['USDT', '1000'],
      ] as const)
        finance.createAccount({ name: 'Binance', type: 'WALLET', currency, openingBalance });
      seedBank(finance, 'Deneme Bankası', '0');
    },
    inspect(finance) {
      count(finance, { accounts: 4, transactions: 2 });
      const eur = tx(finance, 'TRANSFER', '50', 'EUR'),
        usdt = tx(finance, 'TRANSFER', '100', 'USDT');
      assert.equal(eur.destinationAmount, '55.00');
      assert.equal(eur.destinationAccountId, account(finance, 'Binance', 'USD').id);
      assert.equal(usdt.destinationAmount, '4000.00');
      assert.equal(usdt.destinationAccountId, account(finance, 'Deneme Bankası', 'TRY').id);
      balance(finance, 'Binance', 'EUR', '50');
      balance(finance, 'Binance', 'USD', '55');
      balance(finance, 'Binance', 'USDT', '900');
      balance(finance, 'Deneme Bankası', 'TRY', '4000');
      noFlows(finance);
    },
  },
  {
    id: 'ambiguous_existing_account',
    certain: false,
    text: 'Deniz hesabıma 500 TL gelir geldi. Hangi Deniz hesabı olduğunu henüz belirtmedim.',
    seed(finance) {
      finance.createAccount({
        name: 'Deniz',
        owner: 'Ayşe',
        type: 'BANK',
        currency: 'TRY',
        openingBalance: '100',
      });
      finance.createAccount({
        name: 'Deniz',
        owner: 'Mehmet',
        type: 'BANK',
        currency: 'TRY',
        openingBalance: '200',
      });
    },
    inspect(_finance, plan) {
      assert.ok(plan.issues.length > 0);
      assert.ok(plan.items.length <= 2);
      assert.ok(plan.items.every((item) => item.kind === 'transaction' || item.kind === 'account'));
      assert.ok(
        plan.items.some((item) => item.kind === 'transaction' && item.data.type === 'INCOME'),
      );
      const movement = plan.items.find((item) => item.kind === 'transaction')!;
      assert.equal(
        decimal(minor('amount' in movement.data ? movement.data.amount : undefined)),
        '500.00',
      );
      assert.equal('currency' in movement.data ? movement.data.currency : undefined, 'TRY');
    },
  },
  {
    id: 'unsupported_currency',
    certain: false,
    text: 'Hesapsız 50 İngiliz sterlini (GBP) yemek harcaması yaptım. Tutar GBP, başka dövize çevrilmedi.',
    inspect(_finance, plan) {
      assert.ok(plan.issues.length > 0);
      assert.ok(plan.items.length <= 1);
      assert.ok(plan.items.every((item) => item.kind === 'transaction'));
      assert.ok(!plan.items.some((item) => item.kind === 'transaction' && item.data.currency));
    },
  },
  {
    id: 'missing_renewal_and_debt_amount',
    certain: false,
    text: 'Yeni Spotify aboneliği aylık 100 TL olarak ekle; yenileme gününü bilmiyorum. Ayrıca Ali Borcu adlı TL kişisel borcumu tanımla; mevcut borç tutarını henüz bilmiyorum. Hiçbir para hareketi olmadı.',
    inspect(_finance, plan) {
      assert.ok(plan.issues.length > 0);
      assert.equal(plan.items.length, 2);
      assert.ok(plan.items.some((item) => item.kind === 'subscription'));
      assert.ok(plan.items.some((item) => item.kind === 'debt'));
      assert.equal(plan.items.filter((item) => item.kind === 'transaction').length, 0);
      assert.ok(
        !plan.items.some((item) => item.kind === 'debt' && item.data.openingBalance != null),
      );
      assert.ok(
        !plan.items.some((item) => item.kind === 'subscription' && item.data.nextRenewal != null),
      );
    },
  },
];

function options() {
  const selected = new Set<string>();
  let list = false,
    checkFixtures = false,
    concurrency = 2,
    timeoutMs = 20000;
  for (const argument of process.argv.slice(2)) {
    if (argument === '--list') list = true;
    else if (argument === '--check-fixtures') checkFixtures = true;
    else if (argument.startsWith('--case=')) selected.add(argument.slice(7));
    else if (/^--concurrency=[12]$/.test(argument)) concurrency = Number(argument.slice(14));
    else if (/^--timeout-ms=\d+$/.test(argument)) {
      timeoutMs = Number(argument.slice(13));
      assert.ok(timeoutMs >= 1 && timeoutMs <= 120000, 'Timeout must be between 1 and 120000 ms');
    } else
      throw new Error(
        'Usage: node --import tsx scripts/ai-evaluate.ts [--list] [--check-fixtures] [--case=ID] [--concurrency=1|2] [--timeout-ms=NUMBER]',
      );
  }
  for (const id of selected)
    assert.ok(
      cases.some((item) => item.id === id),
      `Unknown case: ${id}`,
    );
  return {
    list,
    checkFixtures,
    concurrency,
    timeoutMs,
    cases: cases.filter((item) => selected.size === 0 || selected.has(item.id)),
  };
}

async function main() {
  const configuration = options();
  if (configuration.list) {
    for (const item of configuration.cases)
      console.log(
        JSON.stringify({ case: item.id, expects: item.certain ? 'saved' : 'clarification' }),
      );
    return;
  }
  if (configuration.checkFixtures) {
    for (const item of configuration.cases) {
      const finance = new FinanceService(':memory:');
      try {
        item.seed?.(finance);
        snapshot(finance);
        console.log(JSON.stringify({ case: item.id, fixture_valid: true }));
      } finally {
        finance.close();
      }
    }
    return;
  }
  const settings = new AiSettingsService();
  assert.equal(settings.status().configured, true, 'AI is not configured');
  const interpreter = new OpenAiInterpreter(settings, { timeoutMs: configuration.timeoutMs });
  let next = 0,
    failures = 0;
  async function worker() {
    while (next < configuration.cases.length) {
      const item = configuration.cases[next++],
        finance = new FinanceService(':memory:'),
        started = performance.now();
      let plan: AiPlan | undefined;
      try {
        item.seed?.(finance);
        const before = snapshot(finance),
          service = new AiPlanService(finance, interpreter);
        plan = await service.preview(item.text);
        assert.equal(
          snapshot(finance),
          before,
          'Preview must not persist records, audit entries, or receipts',
        );
        assert.equal(
          plan.certain,
          item.certain,
          `Certainty differs: ${JSON.stringify(plan.issues)}`,
        );
        if (item.certain) {
          assert.deepEqual(plan.issues, []);
          const requestId = randomUUID(),
            result = service.confirm(plan, requestId);
          assert.equal(result.saved, true, `Confirmation failed: ${JSON.stringify(result)}`);
          if (!result.saved) throw new Error('Plan could not be saved');
          assert.equal(
            result.records.length,
            plan.items.length,
            'Every draft must produce a result',
          );
          const after = snapshot(finance);
          assert.deepEqual(
            service.confirm(plan, requestId),
            result,
            'The same request must return the original receipt',
          );
          assert.equal(snapshot(finance), after, 'Retry must not duplicate data or audit entries');
        } else {
          assert.ok(plan.issues.length > 0, 'Uncertain plans must explain the missing information');
          assert.equal(
            service.confirm(plan, randomUUID()).saved,
            false,
            'An uncertain plan must not be written',
          );
          assert.equal(
            snapshot(finance),
            before,
            'Uncertain confirmation must leave the entire ledger unchanged',
          );
        }
        item.inspect(finance, plan);
        console.log(
          JSON.stringify({
            case: item.id,
            passed: true,
            duration_ms: Math.round(performance.now() - started),
          }),
        );
      } catch (error) {
        failures++;
        console.log(
          JSON.stringify({
            case: item.id,
            passed: false,
            duration_ms: Math.round(performance.now() - started),
            message: error instanceof Error ? error.message : 'Evaluation failed',
            ...(plan ? { synthetic_plan: plan } : {}),
          }),
        );
      } finally {
        finance.close();
      }
    }
  }
  await Promise.all(Array.from({ length: configuration.concurrency }, worker));
  console.log(
    JSON.stringify({
      evaluated: configuration.cases.length,
      passed: configuration.cases.length - failures,
      failed: failures,
      timeout_ms: configuration.timeoutMs,
      concurrency: configuration.concurrency,
    }),
  );
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.log(
    JSON.stringify({
      passed: false,
      message: error instanceof Error ? error.message : 'Evaluation setup failed',
    }),
  );
  process.exitCode = 1;
});
