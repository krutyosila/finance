import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { FinanceService } from './core/service';
import { PROJECT_ROOT } from './core/database';
import type { TransactionFilter } from '../shared/types';
import { backupDatabase, exportFinancialState, restoreDatabase } from './maintenance';

interface CliOptions {
  service?: FinanceService;
  databasePath?: string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}
interface Arguments {
  positionals: string[];
  flags: Record<string, string | boolean>;
  json: boolean;
}
function parseArguments(args: string[]): Arguments {
  const result: Arguments = { positionals: [], flags: {}, json: false };
  const valueFlags = new Set([
    'data',
    'json-input',
    'from',
    'to',
    'cycle-id',
    'search',
    'type',
    'currency',
    'category',
    'account-id',
    'scope',
    'name',
    'start',
    'end',
    'entity-id',
  ]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      result.json = true;
      continue;
    }
    if (arg === '--all') {
      result.flags.all = true;
      continue;
    }
    if (arg === '--deleted') {
      result.flags.deleted = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      result.flags.help = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const equals = arg.indexOf('=');
      const key = arg.slice(2, equals === -1 ? undefined : equals);
      if (!valueFlags.has(key)) throw new Error(`Bilinmeyen seçenek: --${key}`);
      const value = equals === -1 ? args[++i] : arg.slice(equals + 1);
      if (value === undefined || value.startsWith('--'))
        throw new Error(`--${key} için bir değer girin.`);
      result.flags[key] = value;
    } else result.positionals.push(arg);
  }
  return result;
}
function input(flags: Arguments['flags']): Record<string, unknown> {
  const raw = flags.data ?? flags['json-input'];
  if (typeof raw !== 'string')
    throw new Error('Alanları --data \'{"amount":"450.00",...}\' veya --json-input ile belirtin.');
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('--data geçerli JSON içermelidir.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('--data bir JSON nesnesi içermelidir.');
  return value as Record<string, unknown>;
}
function stringFlag(flags: Arguments['flags'], key: string): string | undefined {
  const value = flags[key];
  return typeof value === 'string' ? value : undefined;
}
function required(value: string | undefined, label = 'kayıt kimliği'): string {
  if (!value) throw new Error(`${label} belirtin.`);
  return value;
}
const help = {
  commands: [
    'add "450 market"',
    'add --data \'{"type":"EXPENSE","amount":"450","currency":"TRY","description":"Market"}\'',
    'parse "450 market"',
    'context | status | today | report [--all --from DATE --to DATE --cycle-id ID]',
    'transactions [--search TEXT --type TYPE --currency CODE --category NAME --account-id ID --scope PERSONAL|BUSINESS --from DATE --to DATE --deleted]',
    'edit ID --data JSON | delete ID | restore ID | duplicate ID',
    'accounts | debts | recurring | subscriptions',
    'accounts|debts|recurring|subscriptions create --data JSON',
    'accounts|debts|recurring|subscriptions edit ID --data JSON',
    'accounts|debts|recurring|subscriptions delete ID',
    'recurring|subscriptions pay ID --data JSON',
    'cycle start [--name NAME --start TIMESTAMP] | cycle end ID [--end TIMESTAMP] | cycles',
    'audit [--entity-id ID]',
    'backup | restore-backup PATH | export',
  ],
  options:
    '--json temiz JSON üretir; belirsiz ekleme kayıt yapmadan 2, hatalar 1 çıkış kodu döndürür.',
};

export async function runCli(args: string[], options: CliOptions = {}): Promise<number> {
  const stdout = options.stdout ?? ((text) => process.stdout.write(text));
  const stderr = options.stderr ?? ((text) => process.stderr.write(text));
  let json = args.includes('--json');
  let service: FinanceService | undefined = options.service;
  let ownsService = false;
  try {
    const parsed = parseArguments(args);
    json = parsed.json;
    const { flags } = parsed;
    const [command = 'help', action, id] = parsed.positionals;
    const print = (result: unknown) =>
      stdout(`${JSON.stringify(result ?? null, null, json ? undefined : 2)}\n`);
    if (command === 'help' || flags.help) {
      print(help);
      return 0;
    }
    const databasePath =
      options.databasePath ??
      process.env.FINANCE_DB ??
      resolve(PROJECT_ROOT, 'data/finance.sqlite');
    if (command === 'restore-backup') {
      if (service) service.close();
      print(
        await restoreDatabase(
          service?.databasePath ?? databasePath,
          required(action, 'Yedek yolu'),
        ),
      );
      return 0;
    }
    if (!service) {
      service = new FinanceService(databasePath);
      ownsService = true;
    }
    const finance = service;
    const period = {
      from: stringFlag(flags, 'from'),
      to: stringFlag(flags, 'to'),
      cycleId: stringFlag(flags, 'cycle-id'),
      all: flags.all === true,
    };
    let result: unknown;
    if (command === 'add') {
      if (flags.data || flags['json-input'])
        result = finance.createTransaction(input(flags) as never);
      else {
        const entry = finance.addText(
          required(parsed.positionals.slice(1).join(' '), 'Tırnak içinde işlem metni'),
        );
        print(entry);
        return entry.saved ? 0 : 2;
      }
    } else if (command === 'parse')
      result = finance.parse(
        required(parsed.positionals.slice(1).join(' '), 'Tırnak içinde işlem metni'),
      );
    else if (['context', 'status', 'report'].includes(command)) result = finance.getContext(period);
    else if (command === 'today') {
      const day = new Intl.DateTimeFormat('en-CA', {
        timeZone: process.env.FINANCE_TIMEZONE ?? 'Europe/Istanbul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      result = finance.getContext({ from: day, to: day });
    } else if (command === 'transactions' && !action) {
      const filter: TransactionFilter = { deleted: flags.deleted === true };
      for (const [flag, key] of [
        ['search', 'search'],
        ['type', 'type'],
        ['currency', 'currency'],
        ['category', 'category'],
        ['account-id', 'accountId'],
        ['from', 'from'],
        ['to', 'to'],
        ['scope', 'scope'],
      ] as const) {
        const value = stringFlag(flags, flag);
        if (value !== undefined) filter[key] = value;
      }
      result = finance.listTransactions(filter);
    } else if (['edit', 'delete', 'restore', 'duplicate'].includes(command)) {
      const transactionId = required(action);
      if (command === 'edit') result = finance.updateTransaction(transactionId, input(flags));
      if (command === 'delete') {
        finance.deleteTransaction(transactionId);
        result = { deleted: true, id: transactionId };
      }
      if (command === 'restore') result = finance.restoreTransaction(transactionId);
      if (command === 'duplicate') result = finance.duplicateTransaction(transactionId);
    } else if (command === 'tx' || (command === 'transactions' && action)) {
      const transactionId = required(id);
      if (action === 'edit') result = finance.updateTransaction(transactionId, input(flags));
      else if (action === 'delete') {
        finance.deleteTransaction(transactionId);
        result = { deleted: true, id: transactionId };
      } else if (action === 'restore') result = finance.restoreTransaction(transactionId);
      else if (action === 'duplicate') result = finance.duplicateTransaction(transactionId);
      else throw new Error('İşlem eylemi edit, delete, restore veya duplicate olmalıdır.');
    } else if (
      [
        'accounts',
        'account',
        'debts',
        'debt',
        'recurring',
        'subscriptions',
        'subscription',
      ].includes(command)
    ) {
      const entity =
        command === 'account'
          ? 'accounts'
          : command === 'debt'
            ? 'debts'
            : command === 'subscription'
              ? 'subscriptions'
              : command;
      const methods = {
        accounts: {
          list: () => finance.listAccounts(),
          create: (data: never) => finance.createAccount(data),
          edit: (key: string, data: never) => finance.updateAccount(key, data),
          delete: (key: string) => finance.deleteAccount(key),
        },
        debts: {
          list: () => finance.listDebts(),
          create: (data: never) => finance.createDebt(data),
          edit: (key: string, data: never) => finance.updateDebt(key, data),
          delete: (key: string) => finance.deleteDebt(key),
        },
        recurring: {
          list: () => finance.listObligations(),
          create: (data: never) => finance.createObligation(data),
          edit: (key: string, data: never) => finance.updateObligation(key, data),
          delete: (key: string) => finance.deleteObligation(key),
        },
        subscriptions: {
          list: () => finance.listSubscriptions(),
          create: (data: never) => finance.createSubscription(data),
          edit: (key: string, data: never) => finance.updateSubscription(key, data),
          delete: (key: string) => finance.deleteSubscription(key),
        },
      };
      const methodsForEntity = methods[entity as keyof typeof methods];
      if (!action || action === 'list') result = methodsForEntity.list();
      else if (action === 'create' || action === 'add')
        result = methodsForEntity.create(input(flags) as never);
      else if (action === 'edit' || action === 'update')
        result = methodsForEntity.edit(required(id), input(flags) as never);
      else if (action === 'delete') {
        methodsForEntity.delete(required(id));
        result = { deleted: true, id };
      } else if (action === 'pay' && entity === 'recurring')
        result = finance.payObligation(required(id), input(flags) as never);
      else if (action === 'pay' && entity === 'subscriptions')
        result = finance.paySubscription(required(id), input(flags) as never);
      else
        throw new Error(
          'Eylem list, create, edit, delete veya yükümlülük/abonelik için pay olmalıdır.',
        );
    } else if (command === 'cycles' && !action) result = finance.listCycles();
    else if (command === 'cycle' || command === 'cycles') {
      if (action === 'start')
        result = finance.startCycle({
          name: stringFlag(flags, 'name'),
          start: stringFlag(flags, 'start'),
        });
      else if (action === 'end') result = finance.endCycle(required(id), stringFlag(flags, 'end'));
      else if (!action || action === 'list') result = finance.listCycles();
      else throw new Error('Döngü eylemi start, end veya list olmalıdır.');
    } else if (command === 'audit')
      result = finance.listAudit(stringFlag(flags, 'entity-id') ?? action);
    else if (command === 'backup') result = { path: await backupDatabase(finance) };
    else if (command === 'export') result = await exportFinancialState(finance);
    else
      throw new Error(
        `Bilinmeyen komut: ${command}. Komutları görmek için npm run finance -- help çalıştırın.`,
      );
    print(result);
    return 0;
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'ZodError'
        ? 'Alanları kontrol edin: zorunlu alan, tür veya değer geçersiz.'
        : error instanceof Error
          ? error.message
          : 'Komut tamamlanamadı.';
    stderr(json ? `${JSON.stringify({ error: message })}\n` : `Hata: ${message}\n`);
    return 1;
  } finally {
    if (ownsService) service?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runCli(process.argv.slice(2));
}
