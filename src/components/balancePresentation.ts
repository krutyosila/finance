import type { Account, Debt } from '../../shared/types';

export function accountBalancePresentation(
  account: Pick<Account, 'type' | 'currentBalance' | 'currentDebt'>,
) {
  if (
    account.type === 'CREDIT_CARD' &&
    !account.currentBalance.startsWith('-') &&
    /[1-9]/.test(account.currentBalance)
  )
    return { label: 'Kart bakiyesi', amount: account.currentBalance };
  const liability = account.type === 'CREDIT_CARD' || account.type === 'OVERDRAFT';
  return {
    label: liability ? 'Güncel borç' : 'Güncel bakiye',
    amount: liability ? account.currentDebt : account.currentBalance,
  };
}

export function debtBalancePresentation(debt: Pick<Debt, 'type' | 'currentBalance'>) {
  if (
    debt.type === 'CREDIT_CARD' &&
    debt.currentBalance.startsWith('-') &&
    /[1-9]/.test(debt.currentBalance)
  )
    return { label: 'Kart bakiyesi', amount: debt.currentBalance.slice(1) };
  return { label: 'Güncel borç', amount: debt.currentBalance };
}
