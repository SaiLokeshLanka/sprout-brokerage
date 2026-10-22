import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { STOCKS } from '../data/instruments';
import { useTrade } from '../store/TradeContext';
import { formatPaise } from '../utils/format';
import { BrandLogo, StockLogo } from './common';

const NAV = [
  { to: '/', label: 'Explore', end: true },
  { to: '/investments', label: 'Investments' },
  { to: '/orders', label: 'Orders' },
  { to: '/watchlist', label: 'Watchlist' },
];

export function Header() {
  const { user, logout } = useAuth();
  const { availablePaise } = useTrade();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? 'light');
  const menuRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return STOCKS.filter((s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)).slice(0, 6);
  }, [query]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const openStock = (symbol: string) => {
    setQuery('');
    setSearchOpen(false);
    navigate(`/stocks/${symbol}`);
  };

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('sprout.theme', next);
    } catch {
      // ignore
    }
  };

  return (
    <header className="header">
      <div className="header-inner">
        <NavLink to="/" className="brand" aria-label="Sprout home">
          <BrandLogo />
          <span>Sprout</span>
        </NavLink>

        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="nav-link" data-testid={`nav-${n.label.toLowerCase()}`}>
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="search">
          <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M10.5 3a7.5 7.5 0 0 1 5.96 12.06l4.24 4.24-1.4 1.4-4.24-4.24A7.5 7.5 0 1 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z" fill="currentColor" />
          </svg>
          <input
            type="search"
            placeholder="Search stocks..."
            value={query}
            data-testid="search-input"
            aria-label="Search stocks"
            onChange={(e) => {
              setQuery(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setSearchOpen(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results[0]) openStock(results[0].symbol);
              if (e.key === 'Escape') setSearchOpen(false);
            }}
          />
          {searchOpen && query && (
            <ul className="search-results" role="listbox" data-testid="search-results">
              {results.length === 0 && <li className="search-empty">No stocks found</li>}
              {results.map((s) => (
                <li
                  key={s.symbol}
                  role="option"
                  aria-selected="false"
                  data-testid={`search-result-${s.symbol}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    openStock(s.symbol);
                  }}
                >
                  <StockLogo symbol={s.symbol} size={28} />
                  <div>
                    <div className="strong">{s.name}</div>
                    <div className="muted small">NSE: {s.symbol}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="header-actions">
          <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle dark mode" data-testid="theme-toggle">
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <div className="profile" ref={menuRef}>
            <button className="avatar" onClick={() => setMenuOpen((o) => !o)} aria-label="Account menu" data-testid="profile-button">
              {user?.fullName.charAt(0).toUpperCase() ?? '?'}
            </button>
            {menuOpen && (
              <div className="menu" data-testid="profile-menu">
                <div className="menu-user">
                  <div className="strong">{user?.fullName}</div>
                  <div className="muted small">{user?.email}</div>
                </div>
                <div className="menu-row">
                  <span className="muted">Balance</span>
                  <span className="strong" data-testid="menu-balance">{formatPaise(availablePaise)}</span>
                </div>
                <button
                  className="menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    navigate('/funds');
                  }}
                  data-testid="menu-funds"
                >
                  Funds &amp; transactions
                </button>
                <button
                  className="menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    navigate('/account');
                  }}
                  data-testid="menu-account"
                >
                  Profile &amp; KYC
                  {user?.kycStatus === 'PENDING' && <span className="dot-badge">Pending</span>}
                </button>
                <button
                  className="menu-item danger"
                  onClick={async () => {
                    setMenuOpen(false);
                    await logout();
                    navigate('/login', { replace: true });
                  }}
                  data-testid="logout-button"
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
