import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

// The desktop bundle supplies Playwright; no app dependency or real financial data is needed.
const require = createRequire(import.meta.url);
const playwrightCandidates = [
  'playwright',
  process.env.PLAYWRIGHT_MODULE,
  join(
    homedir(),
    '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
  ),
].filter(Boolean);
let playwright;
for (const module of playwrightCandidates) {
  try {
    playwright = require(module);
    break;
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
  }
}
if (!playwright)
  throw new Error('Playwright is unavailable. Set PLAYWRIGHT_MODULE to an existing installation.');
const { chromium } = playwright;
const baseURL = process.env.MOBILE_QA_URL || 'http://127.0.0.1:5173';
const output = process.env.MOBILE_QA_OUTPUT || join(tmpdir(), 'finance-mobile-qa');
const baseline = process.argv.includes('--baseline');
const focusTheme = process.env.MOBILE_QA_FOCUS === 'theme';
const skipThemeWorkflow = process.env.MOBILE_QA_SKIP_THEME_WORKFLOW === '1';
const initialColorScheme = process.env.MOBILE_QA_THEME === 'dark' ? 'dark' : 'light';
const stamp = '2026-10-01T12:00:00.000Z';
const longName = 'UzunHesapAdıKesintisizSözcük'.repeat(3);
const longDescription = `İstanbul'daki iş ve kişisel giderlerin ayrıntılı açıklaması ${longName}`;
const total = { TRY: '123456789.99', USD: '23456789.99', EUR: '3456789.99', USDT: '456789.99' };
const cycle = {
  id: 'qa-cycle',
  name: `Ekim finansal dönemi ${longName}`,
  start: stamp,
  end: null,
  createdAt: stamp,
};
const accounts = [
  {
    id: 'qa-bank',
    name: longName,
    owner: 'QA örnek hesap sahibi',
    type: 'BANK',
    currency: 'TRY',
    openingBalance: '123456789.99',
    currentBalance: '123456789.99',
    currentDebt: null,
    creditLimit: null,
    notes: longDescription,
    createdAt: stamp,
    updatedAt: stamp,
  },
  {
    id: 'qa-card',
    name: `Kredi kartı ${longName}`,
    owner: 'QA',
    type: 'CREDIT_CARD',
    currency: 'USD',
    openingBalance: '0',
    currentBalance: '0',
    currentDebt: '23456789.99',
    creditLimit: '34567890.00',
    notes: longDescription,
    createdAt: stamp,
    updatedAt: stamp,
  },
  {
    id: 'qa-wallet',
    name: `Döviz cüzdanı ${longName}`,
    owner: 'QA',
    type: 'WALLET',
    currency: 'USD',
    openingBalance: '5000',
    currentBalance: '5000',
    currentDebt: null,
    creditLimit: null,
    notes: '',
    createdAt: stamp,
    updatedAt: stamp,
  },
];
const debts = ['LOAN', 'CREDIT_CARD'].map((type, i) => ({
  id: `qa-debt-${i}`,
  name: `Borç ${longName}`,
  type,
  currency: i ? 'USD' : 'TRY',
  openingBalance: '123456789.99',
  currentBalance: '123456789.99',
  payments: '12345678.99',
  newUsage: '23456789.99',
  interest: '2345678.99',
  fees: '345678.99',
  netChange: '456789.99',
  creditLimit: i ? '34567890.00' : null,
  accountId: i ? 'qa-card' : null,
  notes: longDescription,
  createdAt: stamp,
  updatedAt: stamp,
}));
const recurringObligations = ['UPCOMING', 'OVERDUE'].map((status, i) => ({
  id: `qa-recurring-${i}`,
  name: `Düzenli ödeme ${longName}`,
  amount: '123456789.99',
  currency: i ? 'USD' : 'TRY',
  frequency: 'MONTHLY',
  dueDate: '2026-10-05',
  category: longName,
  accountId: 'qa-bank',
  active: true,
  scope: i ? 'BUSINESS' : 'PERSONAL',
  status,
  createdAt: stamp,
  updatedAt: stamp,
}));
const subscriptions = ['UPCOMING', 'CANCELLED'].map((status, i) => ({
  id: `qa-subscription-${i}`,
  service: `Abonelik ${longName}`,
  amount: '123456789.99',
  currency: i ? 'USD' : 'TRY',
  frequency: 'YEARLY',
  nextRenewal: '2026-10-05',
  category: longName,
  accountId: 'qa-bank',
  active: !i,
  scope: 'PERSONAL',
  status,
  createdAt: stamp,
  updatedAt: stamp,
}));
const transactions = ['EXPENSE', 'INCOME', 'TRANSFER'].map((type, i) => ({
  id: `qa-transaction-${i}`,
  type,
  amount: '123456789.99',
  amountMinor: 12345678999,
  currency: i ? 'USD' : 'TRY',
  timestamp: stamp,
  amountTRY: i ? '3456789012.34' : '123456789.99',
  exchangeRate: i ? '32.1' : null,
  category: longName,
  description: longDescription,
  accountId: i ? 'qa-wallet' : 'qa-bank',
  destinationAccountId: type === 'TRANSFER' ? 'qa-bank' : null,
  destinationAmount: type === 'TRANSFER' ? '987654321.99' : null,
  debtId: null,
  notes: longDescription,
  counterparty: longName,
  paymentMethod: 'Banka',
  scope: i ? 'BUSINESS' : 'PERSONAL',
  createdAt: stamp,
  updatedAt: stamp,
  deletedAt: null,
}));
const metrics = Object.fromEntries(
  [
    'availableCash',
    'income',
    'expenses',
    'cashOutflow',
    'debt',
    'debtPayments',
    'debtUsage',
    'savings',
    'savingsAdded',
    'netCashFlow',
    'assets',
    'netFinancialPosition',
  ].map((key) => [key, total]),
);
const fixture = {
  generatedAt: stamp,
  currentCycle: cycle,
  accounts,
  balances: total,
  metrics,
  income: total,
  expenses: total,
  cashOutflow: total,
  debts,
  debtPayments: total,
  debtUsage: total,
  savings: total,
  subscriptions,
  recurringObligations,
  categoryTotals: [longName, 'Market', 'Kira', 'Diğer'].map((category) => ({
    category,
    totals: total,
  })),
  recentTransactions: transactions,
  netFinancialPosition: total,
  transactionCount: transactions.length,
  unassignedCash: total,
  charts: {
    daily: Array.from({ length: 7 }, (_, i) => ({
      date: `2026-10-0${i + 1}`,
      income: total,
      expenses: total,
      cashBalance: total,
      debtUsage: total,
      debtPayments: total,
    })),
  },
  period: { from: stamp, to: null },
  openingPosition: total,
  positionChange: total,
  scopeTotals: { PERSONAL: total, BUSINESS: total },
};
const pages = [
  'dashboard',
  'transactions',
  'accounts',
  'debts',
  'recurring',
  'subscriptions',
  'reports',
  'settings',
];
const titles = {
  transactions: 'İşlemler',
  accounts: 'Hesaplar',
  debts: 'Borçlar',
  recurring: 'Düzenli ödemeler',
  subscriptions: 'Abonelikler',
  reports: 'Raporlar',
  settings: 'Ayarlar',
};
const sizes = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 932, height: 430 },
  { width: 1280, height: 900 },
];
const mobileSize = (size) => size.width <= 900 || (size.width <= 1100 && size.height <= 500);
const only = process.env.MOBILE_QA_VIEWPORTS?.split(',');
const findings = [];
const results = [];
let currentSize = '';
let currentScreen = '';
let aiRequests = 0;
let logoutRequests = 0;

