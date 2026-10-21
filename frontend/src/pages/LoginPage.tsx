import { FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { BrandLogo } from '../components/common';
import { useTrade } from '../store/TradeContext';

export function LoginPage() {
  const { user, login } = useTrade();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  if (user) return <Navigate to="/" replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('Enter a valid email address');
    if (password.length < 6) return setError('Password must be at least 6 characters');
    login(email.trim());
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    navigate(from, { replace: true });
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
          <li>Watchlists and charts</li>
        </ul>
      </section>

      <section className="login-card-wrap">
        <form className="card login-card" onSubmit={submit} noValidate data-testid="login-form">
          <h2>Welcome to Sprout</h2>
          <p className="muted">Log in to continue</p>
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
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 6 characters"
              data-testid="login-password"
            />
          </label>
          {error && (
            <div className="form-error" role="alert" data-testid="login-error">
              {error}
            </div>
          )}
          <button type="submit" className="btn-primary" data-testid="login-submit">
            Continue
          </button>
          <p className="muted small center">Demo mode: any valid email and a 6+ character password works.</p>
        </form>
      </section>
    </div>
  );
}
