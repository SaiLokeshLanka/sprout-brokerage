import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { ConnectionBanner, FullPageLoader } from './components/common';
import { Header } from './components/Header';
import { MarketProvider, useMarket } from './market/MarketContext';
import { AccountPage } from './pages/AccountPage';
import { ExplorePage } from './pages/ExplorePage';
import { FundsPage } from './pages/FundsPage';
import { InvestmentsPage } from './pages/InvestmentsPage';
import { LoginPage } from './pages/LoginPage';
import { OrdersPage } from './pages/OrdersPage';
import { StockPage } from './pages/StockPage';
import { WatchlistPage } from './pages/WatchlistPage';
import { TradeProvider } from './store/TradeContext';
import { WalletProvider } from './wallet/WalletContext';

/**
 * Guards every logged-in page. Per-user providers are keyed by user id, so
 * switching accounts gives a completely fresh wallet and portfolio state.
 */
function AuthenticatedShell() {
  const { status, user } = useAuth();
  const market = useMarket();
  const location = useLocation();
  if (status === 'loading') return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (market.loadState === 'loading') return <FullPageLoader />;
  if (market.loadState === 'error') {
    return (
      <div className="full-loader" data-testid="market-load-error">
        <div className="empty-state">
          <h3>Can't load market data</h3>
          <p>We couldn't reach Sprout's servers. Check that the API is running, then try again.</p>
          <button className="btn-primary inline" onClick={market.retry}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  return (
    <WalletProvider key={user.id}>
      <TradeProvider key={user.id} userId={user.id}>
        <Header />
        <ConnectionBanner />
        <main className="container">
          <Outlet />
        </main>
      </TradeProvider>
    </WalletProvider>
  );
}

export default function App() {
  return (
    <MarketProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<AuthenticatedShell />}>
              <Route index element={<ExplorePage />} />
              <Route path="stocks/:symbol" element={<StockPage />} />
              <Route path="investments" element={<InvestmentsPage />} />
              <Route path="orders" element={<OrdersPage />} />
              <Route path="watchlist" element={<WatchlistPage />} />
              <Route path="funds" element={<FundsPage />} />
              <Route path="account" element={<AccountPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </MarketProvider>
  );
}