function check(condition, message, detail) {
  try {
    assert.ok(condition, message);
    results.push({ viewport: currentSize, screen: currentScreen, check: message, passed: true });
  } catch {
    findings.push({
      viewport: currentSize,
      screen: currentScreen,
      message,
      ...(detail ? { detail } : {}),
    });
  }
}

async function screenshot(page, name) {
  await page.screenshot({ path: `${output}/${currentSize}-${name}.png`, fullPage: false });
}

async function widths(page, name = currentScreen) {
  // Responsive charts update through ResizeObserver after layout changes.
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 3;
        const settle = () => (--frames ? requestAnimationFrame(settle) : resolve());
        requestAnimationFrame(settle);
      }),
  );
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('.recharts-responsive-container')].every((container) => {
          const surface = container.querySelector('svg.recharts-surface');
          return (
            !surface ||
            !container.clientWidth ||
            Math.abs(surface.getBoundingClientRect().width - container.clientWidth) <= 2
          );
        }),
      undefined,
      { timeout: 2000 },
    )
    .catch(() => {});
  const measurements = await page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const selectors =
      '.panel, .modal[open], .quick-entry, .quick-input-row, .report-table-wrap, .table-scroll, .report-tabs, .filter-grid, .form-grid, .ai-plan-item, .chart-tabs, .login-card, .auth-form-side';
    const overflow = [...document.querySelectorAll(selectors)]
      .filter(visible)
      .filter((el) => el.scrollWidth > el.clientWidth + 2)
      .map((el) => ({ selector: el.className, width: el.clientWidth, scroll: el.scrollWidth }));
    const controls = [
      ...document.querySelectorAll(
        'dialog[open] input, dialog[open] select, dialog[open] textarea, dialog[open] .button, .login-card input, .login-card button',
      ),
    ]
      .filter(visible)
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.left < -1 || rect.right > innerWidth + 1;
      })
      .map((el) => ({
        tag: el.tagName,
        label: el.closest('label')?.textContent,
        rect: el.getBoundingClientRect().toJSON(),
      }));
    return {
      width: innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      overflow,
      controls,
    };
  });
  check(
    measurements.document <= measurements.width + 2 && measurements.body <= measurements.width + 2,
    `${name}: document has no sideways scrolling`,
    measurements,
  );
  if (mobileSize(page.viewportSize()))
    check(
      !measurements.overflow.length,
      `${name}: panels and dialogs have no sideways scrolling`,
      measurements.overflow,
    );
  check(
    !measurements.controls.length,
    `${name}: modal controls fit the viewport`,
    measurements.controls,
  );
}

