import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';

export interface MoveResult {
  transactionId: string;
  type: 'DEPOSIT' | 'WITHDRAWAL';
  amountPaise: number;
  balancePaise: number;
  createdAt: string;
  replayed: boolean;
}

export interface WalletTxn {
  id: string;
  transactionId: string;
  type: 'WELCOME_BONUS' | 'DEPOSIT' | 'WITHDRAWAL' | 'ORDER_BLOCK' | 'ORDER_RELEASE' | 'TRADE_BUY' | 'TRADE_SELL' | 'CHARGES';
  description: string;
  amountPaise: number;
  balanceAfterPaise: number;
  createdAt: string;
}

export interface TxnPage {
  items: WalletTxn[];
  nextCursor: string | null;
}

interface WalletContextValue {
  /** Free cash from the backend ledger (investable and withdrawable); null until loaded. */
  balancePaise: number | null;
  /** Cash held back for open buy orders. */
  blockedPaise: number;
  /** Bumps after every money movement so lists can reload. */
  version: number;
  refresh: () => Promise<void>;
  deposit: (amountPaise: number) => Promise<MoveResult>;
  withdraw: (amountPaise: number) => Promise<MoveResult>;
  loadTransactions: (cursor?: string) => Promise<TxnPage>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [balancePaise, setBalancePaise] = useState<number | null>(null);
  const [blockedPaise, setBlockedPaise] = useState(0);
  const [version, setVersion] = useState(0);

  /** Reloads balances; bumps `version` so open transaction lists reload too. */
  const refresh = useCallback(async () => {
    const wallet = await api.get<{ balancePaise: number; blockedPaise: number }>('/wallet');
    setBalancePaise(wallet.balancePaise);
    setBlockedPaise(wallet.blockedPaise);
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    refresh().catch(() => setBalancePaise(null));
  }, [refresh]);

  const move = useCallback(async (kind: 'deposit' | 'withdraw', amountPaise: number) => {
    // A fresh key per attempt: if the network drops and fetch retries, the server won't move money twice.
    const result = await api.post<MoveResult>(
      `/wallet/${kind}`,
      { amountPaise },
      { headers: { 'Idempotency-Key': crypto.randomUUID() } },
    );
    setBalancePaise(result.balancePaise);
    setVersion((v) => v + 1);
    return result;
  }, []);

  const loadTransactions = useCallback(
    (cursor?: string) => api.get<TxnPage>(`/wallet/transactions?limit=20${cursor ? `&cursor=${cursor}` : ''}`),
    [],
  );

  const value = useMemo<WalletContextValue>(
    () => ({
      balancePaise,
      blockedPaise,
      version,
      refresh,
      loadTransactions,
      deposit: (amountPaise) => move('deposit', amountPaise),
      withdraw: (amountPaise) => move('withdraw', amountPaise),
    }),
    [balancePaise, blockedPaise, version, refresh, move, loadTransactions],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used inside <WalletProvider>');
  return ctx;
}
