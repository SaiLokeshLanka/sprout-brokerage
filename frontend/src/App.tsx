import { ReactNode } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Header } from './components/Header';
import { MarketProvider } from './market/MarketContext';
import { ExplorePage } from './pages/ExplorePage';
import { InvestmentsPage } from './pages/InvestmentsPage';
import { LoginPage } from './pages/LoginPage';
import { OrdersPage } from './pages/OrdersPage';
import { StockPage } from './pages/StockPage';
import { WatchlistPage } from './pages/WatchlistPage';
import { TradeProvider, useTrade } from './store/TradeContext';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useTrade();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function Layout() {
  return (
    <>
      <Header />
      <main className="container">
        <Outlet />
      </main>
    </>
  );
}

export default function App() {
  return (
    <MarketProvider>
      <TradeProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              element={
                <RequireAuth>
                  <Layout />
                </RequireAuth>
              }
            >
              <Route index element={<ExplorePage />} />
              <Route path="stocks/:symbol" element={<StockPage />} />
              <Route path="investments" element={<InvestmentsPage />} />
              <Route path="orders" element={<OrdersPage />} />
              <Route path="watchlist" element={<WatchlistPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </TradeProvider>
    </MarketProvider>
  );
}