async function go(page, path) {
  currentScreen = path;
  await page.evaluate((path) => {
    location.hash = `/${path}`;
  }, path);
  if (path === 'dashboard') await page.locator('.dashboard-intro').waitFor({ timeout: 5000 });
  else
    await page
      .getByRole('heading', { name: titles[path], exact: true, level: 1 })
      .waitFor({ timeout: 5000 });
  if (path === 'transactions')
    await page.locator('.transaction-table tbody tr').first().waitFor({ timeout: 5000 });
  if (path === 'reports') await page.locator('.report-content').waitFor({ timeout: 5000 });
  if (path === 'settings') await page.locator('.settings-form').first().waitFor({ timeout: 5000 });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

async function close(page) {
  await page.keyboard.press('Escape');
  await page.locator('dialog[open]').waitFor({ state: 'hidden', timeout: 3000 });
}

async function headerGeometry(page, path, mobile) {
  const expectedPage = titles[path] || 'Genel bakış';
  const header = await page.locator('.topbar').evaluate((element) => {
    const brand = element.querySelector('.topbar-brand');
    const image = brand?.querySelector('img');
    const title = element.querySelector('.breadcrumb strong');
    const menu = element.querySelector('.mobile-menu-button');
    const rect = (node) => node?.getBoundingClientRect().toJSON();
    return {
      brand: rect(brand),
      image: image?.getAttribute('src'),
      brandText: brand?.textContent.trim(),
      title: rect(title),
      titleText: title?.textContent.trim(),
      menu: rect(menu),
      logoutCount: element.querySelectorAll('[aria-label="Çıkış yap"]').length,
      menuLogoutCount: document.querySelectorAll('.sidebar [aria-label="Çıkış yap"]').length,
    };
  });
  check(
    header.brand?.width > 0 &&
      header.image?.includes('/brand/kasa-mark') &&
      header.brandText === '' &&
      header.titleText === expectedPage &&
      header.brand.right <= header.title.left + 1,
    `${path}: header uses a mark followed by the current page name`,
    header,
  );
  if (mobile)
    check(
      header.menu?.width >= 44 &&
        header.menu.height >= 44 &&
        header.menu.left > header.title.right &&
        header.menu.right <= page.viewportSize().width + 1,
      `${path}: accessible menu button sits to the right of the page name`,
      header,
    );
  check(
    header.logoutCount === 0 && header.menuLogoutCount === 1,
    `${path}: hosted-session logout belongs to the navigation menu`,
    header,
  );
}

async function rightDrawerGeometry(page, mobile) {
  if (!mobile) return;
  const drawer = page.locator('.sidebar');
  const closed = await drawer.boundingBox();
  check(
    closed?.x >= page.viewportSize().width - 1,
    'closed mobile drawer rests outside the right edge',
    closed,
  );
  await page.getByRole('button', { name: 'Menüyü aç', exact: true }).click();
  await page.locator('.sidebar-open').waitFor();
  await page.waitForFunction(() => {
    const bounds = document.querySelector('.sidebar-open').getBoundingClientRect();
    return Math.abs(bounds.right - innerWidth) <= 1;
  });
  const open = await drawer.boundingBox();
  check(
    open.x > 0 &&
      Math.abs(open.x + open.width - page.viewportSize().width) <= 1 &&
      Math.abs(open.y) <= 1 &&
      Math.abs(open.height - page.viewportSize().height) <= 1,
    'mobile drawer opens against the right edge and fills the visible height',
    open,
  );
  check(
    await drawer.getByRole('button', { name: 'Çıkış yap', exact: true }).isVisible(),
    'logout remains reachable inside the open mobile drawer',
  );
  if (page.viewportSize().height >= 800) {
    await drawer.evaluate((element) => {
      element.scrollTop = 0;
    });
    const logout = await drawer
      .getByRole('button', { name: 'Çıkış yap', exact: true })
      .boundingBox();
    check(
      logout.y >= 0 && logout.y + logout.height <= page.viewportSize().height + 1,
      'logout is visible without scrolling the menu on a tall phone screen',
      logout,
    );
  }
}

async function themeSurface(page, selector) {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const opaqueBackground = (node) => {
        for (let parent = node; parent; parent = parent.parentElement) {
          const background = getComputedStyle(parent).backgroundColor;
          if (background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') return background;
        }
        return 'rgb(255, 255, 255)';
      };
      const rgb = (value) =>
        value
          .match(/[\d.]+/g)
          ?.slice(0, 3)
          .map(Number) || [0, 0, 0];
      const luminance = (value) => {
        const [red, green, blue] = rgb(value).map((component) => {
          const channel = component / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return red * 0.2126 + green * 0.7152 + blue * 0.0722;
      };
      const color = getComputedStyle(element).color;
      const background = opaqueBackground(element);
      const foregroundLuminance = luminance(color);
      const backgroundLuminance = luminance(background);
      return {
        color,
        background,
        contrast:
          (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
          (Math.min(foregroundLuminance, backgroundLuminance) + 0.05),
      };
    });
}

async function themeChrome(page, theme) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const appearance = await page.locator('.topbar').evaluate((element) => ({
    theme: document.documentElement.dataset.theme,
    scheme: getComputedStyle(document.documentElement).colorScheme,
    color: getComputedStyle(element).backgroundColor,
    rootColor: getComputedStyle(document.documentElement).backgroundColor,
    metadata: document.querySelector('meta[name="theme-color"]')?.content,
  }));
  const color = theme === 'dark' ? 'rgb(20, 35, 44)' : 'rgb(255, 255, 255)';
  const metadata = theme === 'dark' ? '#14232c' : '#ffffff';
  check(
    appearance.theme === theme &&
      appearance.scheme === theme &&
      appearance.color === color &&
      appearance.metadata === metadata,
    `${theme}: browser theme metadata and header use the same surface`,
    appearance,
  );
  check(
    appearance.rootColor === color,
    `${theme}: root background continues the header through the top cutout`,
    appearance,
  );
}

async function chooseTheme(page, preference, resolved) {
  await page
    .locator('.theme-option')
    .filter({
      has: page.locator(`input[name="theme"][value="${preference}"]`),
    })
    .click();
  await page.waitForFunction(
    (resolved) => document.documentElement.dataset.theme === resolved,
    resolved,
  );
  check(
    await page.locator(`input[name="theme"][value="${preference}"]`).isChecked(),
    `${preference}: appearance control reflects the selected preference`,
  );
}

async function verifyThemeWorkflow(page, mobile) {
  await page.emulateMedia({ colorScheme: 'light' });
  await go(page, 'settings');
  currentScreen = 'theme-settings';
  check(
    (await page.getByRole('radio').count()) === 3 &&
      (await page.locator('input[name="theme"][value="system"]').isChecked()),
    'appearance settings default to System with three native radio choices',
  );
  await themeChrome(page, 'light');
  await screenshot(page, 'theme-light-settings');
  if (mobile) {
    await rightDrawerGeometry(page, mobile);
    await screenshot(page, 'theme-light-right-menu');
    await page.keyboard.press('Escape');
    await page.locator('.sidebar-open').waitFor({ state: 'hidden' });
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  check(
    await page.locator('input[name="theme"][value="system"]').isChecked(),
    'runtime system theme change keeps the System preference selected',
  );
  await themeChrome(page, 'dark');
  await widths(page, 'dark appearance settings');
  await screenshot(page, 'theme-dark-settings');
  await chooseTheme(page, 'light', 'light');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  check(
    (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light' &&
      (await page.evaluate(() => localStorage.getItem('kasa-theme'))) === 'light',
    'manual Light survives an operating-system change and is saved on this browser',
  );
  await themeChrome(page, 'light');
  await chooseTheme(page, 'dark', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });

  // Hold only application scripts. The API fixture still handles every request through fallback.
  let releaseScripts;
  const scriptsHeld = new Promise((resolve) => {
    releaseScripts = resolve;
  });
  const holdApplicationScripts = async (route) => {
    const request = route.request();
    if (
      request.resourceType() === 'script' &&
      new URL(request.url()).pathname !== '/theme-bootstrap-v1.js'
    )
      await scriptsHeld;
    await route.fallback();
  };
  await page.route('**/*', holdApplicationScripts);
  try {
    await page.reload({ waitUntil: 'commit' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    const startup = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      color: document.querySelector('meta[name="theme-color"]')?.content,
      renderedApp: document.getElementById('root')?.childElementCount || 0,
    }));
    check(
      startup.theme === 'dark' && startup.color === '#14232c' && startup.renderedApp === 0,
      'saved Dark is applied by the external startup script before the app renders',
      startup,
    );
  } finally {
    releaseScripts();
    await page.unroute('**/*', holdApplicationScripts);
  }
  await go(page, 'settings');
  currentScreen = 'theme-dark-content';
  check(
    await page.locator('input[name="theme"][value="dark"]').isChecked(),
    'saved Dark selection is restored after reloading under a light system theme',
  );
  await themeChrome(page, 'dark');
  await headerGeometry(page, 'settings', mobile);
  await go(page, 'dashboard');
  const panel = await themeSurface(page, '.trend-panel h2');
  check(
    panel.background === 'rgb(20, 35, 44)' && panel.contrast >= 4.5,
    'dark dashboard panel text remains readable on the dark surface',
    panel,
  );
  await screenshot(page, 'theme-dark-dashboard');
  const chart = page.locator('.trend-panel .chart-canvas');
  await chart.scrollIntoViewIfNeeded();
  const chartBox = await chart.boundingBox();
  await page.mouse.move(chartBox.x + chartBox.width * 0.6, chartBox.y + chartBox.height * 0.4);
  await page.locator('.trend-panel .recharts-default-tooltip').waitFor({ state: 'visible' });
  const tooltip = await themeSurface(page, '.trend-panel .recharts-default-tooltip');
  const tooltipLabel = await themeSurface(page, '.trend-panel .recharts-tooltip-label');
  check(
    tooltip.background === 'rgb(20, 35, 44)' &&
      tooltip.contrast >= 4.5 &&
      tooltipLabel.contrast >= 4.5,
    'dark chart tooltip and date label remain readable on a dark surface',
    { tooltip, tooltipLabel },
  );
  await screenshot(page, 'theme-dark-chart-tooltip');
  await go(page, 'accounts');
  await page.getByRole('button', { name: 'Hesap ekle', exact: true }).click();
  await modalFits(page, 'dark account form', mobile);
  const modal = await themeSurface(page, 'dialog[open] h2');
  const input = await themeSurface(page, 'dialog[open] input');
  check(
    modal.background === 'rgb(20, 35, 44)' && modal.contrast >= 4.5 && input.contrast >= 4.5,
    'dark modal and form input text remain readable',
    { modal, input },
  );
  await screenshot(page, 'theme-dark-form');
  await close(page);
  if (mobile) {
    await rightDrawerGeometry(page, mobile);
    await screenshot(page, 'theme-dark-right-menu');
    await page.keyboard.press('Escape');
    await page.locator('.sidebar-open').waitFor({ state: 'hidden' });
  }
  await go(page, 'settings');
  await chooseTheme(page, 'system', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  check(
    await page.locator('input[name="theme"][value="system"]').isChecked(),
    'returning to System resumes following both runtime system theme changes',
  );
  const beforeLogout = logoutRequests;
  if (mobile) await page.getByRole('button', { name: 'Menüyü aç', exact: true }).click();
  await page.locator('.sidebar').getByRole('button', { name: 'Çıkış yap', exact: true }).click();
  await page.locator('.login-card').waitFor();
  await page.getByText('Çıkış yaptınız. Finansal alanınız kapatıldı.', { exact: true }).waitFor();
  check(
    logoutRequests === beforeLogout + 1 && (await page.locator('.main-shell').count()) === 0,
    'menu logout makes one mocked logout request and closes the financial workspace',
  );
  await screenshot(page, 'theme-menu-logout');
  await page.reload();
  await go(page, 'dashboard');
  await page.emulateMedia({ colorScheme: initialColorScheme });
  await page.waitForFunction(
    (theme) => document.documentElement.dataset.theme === theme,
    initialColorScheme,
  );
  await themeChrome(page, initialColorScheme);
}

function selectField(page, label) {
  return page
    .locator('dialog[open] .field')
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator('select');
}

async function modalFits(page, name, mobile) {
  await page.locator('dialog[open]').waitFor({ timeout: 3000 });
  await widths(page, name);
  const rect = await page
    .locator('dialog[open]')
    .evaluate((el) => el.getBoundingClientRect().toJSON());
  const viewport = page.viewportSize();
  check(
    rect.left >= -1 &&
      rect.top >= -1 &&
      rect.right <= viewport.width + 1 &&
      rect.bottom <= viewport.height + 1,
    `${name}: modal stays within visible viewport`,
    rect,
  );
  if (mobile)
    check(
      rect.width >= viewport.width - 2 && rect.height >= viewport.height - 2,
      `${name}: modal fills the mobile viewport`,
      rect,
    );
  const footer = page.locator('dialog[open] .form-footer .button').last();
  if (await footer.count()) {
    await footer.scrollIntoViewIfNeeded();
    const bounds = await footer.boundingBox();
    check(
      bounds.y >= -1 && bounds.y + bounds.height <= viewport.height + 1,
      `${name}: footer actions can be reached by vertical scrolling`,
      bounds,
    );
  }
}

async function verifyEntry(page, mobile) {
  currentScreen = 'quick-entry';
  const fab = page.locator('.quick-add-fab');
  check((await fab.count()) === 1, 'one themed + opens AI entry');
  if (!(await fab.count())) return;
  check(
    (await page.locator('textarea').count()) === 0,
    'AI textarea appears only inside the opened modal',
  );
  const design = await fab.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const css = getComputedStyle(el);
    return {
      width: rect.width,
      height: rect.height,
      radius: css.borderRadius,
      label: el.getAttribute('aria-label'),
    };
  });
  check(
    Math.abs(design.width - design.height) <= 1 && parseFloat(design.radius) >= design.width / 2,
    'AI + is circular',
    design,
  );
  check(design.label === 'Yapay zekâ ile kayıt ekle', 'AI + has an accessible action name', design);
  await fab.click();
  await modalFits(page, 'AI input', mobile);
  check(
    (await page.getByRole('heading', { name: 'Bir not ekleyin', exact: true }).count()) === 1,
    'AI + opens the note modal',
  );
  const textarea = page.locator('.quick-input-row textarea');
  const preview = page.getByRole('button', {
    name: 'Yapay zekâ ile kayıtları önizle',
    exact: true,
  });
  check(await preview.isDisabled(), 'empty note cannot be submitted');
  if (mobile) {
    const boxes = await page.locator('.quick-input-row').evaluate((el) => {
      const input = el.querySelector('textarea').getBoundingClientRect();
      const button = el.querySelector('button').getBoundingClientRect();
      const content = el.getBoundingClientRect();
      return { input: input.toJSON(), button: button.toJSON(), content: content.toJSON() };
    });
    check(
      Math.abs(boxes.input.width - boxes.content.width) <= 2 &&
        Math.abs(boxes.button.width - boxes.content.width) <= 2 &&
        boxes.button.top >= boxes.input.bottom - 1,
      'mobile AI textarea and preview button use the full width in a vertical layout',
      boxes,
    );
  }
  await screenshot(page, 'ai-entry');
  await close(page);
  check(
    await fab.evaluate((el) => document.activeElement === el),
    'Escape closes AI entry and returns focus to +',
  );
  await fab.click();
  await textarea.fill('QA_ERROR');
  await preview.click();
  await page.getByRole('alert').waitFor({ timeout: 3000 });
  await widths(page, 'AI error');
  await textarea.fill(longDescription);
  const before = aiRequests;
  await preview.click();
  await page.locator('.ai-plan-review').waitFor({ timeout: 3000 });
  check(aiRequests === before + 1, 'one preview click makes one mocked AI request');
  await modalFits(page, 'AI preview', mobile);
  check(
    (await page.locator('.ai-plan-item').count()) === 6,
    'AI preview renders every supported record type',
  );
  await screenshot(page, 'ai-preview');
  await close(page);
  await fab.click();
  await page.locator('.quick-manual button').click();
  await modalFits(page, 'manual transaction', mobile);
  for (const type of ['TRANSFER', 'DEBT_PAYMENT', 'SAVINGS', 'EXPENSE']) {
    await selectField(page, 'İşlem türü').selectOption(type);
    await selectField(page, 'Para birimi').selectOption('USD');
    await widths(page, `manual ${type}`);
  }
  await page.locator('.advanced-toggle').click();
  await widths(page, 'manual advanced fields');
  await screenshot(page, 'manual-transaction');
  await close(page);
}

async function verifyForms(page, mobile) {
  for (const [path, label] of [
    ['accounts', 'Hesap ekle'],
    ['debts', 'Borç ekle'],
    ['recurring', 'Düzenli ödeme ekle'],
    ['subscriptions', 'Abonelik ekle'],
  ]) {
    await go(page, path);
    await page.getByRole('button', { name: label, exact: true }).click();
    await modalFits(page, `${path} form`, mobile);
    if (path === 'accounts' || path === 'debts') {
      await selectField(page, 'Tür').selectOption('CREDIT_CARD');
      await widths(page, `${path} credit form`);
    }
    await screenshot(page, `${path}-form`);
    await close(page);
  }
  await go(page, 'reports');
  await page.getByRole('button', { name: 'Aktif dönemi bitir', exact: true }).click();
  await modalFits(page, 'cycle form', mobile);
  await close(page);
  await go(page, 'transactions');
  await page.getByRole('button', { name: 'İşlem geçmişini gör', exact: true }).first().click();
  await page.locator('.history-content').waitFor({ timeout: 3000 });
  await modalFits(page, 'history', mobile);
  await close(page);
  await page.getByRole('button', { name: 'İşlemi sil', exact: true }).first().click();
  await modalFits(page, 'delete confirmation', mobile);
  await close(page);
}

async function verifyVisualViewportKeyboard(page, mobile) {
  await go(page, 'dashboard');
  await page.locator('.quick-add-fab').click();
  const layoutHeight = await page.evaluate(() => innerHeight);
  await page.evaluate(() => {
    const viewport = window.visualViewport;
    Object.defineProperties(viewport, {
      height: { configurable: true, value: 320 },
      offsetTop: { configurable: true, value: 100 },
    });
    viewport.dispatchEvent(new Event('resize'));
  });
  try {
    await widths(page, 'keyboard visual viewport');
    const rect = await page.locator('dialog[open]').boundingBox();
    check(
      rect.y >= 99 && rect.y + rect.height <= 421,
      'keyboard visual viewport keeps the modal within the visible vertical region',
      rect,
    );
    check(
      (await page.evaluate(() => innerHeight)) === layoutHeight,
      'keyboard check shrinks only the visual viewport, retaining the layout viewport',
    );
    if (mobile)
      check(
        Math.abs(rect.height - 320) <= 2,
        'mobile modal fills the keyboard visual viewport',
        rect,
      );
  } finally {
    await page.evaluate(() => {
      const viewport = window.visualViewport;
      delete viewport.height;
      delete viewport.offsetTop;
      viewport.dispatchEvent(new Event('resize'));
    });
    await close(page);
  }
}

async function mobileDockGeometry(page) {
  return page.evaluate(() => {
    const nav = document.querySelector('.mobile-bottom-nav');
    const fab = nav.querySelector('.quick-add-fab');
    return {
      nav: nav.getBoundingClientRect().toJSON(),
      fab: fab.getBoundingClientRect().toJSON(),
      plusGlyph: fab.querySelector('svg').getBoundingClientRect().toJSON(),
      links: [...nav.querySelectorAll('a')].map((link) => ({
        ...link.getBoundingClientRect().toJSON(),
        radius: getComputedStyle(link).borderRadius,
        glyph: link.querySelector('svg').getBoundingClientRect().toJSON(),
      })),
    };
  });
}

function checkMobileDockGeometry(dock, size, safe = { left: 0, right: 0, bottom: 0 }) {
  const centerX = (size.width + safe.left - safe.right) / 2;
  const midpoint = (box) => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 });
  const near = (a, b) => Math.abs(a - b) <= 1;
  const navCenter = midpoint(dock.nav);
  const plusCenter = midpoint(dock.fab);
  const availableWidth = size.width - 36 - safe.left - safe.right;
  check(
    near(dock.nav.width, Math.min(286, availableWidth)) &&
      near(dock.nav.height, 60) &&
      near(navCenter.x, centerX) &&
      near(dock.nav.bottom, size.height - 22 - safe.bottom),
    'compact 60px pill stays centered and reserves the approved bottom clearance',
    { dock, size, safe },
  );
  check(
    dock.links.length === 4 &&
      dock.links.every(
        (link) =>
          link.width >= 44 &&
          link.width <= 50.5 &&
          near(link.width, link.height) &&
          near(link.width, dock.links[0].width) &&
          (availableWidth < 280 || near(link.width, 50)) &&
          near(midpoint(link).y, navCenter.y) &&
          link.radius === '50%' &&
          near(link.glyph.width, 28) &&
          near(link.glyph.height, 28),
      ),
    'four equal circular navigation targets keep 28px glyphs and at least44px touch areas',
    dock,
  );
  check(
    dock.fab.width >= 64 &&
      dock.fab.width <= 68.5 &&
      near(dock.fab.width, dock.fab.height) &&
      (availableWidth < 256 || near(dock.fab.width, 68)) &&
      near(plusCenter.x, navCenter.x) &&
      near(plusCenter.y, navCenter.y) &&
      dock.fab.top < dock.nav.top &&
      dock.fab.bottom > dock.nav.bottom &&
      near(dock.nav.top - dock.fab.top, dock.fab.bottom - dock.nav.bottom) &&
      near(dock.plusGlyph.width, 32) &&
      near(dock.plusGlyph.height, 32),
    'larger central+ is centered in both axes with symmetric protrusion and a32px glyph',
    dock,
  );
  check(
    dock.links[0].left >= dock.nav.left &&
      dock.links[3].right <= dock.nav.right &&
      dock.links[0].right <= dock.links[1].left + 1 &&
      dock.links[1].right <= dock.fab.left + 1 &&
      dock.fab.right <= dock.links[2].left + 1 &&
      dock.links[2].right <= dock.links[3].left + 1 &&
      near((midpoint(dock.links[0]).x + midpoint(dock.links[3]).x) / 2, navCenter.x) &&
      near((midpoint(dock.links[1]).x + midpoint(dock.links[2]).x) / 2, navCenter.x) &&
      dock.fab.bottom <= size.height - 18 - safe.bottom + 1 &&
      dock.fab.bottom >= size.height - 20 - safe.bottom - 1,
    'symmetric menu targets do not overlap and the lowest+edge keeps18–20px screen clearance',
    { dock, size, safe },
  );
}

