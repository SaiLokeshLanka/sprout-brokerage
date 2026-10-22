import { FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { BrandLogo, FullPageLoader } from '../components/common';

type Mode = 'login' | 'register';

const DEMO = { email: 'demo@sprout.dev', password: 'Demo@1234' };

// Mirrors the server rules so users get instant feedback; the server still re-validates everything.
function validate(mode: Mode, fullName: string, email: string, password: string): string | null {
  if (mode === 'register' && fullName.trim().length < 2) return 'Enter your full name';
  if (!/^\S+@\S+\.\S+$/.test(email.trim())) return 'Enter a valid email address';
  if (!password) return 'Enter your password';
  if (mode === 'register') {
    if (password.length < 8) return 'Password must be at least 8 characters';
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Password must contain at least one letter and one number';
  }
  return null;
}

export function LoginPage() {
  const { status, user, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  if (status === 'loading') return <FullPageLoader />;
  if (user) return <Navigate to="/" replace />;

  const switchMode = (next: Mode) => {
    setMode(next);
    setError('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = validate(mode, fullName, email, password);
    if (problem) return setError(problem);
    setError('');
    setPending(true);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await register(fullName.trim(), email.trim(), password);
      const from = (location.state as { from?: string } | null)?.from ?? '/';
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <div className="login-page">
      <section className="login-hero">
        <div className="brand big">
          <BrandLogo size={44} />
          <span>Sprout</span>
        </div>
        <h1>Invest in stocks, the simple way.</h1>
        <p>Practice trading with ₹1,00,000 of virtual money. Live-simulated NSE prices, real order types, zero risk.</p>
        <ul className="login-points">
          <li>Market &amp; limit orders</li>
          <li>Live portfolio P&amp;L</li>
          <li>Secure account with a real wallet ledger</li>
        </ul>
      </section>

      <section className="login-card-wrap">
        <form className="card login-card" onSubmit={submit} noValidate data-testid="login-form">
          <div className="side-tabs auth-tabs" role="tablist">
            {(['login', 'register'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                className={`side-tab ${mode === m ? 'active buy' : ''}`}
                onClick={() => switchMode(m)}
                data-testid={`auth-tab-${m}`}
              >
                {m === 'login' ? 'Log in' : 'Create account'}
              </button>
            ))}
          </div>

          <div>
            <h2>{mode === 'login' ? 'Welcome back' : 'Open your account'}</h2>
            <p className="muted">{mode === 'login' ? 'Log in to continue' : 'Get ₹1,00,000 of virtual money to start'}</p>
          </div>

          {mode === 'register' && (
            <label className="field">
              <span>Full name</span>
              <input
                type="text"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="As on your PAN card"
                data-testid="register-name"
              />
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              data-testid="login-email"
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'login' ? 'Your password' : 'At least 8 characters, with a letter and a number'}
              data-testid="login-password"
            />
          </label>

          {error && (
            <div className="form-error" role="alert" data-testid="login-error">
              {error}
            </div>
          )}

          <button type="submit" className="btn-primary" disabled={pending} data-testid="login-submit">
            {pending ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>

          {mode === 'login' && (
            <button
              type="button"
              className="btn-text demo-btn"
              onClick={() => {
                setEmail(DEMO.email);
                setPassword(DEMO.password);
                setError('');
              }}
              data-testid="use-demo"
            >
              Use demo account ({DEMO.email})
            </button>
          )}
        </form>
      </section>
    </div>
  );
}
