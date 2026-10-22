import { FormEvent, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useTrade } from '../store/TradeContext';
import { formatINR, formatPaise, formatTime, toPaise } from '../utils/format';
import { useWallet, WalletTxn } from '../wallet/WalletContext';

type Tab = 'add' | 'withdraw';

const QUICK_ADD = [10_000, 25_000, 50_000];
const MAX_PER_TXN_PAISE = toPaise(10_00_000);
const TYPE_LABEL: Record<WalletTxn['type'], string> = {
  WELCOME_BONUS: 'Welcome bonus',
  DEPOSIT: 'Money added',
  WITHDRAWAL: 'Withdrawal',
};

/** Returns the amount in paise, or an error message. Same limits as the server. */
function parseAmount(input: string): number | string {
  if (!/^\d+(\.\d{1,2})?$/.test(input.trim())) return 'Enter an amount like 5000 or 2500.50';
  const paise = toPaise(Number(input));
  if (paise < 100) return 'Minimum amount is ₹1';
  if (paise > MAX_PER_TXN_PAISE) return 'Maximum per transaction is ₹10,00,000';
  return paise;
}

export function FundsPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'withdraw' ? 'withdraw' : 'add';
  const { user } = useAuth();
  const { balancePaise, version, deposit, withdraw, loadTransactions } = useWallet();
  const { availablePaise } = useTrade();

  const [amount, setAmount] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [txns, setTxns] = useState<WalletTxn[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  // Reload history after every money movement (version bumps).
  useEffect(() => {
    let cancelled = false;
    loadTransactions()
      .then((page) => {
        if (cancelled) return;
        setTxns(page.items);
        setNextCursor(page.nextCursor);
        setTxStatus('ready');
      })
      .catch(() => !cancelled && setTxStatus('error'));
    return () => {
      cancelled = true;
    };
  }, [version, loadTransactions]);

  const kycVerified = user?.kycStatus === 'VERIFIED';
  // Money spent on (simulated) holdings is still in the wallet ledger but isn't free to withdraw.
  const withdrawablePaise = Math.max(0, Math.min(balancePaise ?? 0, availablePaise));

  const switchTab = (next: Tab) => {
    setParams(next === 'withdraw' ? { tab: 'withdraw' } : {}, { replace: true });
    setAmount('');
    setResult(null);
  };

  const loadMore = async () => {
    if (!nextCursor) return;
    const page = await loadTransactions(nextCursor);
    setTxns((prev) => [...prev, ...page.items]);
    setNextCursor(page.nextCursor);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseAmount(amount);
    if (typeof parsed === 'string') return setResult({ ok: false, message: parsed });
    if (tab === 'withdraw' && parsed > withdrawablePaise) {
      return setResult({ ok: false, message: `You can withdraw up to ${formatPaise(withdrawablePaise)}` });
    }
    setPending(true);
    setResult(null);
    try {
      const r = tab === 'add' ? await deposit(parsed) : await withdraw(parsed);
      const verb = tab === 'add' ? 'Added' : 'Withdrew';
      setResult({ ok: true, message: `${verb} ${formatPaise(r.amountPaise)}. New balance: ${formatPaise(r.balancePaise)}` });
      setAmount('');
    } catch (err) {
      setResult({ ok: false, message: errorMessage(err) });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="page-grid">
      <div className="page-main">
        <div className="card balance-card" data-testid="wallet-card">
          <div className="muted small">Wallet balance</div>
          <div className="summary-value" data-testid="wallet-balance">
            {balancePaise === null ? '—' : formatPaise(balancePaise)}
          </div>
          <div className="balance-split small">
            <span>
              Available to invest <b data-testid="wallet-available">{formatPaise(availablePaise)}</b>
            </span>
            <span>
              Withdrawable <b data-testid="wallet-withdrawable">{formatPaise(withdrawablePaise)}</b>
            </span>
          </div>
        </div>

        <section>
          <h2 className="section-title">Transactions</h2>
          <div className="card list-card" data-testid="txn-list">
            {txStatus === 'loading' && <div className="empty-state muted">Loading…</div>}
            {txStatus === 'error' && <div className="empty-state down">Couldn't load transactions. Refresh to try again.</div>}
            {txStatus === 'ready' && txns.length === 0 && <div className="empty-state muted">No transactions yet.</div>}
            {txStatus === 'ready' &&
              txns.map((t) => {
                const incoming = t.amountPaise > 0;
                return (
                  <div key={t.id} className="txn-row" data-testid="txn-row" data-type={t.type}>
                    <div className={`txn-icon ${incoming ? 'in' : 'out'}`} aria-hidden="true">
                      {incoming ? '+' : '−'}
                    </div>
                    <div className="grow">
                      <div className="strong">{TYPE_LABEL[t.type]}</div>
                      <div className="muted small">{formatTime(Date.parse(t.createdAt))}</div>
                    </div>
                    <div className="num">
                      <div className={`strong ${incoming ? 'up' : ''}`} data-testid="txn-amount">
                        {incoming ? '+' : '−'}
                        {formatPaise(Math.abs(t.amountPaise))}
                      </div>
                      <div className="muted small">Bal. {formatPaise(t.balanceAfterPaise)}</div>
                    </div>
                  </div>
                );
              })}
            {nextCursor && (
              <div className="list-footer">
                <button className="btn-text link" onClick={loadMore} data-testid="txn-load-more">
                  Load more
                </button>
              </div>
            )}
          </div>
        </section>
      </div>

      <aside className="page-aside sticky">
        <form className={`card order-panel ${tab === 'withdraw' ? 'sell' : 'buy'}`} onSubmit={submit} data-testid="funds-form">
          <div className="side-tabs" role="tablist">
            {(['add', 'withdraw'] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={`side-tab ${tab === t ? `active ${t === 'add' ? 'buy' : 'sell'}` : ''}`}
                onClick={() => switchTab(t)}
                data-testid={`funds-tab-${t}`}
              >
                {t === 'add' ? 'Add money' : 'Withdraw'}
              </button>
            ))}
          </div>

          <div className="order-body">
            {tab === 'withdraw' && !kycVerified ? (
              <div className="notice" data-testid="kyc-required">
                Complete your KYC to withdraw money. <Link to="/account">Verify now →</Link>
              </div>
            ) : (
              <>
                <label className="field">
                  <span>Amount (₹)</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    data-testid="funds-amount"
                  />
                </label>
                {tab === 'add' ? (
                  <div className="chip-group">
                    {QUICK_ADD.map((a) => (
                      <button type="button" key={a} className="chip" onClick={() => setAmount(String(a))}>
                        +{formatINR(a).replace('.00', '')}
                      </button>
                    ))}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="chip"
                    onClick={() => setAmount((withdrawablePaise / 100).toFixed(2))}
                    data-testid="withdraw-max"
                  >
                    Withdraw all ({formatPaise(withdrawablePaise)})
                  </button>
                )}
              </>
            )}

            {result && (
              <div className={`order-result ${result.ok ? 'ok' : 'err'}`} role="status" data-testid="funds-result">
                {result.message}
              </div>
            )}
          </div>

          <div className="order-foot">
            <div className="muted small">Virtual money only — no real bank is involved.</div>
            <button
              type="submit"
              className={`btn-primary ${tab === 'withdraw' ? 'sell' : ''}`}
              disabled={pending || (tab === 'withdraw' && !kycVerified)}
              data-testid="funds-submit"
            >
              {pending ? 'Processing…' : tab === 'add' ? 'Add money' : 'Withdraw'}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