async function verifyMobileDockViewport(page, mobile) {
  if (!mobile) return;
  await go(page, 'dashboard');
  const layoutHeight = await page.evaluate(() => innerHeight);
  const dock = async (height, offsetTop, scale = 1) => {
    await page.evaluate(
      ({ height, offsetTop, scale }) => {
        Object.defineProperties(window.visualViewport, {
          height: { configurable: true, value: height },
          offsetTop: { configurable: true, value: offsetTop },
          scale: { configurable: true, value: scale },
        });
        window.visualViewport.dispatchEvent(new Event('resize'));
        window.visualViewport.dispatchEvent(new Event('scroll'));
      },
      { height, offsetTop, scale },
    );
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    return page.evaluate(() => {
      const nav = document.querySelector('.mobile-bottom-nav').getBoundingClientRect();
      const fab = document.querySelector('.quick-add-fab').getBoundingClientRect();
      return { nav: nav.toJSON(), fab: fab.toJSON(), innerHeight };
    });
  };
  try {
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.id = 'viewport-qa-input';
      input.style.cssText = 'position:fixed;top:10px;left:10px;width:100px;opacity:0';
      document.body.append(input);
      input.focus({ preventScroll: true });
    });
    const keyboard = await dock(320, 100);
    check(
      Math.abs(keyboard.nav.bottom - 398) <= 2 &&
        Math.abs((keyboard.fab.left + keyboard.fab.right) / 2 - page.viewportSize().width / 2) <=
          2 &&
        Math.abs(
          (keyboard.fab.top + keyboard.fab.bottom - keyboard.nav.top - keyboard.nav.bottom) / 2,
        ) <= 1 &&
        Math.abs(keyboard.fab.bottom - 402) <= 2,
      'mobile dock follows the visible keyboard viewport independently of layout height',
      keyboard,
    );
    const restored = await dock(layoutHeight - 60, 30);
    check(
      Math.abs(restored.nav.bottom - (layoutHeight - 52)) <= 2,
      'mobile dock returns to the visible bottom after keyboard dismissal and toolbar changes',
      restored,
    );
    check(restored.innerHeight === layoutHeight, 'dock check retains the layout viewport');
    const focusedDismissal = await dock(layoutHeight, 100);
    check(
      Math.abs(focusedDismissal.nav.bottom - (layoutHeight - 22)) <= 2,
      'keyboard dismissal clears the old pan while the input remains focused',
      focusedDismissal,
    );
    await page.evaluate(() => document.getElementById('viewport-qa-input').remove());
    const loginDismissal = await dock(Math.max(100, layoutHeight - 315), 0);
    check(
      Math.abs(loginDismissal.nav.bottom - (layoutHeight - 22)) <= 2,
      'unmounting a focused login field recovers stale keyboard-height geometry',
      loginDismissal,
    );
    const zoomed = await dock(layoutHeight / 2, 100, 2);
    check(
      Math.abs(zoomed.nav.bottom - (layoutHeight - 22)) <= 2,
      'pinch zoom retains native fixed positioning instead of shrinking the navigation',
      zoomed,
    );
  } finally {
    await page.evaluate(() => {
      document.getElementById('viewport-qa-input')?.remove();
      delete window.visualViewport.height;
      delete window.visualViewport.offsetTop;
      delete window.visualViewport.scale;
      window.visualViewport.dispatchEvent(new Event('resize'));
    });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  }
}

