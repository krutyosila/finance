import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { request as httpRequest } from 'node:http';
import { FinanceService } from '../server/core/service';
import { createApp } from '../server/app';
import { runCli } from '../server/cli';

const roots: string[] = [];
const services: FinanceService[] = [];
const servers: Server[] = [];
function service() {
  const root = mkdtempSync(join(tmpdir(), 'finance-interface-'));
  roots.push(root);
  const result = new FinanceService(join(root, 'data', 'finance.sqlite'));
  services.push(result);
  return result;
}
async function api(finance: FinanceService) {
  const server = createApp(finance).listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No server address');
  return (path: string, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const headers = new Headers(init?.headers);
      if (!headers.has('host')) headers.set('host', 'localhost:4317');
      const request = httpRequest(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path,
          method: init?.method ?? 'GET',
          headers: Object.fromEntries(headers.entries()),
        },
        (response) => {
          let content = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            content += chunk;
          });
          response.on('end', () =>
            resolve(new Response(content, { status: response.statusCode ?? 500 })),
          );
          response.on('error', reject);
        },
      );
      request.on('error', reject);
      if (init?.body) request.write(init.body);
      request.end();
    });
}
async function cli(finance: FinanceService, args: string[]) {
  let stdout = '',
    stderr = '';
  const status = await runCli(args, {
    service: finance,
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });
  return { status, stdout, stderr };
}
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
  services.splice(0).forEach((finance) => finance.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

describe('shared API and CLI financial interfaces', () => {
  it('returns the same empty financial context through the service, API, and clean JSON CLI', async () => {
    const finance = service();
    const request = await api(finance);
    const context = finance.getContext();
    const response = await request('/api/ai/context');
    expect(response.status).toBe(200);
    const apiContext = await response.json();
    const command = await cli(finance, ['context', '--json']);
    expect(command.status).toBe(0);
    expect(command.stderr).toBe('');
    const cliContext = JSON.parse(command.stdout);
    for (const result of [apiContext, cliContext]) {
      expect(result.metrics).toEqual(context.metrics);
      expect(result.accounts).toEqual([]);
      expect(result.transactionCount).toBe(0);
    }
  });

  it('uses the same parser for API and CLI additions and never commits uncertain input', async () => {
    const finance = service();
    const request = await api(finance);
    const added = await request('/api/ai/transaction', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '450 market' }),
    });
    expect(added.status).toBe(201);
    expect((await added.json()).saved).toBe(true);
    const uncertain = await cli(finance, ['add', '450 gizemli', '--json']);
    expect(uncertain.status).toBe(2);
    expect(JSON.parse(uncertain.stdout).saved).toBe(false);
    expect(finance.listTransactions()).toHaveLength(1);
    const command = await cli(finance, ['add', '1500 ödeme geldi', '--json']);
    expect(command.status).toBe(0);
    const context = await (await request('/api/context')).json();
    expect(context.metrics).toEqual(finance.getContext().metrics);
  });

  it('supports structured CLI CRUD, soft deletion, restoration, and duplicate through one service', async () => {
    const finance = service();
    const added = await cli(finance, [
      'add',
      '--data',
      JSON.stringify({
        type: 'EXPENSE',
        amount: '10.25',
        currency: 'USD',
        description: 'Domain',
        category: 'Services',
      }),
      '--json',
    ]);
    expect(added.status).toBe(0);
    const transaction = JSON.parse(added.stdout);
    const updated = await cli(finance, [
      'edit',
      transaction.id,
      '--data',
      JSON.stringify({ amount: '12.00' }),
      '--json',
    ]);
    expect(JSON.parse(updated.stdout).amount).toBe('12.00');
    expect((await cli(finance, ['delete', transaction.id, '--json'])).status).toBe(0);
    expect(finance.listTransactions()).toHaveLength(0);
    expect((await cli(finance, ['restore', transaction.id, '--json'])).status).toBe(0);
    expect((await cli(finance, ['duplicate', transaction.id, '--json'])).status).toBe(0);
    expect(finance.listTransactions()).toHaveLength(2);
  });

  it('allows API and CLI reports to explicitly include activity before an active cycle', async () => {
    const finance = service();
    finance.createTransaction({
      type: 'INCOME',
      amount: '50',
      currency: 'TRY',
      description: 'Earlier income',
      timestamp: '2026-08-01T12:00:00Z',
    });
    finance.startCycle({ start: '2026-09-01T00:00:00Z' });
    const request = await api(finance);
    expect(finance.getContext().transactionCount).toBe(0);
    const context = await (await request('/api/reports?all=true')).json();
    expect(context.transactionCount).toBe(1);
    const command = await cli(finance, ['report', '--all', '--json']);
    expect(command.status).toBe(0);
    expect(JSON.parse(command.stdout).transactionCount).toBe(1);
  });

  it('rejects remote hosts and origins and reports validation errors as JSON', async () => {
    const finance = service();
    const request = await api(finance);
    expect(
      (await request('/api/context', { headers: { host: 'attacker.example:4317' } })).status,
    ).toBe(403);
    const remote = await request('/api/ai/transaction', {
      method: 'POST',
      headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
      body: JSON.stringify({ text: '450 market' }),
    });
    expect(remote.status).toBe(403);
    expect(finance.listTransactions()).toHaveLength(0);
    const invalid = await request('/api/transactions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toBeTypeOf('string');
    const unknown = await cli(finance, ['not-a-command', '--json']);
    expect(unknown.status).toBe(1);
    expect(JSON.parse(unknown.stderr).error).toBeTypeOf('string');
    expect(unknown.stdout).toBe('');
  });

  it('exposes account, debt, schedule, subscription, cycle and audit routes', async () => {
    const finance = service();
    const request = await api(finance);
    const create = async (path: string, body: unknown) => {
      const response = await request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(201);
      return response.json();
    };
    const account = await create('/api/accounts', {
      name: 'Bank',
      type: 'BANK',
      currency: 'TRY',
      openingBalance: '1000',
    });
    await create('/api/debts', {
      name: 'Loan',
      type: 'LOAN',
      currency: 'TRY',
      openingBalance: '250',
    });
    const obligation = await create('/api/recurring', {
      name: 'Internet',
      amount: '30',
      currency: 'TRY',
      frequency: 'MONTHLY',
      dueDate: '2026-09-30',
      accountId: account.id,
    });
    await create('/api/subscriptions', {
      service: 'Tools',
      amount: '12',
      currency: 'USD',
      frequency: 'YEARLY',
      nextRenewal: '2027-09-30',
    });
    const cycle = await create('/api/cycles', {
      name: 'My cycle',
      start: '2026-09-01T00:00:00.000Z',
    });
    const paid = await create(`/api/recurring/${obligation.id}/pay`, {
      type: 'EXPENSE',
      amount: '30',
      currency: 'TRY',
      description: 'Internet paid',
      accountId: account.id,
    });
    expect(paid.obligationId).toBe(obligation.id);
    const reports = await (await request(`/api/reports?cycleId=${cycle.id}`)).json();
    expect(reports.transactionCount).toBe(1);
    expect((await (await request('/api/audit')).json()).length).toBeGreaterThan(0);
    expect((await request('/api/health')).status).toBe(200);
  });
});