async function verifyDockBreakpointFocus(page) {
  const originalSize = page.viewportSize();
  try {
    for (const [from, to] of [
      [
        { width: 1024, height: 768 },
        { width: 1024, height: 480 },
      ],
      [
        { width: 1024, height: 480 },
        { width: 1024, height: 768 },
      ],
    ]) {
      await page.setViewportSize(from);
      await go(page, 'dashboard');
      await page.evaluate(() => scrollTo(0, 200));
      await page.locator('.quick-add-fab').click();
      await page.locator('dialog[open]').waitFor();
      await page.setViewportSize(to);
      await page.waitForFunction(
        (mobile) => !!document.querySelector('.mobile-bottom-nav .quick-add-fab') === mobile,
        mobileSize(to),
      );
      const beforeClose = await page.evaluate(() => scrollY);
      await close(page);
      const restored = await page.evaluate(() => ({
        correct: document.activeElement === document.querySelector('.quick-add-fab'),
        connected: document.activeElement?.isConnected,
        scrollY,
      }));
      check(
        restored.correct && restored.connected,
        'closing AI entry after a dock breakpoint change focuses the replacement +',
        { from, to, restored },
      );
      check(
        restored.scrollY === beforeClose,
        'restoring + focus after a dock breakpoint change preserves page scroll',
        { from, to, beforeClose, restored },
      );
    }
  } finally {
    await page.setViewportSize(originalSize);
    await go(page, 'dashboard');
  }
}

async function simulateDisplayMode(page, initialMode) {
  await page.addInitScript((initialMode) => {
    const nativeMatchMedia = window.matchMedia.bind(window);
    const displayQueries = new Set();
    let displayMode = initialMode;
    window.matchMedia = (query) => {
      const media = nativeMatchMedia(query);
      const modes = query
        .split(',')
        .map((part) => part.match(/^\s*\(\s*display-mode\s*:\s*([\w-]+)\s*\)\s*$/)?.[1]);
      if (modes.some((mode) => !mode)) return media;
      Object.defineProperty(media, 'matches', { get: () => modes.includes(displayMode) });
      displayQueries.add({ media, modes });
      return media;
    };
    window.__mobileQaSetDisplayMode = (nextMode) => {
      const previousMode = displayMode;
      displayMode = nextMode;
      for (const { media, modes } of displayQueries) {
        if (modes.includes(previousMode) !== media.matches)
          media.dispatchEvent(
            new MediaQueryListEvent('change', { matches: media.matches, media: media.media }),
          );
      }
    };
  }, initialMode);
}

async function verifyFullscreenInstall(browser, size, mobile) {
  currentScreen = 'pwa-install';
  for (const initialMode of ['fullscreen', 'browser']) {
    const context = await browser.newContext({
      viewport: size,
      isMobile: mobile,
      hasTouch: mobile,
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
      colorScheme: initialColorScheme,
    });
    await context.route('**/api/**', routeAPI);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(3500);
      page.on('pageerror', (error) =>
        findings.push({
          viewport: currentSize,
          screen: currentScreen,
          message: `Browser exception: ${error.message}`,
        }),
      );
      await simulateDisplayMode(page, initialMode);
      await page.goto(baseURL);
      await go(page, 'settings');
      currentScreen = 'pwa-install';
      if (mobile) await page.getByRole('button', { name: 'Menüyü aç', exact: true }).click();
      await page.locator('.workspace-button').click();
      const panel = page.locator('dialog[open] .install-panel');
      await panel.waitFor();
      const installed = panel.getByRole('heading', {
        name: 'Kasa uygulaması kurulu',
        exact: true,
      });
      if (initialMode === 'browser') {
        check(
          await panel
            .getByRole('heading', { name: 'Kasa her ekranda yanınızda', exact: true })
            .isVisible(),
          'browser mode initially offers installation guidance',
          await panel.innerText(),
        );
        await page.evaluate(() => window.__mobileQaSetDisplayMode('fullscreen'));
      }
      await installed.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
      check(
        (await installed.isVisible()) &&
          (await panel.locator('.install-instruction, button').count()) === 0,
        initialMode === 'fullscreen'
          ? 'initial fullscreen display mode shows installed status without installation guidance'
          : 'browser to fullscreen display-mode change shows installed status without installation guidance',
        await panel.innerText(),
      );
      await screenshot(
        page,
        initialMode === 'fullscreen' ? 'pwa-fullscreen' : 'pwa-browser-to-fullscreen',
      );
    } finally {
      await context.close();
    }
  }
}

async function routeAPI(route) {
  const url = new URL(route.request().url());
  const path = url.pathname.replace(/^\/api/, '');
  let data;
  let status = 200;
  if (path === '/auth/session')
    data = {
      required: true,
      authenticated: true,
      user: { email: 'mobile-qa@example.test', role: 'ADMIN' },
    };
  else if (path === '/auth/logout') {
    logoutRequests++;
    data = { ok: true };
  } else if (path === '/context' || path === '/reports') data = fixture;
  else if (path === '/transactions') data = transactions;
  else if (path === '/cycles') data = [cycle, { ...cycle, id: 'qa-previous-cycle', end: stamp }];
  else if (path === '/settings/ai')
    data = { provider: 'openai', configured: true, model: 'gpt-5.4-mini' };
  else if (path === '/ai/entry') {
    aiRequests++;
    const text = route.request().postDataJSON()?.text || '';
    if (text === 'QA_ERROR') {
      status = 503;
      data = { error: `Örnek bağlantı hatası: ${longName}` };
    } else
      data = {
        text,
        certain: true,
        issues: [],
        items: [
          {
            key: 'account',
            kind: 'account',
            data: {
              name: longName,
              type: 'BANK',
              currency: 'USD',
              openingBalance: '123456789.99',
              notes: longDescription,
            },
          },
          {
            key: 'transaction',
            kind: 'transaction',
            data: {
              type: 'TRANSFER',
              amount: '123456789.99',
              currency: 'USD',
              accountId: '@account',
              destinationAccountId: 'qa-bank',
              destinationAmount: '987654321.99',
              description: longDescription,
              timestamp: stamp,
              notes: longDescription,
            },
          },
          {
            key: 'debt',
            kind: 'debt',
            data: { name: longName, type: 'LOAN', currency: 'TRY', openingBalance: '123456789.99' },
          },
          {
            key: 'recurring',
            kind: 'obligation',
            data: {
              name: longName,
              amount: '123456789.99',
              currency: 'TRY',
              frequency: 'MONTHLY',
              dueDate: '2026-10-05',
              category: longName,
            },
          },
          {
            key: 'subscription',
            kind: 'subscription',
            data: {
              service: longName,
              amount: '123456789.99',
              currency: 'USD',
              frequency: 'YEARLY',
              nextRenewal: '2026-10-05',
            },
          },
          { key: 'cycle', kind: 'cycle', data: { name: longName, start: stamp } },
        ],
      };
  } else if (path.startsWith('/audit'))
    data = [
      {
        id: 'qa-audit',
        entity: 'transaction',
        entityId: transactions[0].id,
        action: 'CREATE',
        before: null,
        after: transactions[0],
        timestamp: stamp,
      },
    ];
  else {
    findings.push({
      viewport: currentSize,
      screen: currentScreen,
      message: `Unmocked API request: ${route.request().method()} ${path}`,
    });
    status = 500;
    data = { error: `QA fixture missing: ${path}` };
  }
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
}

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const size of sizes.filter(
    (size) => !only || only.includes(`${size.width}x${size.height}`),
  )) {
    currentSize = `${size.width}x${size.height}`;
    const mobile = mobileSize(size);
    const context = await browser.newContext({
      viewport: size,
      deviceScaleFactor: 1,
      isMobile: mobile,
      hasTouch: mobile,
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
      colorScheme: initialColorScheme,
    });
    await context.route('**/api/**', routeAPI);
    const page = await context.newPage();
    page.setDefaultTimeout(3500);
    page.on('pageerror', (error) =>
      findings.push({
        viewport: currentSize,
        screen: currentScreen,
        message: `Browser exception: ${error.message}`,
      }),
    );
    const step = async (name, fn) => {
      try {
        await fn();
      } catch (error) {
        findings.push({
          viewport: currentSize,
          screen: currentScreen,
          message: `${name}: ${error.message}`,
        });
        await screenshot(page, `failure-${name.replace(/[^a-z0-9-]/gi, '-')}`).catch(() => {});
        await page.keyboard.press('Escape').catch(() => {});
      }
    };
    await step('load', async () => {
      await page.goto(baseURL);
      await page.locator('.dashboard-intro').waitFor({ timeout: 10000 });
      const viewportMeta = await page.locator('meta[name=viewport]').getAttribute('content');
      check(viewportMeta.includes('viewport-fit=cover'), 'viewport includes cutout support');
    });
    if (focusTheme) {
      await step('theme', () => verifyThemeWorkflow(page, mobile));
      console.log(
        `${currentSize}: ${results.filter((x) => x.viewport === currentSize).length} assertions, ${findings.filter((x) => x.viewport === currentSize).length} findings`,
      );
      await context.close();
      continue;
    }
    for (const path of pages) {
      await step(path, async () => {
        await go(page, path);
        if (!baseline) await headerGeometry(page, path, mobile);
        await widths(page);
        check(
          (await page.locator('main textarea').count()) === 0 || path === 'settings',
          `${path}: AI note is absent from the page`,
        );
        if (path === 'transactions') {
          await page.getByRole('button', { name: 'Filtreler', exact: true }).click();
          await widths(page, 'transaction filters');
        }
        if (path === 'reports') {
          for (const name of [
            'Nakit akışı',
            'Gelir',
            'Harcamalar',
            'Borç',
            'Planlı giderler',
            'Kategoriler',
            'İş ve kişisel',
            'Genel bakış',
          ]) {
            await page.locator('.report-tabs').getByRole('button', { name, exact: true }).click();
            await widths(page, `report ${name}`);
            if (['Borç', 'Planlı giderler', 'Kategoriler'].includes(name))
              await screenshot(
                page,
                `report-${['Borç', 'Planlı giderler', 'Kategoriler'].indexOf(name)}`,
              );
          }
          await page.locator('.report-controls select').selectOption('');
          await widths(page, 'custom report dates');
          await page.locator('.report-controls select').selectOption(cycle.id);
        }
        await screenshot(page, path);
        if (mobile && !baseline) {
          const nav = page.locator('.mobile-bottom-nav');
          check(await nav.isVisible(), `${path}: bottom navigation is visible`);
          if (await nav.isVisible()) {
            const labels = await nav.locator('a').allTextContents();
            check(
              JSON.stringify(labels.map((x) => x.trim())) ===
                JSON.stringify(['Genel bakış', 'İşlemler', 'Hesaplar', 'Raporlar']),
              'bottom navigation has the four requested destinations',
              labels,
            );
            await nav.getByRole('link', { name: 'Genel bakış', exact: true }).click();
            await page.locator('.dashboard-intro').waitFor();
            check(
              new URL(page.url()).hash === '#/dashboard',
              `${path}: bottom home returns to dashboard`,
            );
          }
        }
      });
    }
    await step('entry', () => verifyEntry(page, mobile));
    await step('forms', () => verifyForms(page, mobile));
    if (mobile && !baseline)
      await step('mobile-dock-geometry', async () => {
        await go(page, 'dashboard');
        checkMobileDockGeometry(await mobileDockGeometry(page), size);
      });
    if (!baseline) await step('mobile-dock-viewport', () => verifyMobileDockViewport(page, mobile));
    if (!baseline && size.width === 390 && size.height === 844)
      await step('dock-breakpoint-focus', () => verifyDockBreakpointFocus(page));
    if (!baseline && !skipThemeWorkflow && [390, 1280].includes(size.width))
      await step('theme', () => verifyThemeWorkflow(page, mobile));
    if (mobile && !baseline)
      await step('drawer', async () => {
        await go(page, 'dashboard');
        const menu = page.locator('.mobile-menu-button');
        await rightDrawerGeometry(page, mobile);
        for (let i = 0; i < 15; i++) await page.keyboard.press('Tab');
        check(
          await page.evaluate(() => !!document.activeElement.closest('.sidebar')),
          'mobile drawer keeps keyboard focus in the menu',
        );
        await page.keyboard.press('Escape');
        await page.locator('.sidebar-open').waitFor({ state: 'hidden' });
        check(
          await menu.evaluate((el) => document.activeElement === el),
          'Escape closes drawer and returns focus to menu',
        );
      });
    if (size.width === 390 && !baseline)
      await step('orientation-keyboard', async () => {
        await go(page, 'dashboard');
        await page.locator('.quick-add-fab').click();
        await page.setViewportSize({ width: 844, height: 390 });
        await modalFits(page, 'phone rotated to landscape', true);
        await page.setViewportSize({ width: 390, height: 320 });
        await modalFits(page, 'reduced viewport while entering a note', true);
        await page.setViewportSize(size);
        await close(page);
        await widths(page, 'portrait restored');
      });
    if ([390, 1280].includes(size.width) && !baseline)
      await step('keyboard-visual-viewport', () => verifyVisualViewportKeyboard(page, mobile));
    if (mobile && !baseline)
      await step('safe-areas', async () => {
        await go(page, 'dashboard');
        await page.addStyleTag({
          content:
            ':root { --safe-top: 28px; --safe-right: 18px; --safe-bottom: 24px; --safe-left: 18px; }',
        });
        await widths(page, 'simulated cutouts');
        const safe = await page.evaluate(() => {
          const rect = (selector) =>
            document.querySelector(selector)?.getBoundingClientRect().toJSON();
          const rules = [];
          const collect = (list) => {
            for (const rule of list) {
              if (rule.cssRules) collect(rule.cssRules);
              if (rule.selectorText === '.topbar' || rule.selectorText === '.mobile-bottom-nav')
                rules.push(rule.cssText);
            }
          };
          for (const sheet of document.styleSheets) collect(sheet.cssRules);
          return {
            topbar: rect('.topbar'),
            logo: rect('.topbar-brand'),
            menu: rect('.mobile-menu-button'),
            nav: rect('.mobile-bottom-nav'),
            fab: rect('.quick-add-fab'),
            paddingTop: parseFloat(getComputedStyle(document.querySelector('.topbar')).paddingTop),
            navPaddingBottom: parseFloat(
              getComputedStyle(document.querySelector('.mobile-bottom-nav')).paddingBottom,
            ),
            variables: ['--safe-top', '--safe-right', '--safe-bottom', '--safe-left'].map((key) => [
              key,
              getComputedStyle(document.documentElement).getPropertyValue(key),
            ]),
            topbarSafeTop: getComputedStyle(document.querySelector('.topbar')).getPropertyValue(
              '--safe-top',
            ),
            rules,
          };
        });
        check(
          safe.paddingTop >= 28 &&
            Math.abs(safe.topbar.top) <= 1 &&
            safe.logo.top >= 28 - 1 &&
            safe.menu.top >= 28 - 1 &&
            safe.nav.bottom <= size.height - 22 - 24 + 1 &&
            safe.nav.left >= 18 + 18 - 1 &&
            safe.nav.right <= size.width - 18 - 18 + 1,
          'header and bottom navigation reserve simulated safe areas',
          safe,
        );
        await themeChrome(page, await page.evaluate(() => document.documentElement.dataset.theme));
        checkMobileDockGeometry(await mobileDockGeometry(page), size, {
          left: 18,
          right: 18,
          bottom: 24,
        });
        await page.locator('.quick-add-fab').click();
        await modalFits(page, 'cutout modal', mobile);
        const padding = await page.locator('dialog[open]').evaluate((el) => {
          const css = getComputedStyle(el);
          return {
            top: parseFloat(css.paddingTop),
            right: parseFloat(css.paddingRight),
            bottom: parseFloat(css.paddingBottom),
            left: parseFloat(css.paddingLeft),
          };
        });
        check(
          padding.top >= 28 && padding.right >= 18 && padding.bottom >= 24 && padding.left >= 18,
          'modal content reserves all simulated cutouts',
          padding,
        );
        await page.locator('dialog[open]').evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        const header = await page.locator('dialog[open] .modal-header').boundingBox();
        check(header.y >= 28 - 1, 'scrolled modal header stays below simulated top cutout', header);
        await screenshot(page, 'safe-area-modal');
        await close(page);
      });
    await context.close();
    await step('login', async () => {
      currentScreen = 'login';
      const authContext = await browser.newContext({
        viewport: size,
        isMobile: mobile,
        hasTouch: mobile,
        reducedMotion: 'reduce',
        serviceWorkers: 'block',
        colorScheme: initialColorScheme,
      });
      await authContext.route('**/api/**', async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === '/api/auth/session')
          await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ required: true, authenticated: false, user: null }),
          });
        else if (pathname === '/api/auth/login')
          await route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ error: `Örnek giriş hatası: ${longName}` }),
          });
        else await routeAPI(route);
      });
      try {
        const login = await authContext.newPage();
        await login.goto(baseURL);
        await login.locator('.login-card').waitFor({ timeout: 5000 });
        await widths(login, 'login');
        await login.locator('input[type=email]').fill('mobile-qa@example.test');
        await login.locator('input[type=password]').fill('synthetic-test-password');
        await login.getByRole('button', { name: 'Giriş yap', exact: true }).click();
        await login.getByRole('alert').waitFor({ timeout: 3000 });
        await widths(login, 'login error');
        await screenshot(login, 'login');
      } finally {
        await authContext.close();
      }
    });
    if (!baseline)
      await step('fullscreen-install', () => verifyFullscreenInstall(browser, size, mobile));
    console.log(
      `${currentSize}: ${results.filter((x) => x.viewport === currentSize).length} assertions, ${findings.filter((x) => x.viewport === currentSize).length} findings`,
    );
  }
} finally {
  await browser.close();
}
await writeFile(
  `${output}/report.json`,
  JSON.stringify({ baseURL, baseline, passed: results.length, findings, results }, null, 2),
);
console.log(
  JSON.stringify({ passed: results.length, failures: findings.length, output, findings }, null, 2),
);
if (findings.length) process.exitCode = 1;
