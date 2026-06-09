import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './lib/i18n';
import './index.css';

// Layouts
import { LandingLayout } from './layouts/LandingLayout';
import { AppLayout } from './layouts/AppLayout';
import { ToastContainer } from './components/ToastContainer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RouteFallback } from './components/RouteFallback';
import { NotFound } from './pages/NotFound';
import { checkEnv } from './lib/assertEnv';

// Public pages
const Home = lazy(() => import('./pages/Home').then(({ Home }) => ({ default: Home })));
const Manifesto = lazy(() => import('./pages/Manifesto').then(({ Manifesto }) => ({ default: Manifesto })));
const Showcase = lazy(() => import('./pages/Showcase').then(({ Showcase }) => ({ default: Showcase })));
const Status = lazy(() => import('./pages/Status').then(({ Status }) => ({ default: Status })));
const Pay = lazy(() => import('./pages/Pay').then(({ Pay }) => ({ default: Pay })));
const Checkout = lazy(() => import('./pages/Checkout').then(({ Checkout }) => ({ default: Checkout })));
const Profile = lazy(() => import('./pages/Profile').then(({ Profile }) => ({ default: Profile })));

// App pages — core
const Dashboard = lazy(() => import('./pages/app/Dashboard').then(({ Dashboard }) => ({ default: Dashboard })));
const Explorer = lazy(() => import('./pages/app/Explorer').then(({ Explorer }) => ({ default: Explorer })));
const NewCipher = lazy(() => import('./pages/app/NewCipher').then(({ NewCipher }) => ({ default: NewCipher })));
const MultiPay = lazy(() => import('./pages/app/MultiPay').then(({ MultiPay }) => ({ default: MultiPay })));
const Escrow = lazy(() => import('./pages/app/Escrow').then(({ Escrow }) => ({ default: Escrow })));
const Subscription = lazy(() => import('./pages/app/Subscription').then(({ Subscription }) => ({ default: Subscription })));
const BatchPayout = lazy(() => import('./pages/app/BatchPayout').then(({ BatchPayout }) => ({ default: BatchPayout })));
const InstallmentPlan = lazy(() => import('./pages/app/InstallmentPlan').then(({ InstallmentPlan }) => ({ default: InstallmentPlan })));
const Advanced = lazy(() => import('./pages/app/Advanced').then(({ Advanced }) => ({ default: Advanced })));
const Distribution = lazy(() => import('./pages/app/Distribution').then(({ Distribution }) => ({ default: Distribution })));
const Developer = lazy(() => import('./pages/app/Developer').then(({ Developer }) => ({ default: Developer })));
const InboxAndReceipts = lazy(() =>
  import('./pages/app/InboxAndReceipts').then(({ InboxAndReceipts }) => ({ default: InboxAndReceipts })),
);
const Start = lazy(() => import('./pages/app/Start').then(({ Start }) => ({ default: Start })));

// App pages — developer / settings
const Build = lazy(() => import('./pages/app/Build').then(({ Build }) => ({ default: Build })));
const Guide = lazy(() => import('./pages/app/Guide').then(({ Guide }) => ({ default: Guide })));
const Settings = lazy(() => import('./pages/app/Settings').then(({ Settings }) => ({ default: Settings })));
const ApiKeys = lazy(() => import('./pages/app/ApiKeys').then(({ ApiKeys }) => ({ default: ApiKeys })));
const Billing = lazy(() => import('./pages/app/Billing').then(({ Billing }) => ({ default: Billing })));
const Customers = lazy(() => import('./pages/app/Customers').then(({ Customers }) => ({ default: Customers })));
const Notifications = lazy(() =>
  import('./pages/app/Notifications').then(({ Notifications }) => ({ default: Notifications })),
);
const Proof = lazy(() => import('./pages/app/Proof').then(({ Proof }) => ({ default: Proof })));
const PaymentProofs = lazy(() =>
  import('./pages/app/PaymentProofs').then(({ PaymentProofs }) => ({ default: PaymentProofs })),
);
const CheckoutApi = lazy(() => import('./pages/app/CheckoutApi').then(({ CheckoutApi }) => ({ default: CheckoutApi })));
const TelegramBot = lazy(() => import('./pages/app/TelegramBot').then(({ TelegramBot }) => ({ default: TelegramBot })));
const Webhooks = lazy(() => import('./pages/app/Webhooks').then(({ Webhooks }) => ({ default: Webhooks })));
const ChatThread = lazy(() => import('./pages/app/ChatThread').then(({ ChatThread }) => ({ default: ChatThread })));
const Agent = lazy(() => import('./pages/app/Agent').then(({ Agent }) => ({ default: Agent })));
const Splits = lazy(() => import('./pages/app/Splits').then(({ Splits }) => ({ default: Splits })));
const Streams = lazy(() => import('./pages/app/Streams').then(({ Streams }) => ({ default: Streams })));
const Onramp = lazy(() => import('./pages/app/Onramp').then(({ Onramp }) => ({ default: Onramp })));
const Sdk = lazy(() => import('./pages/app/Sdk').then(({ Sdk }) => ({ default: Sdk })));
const WalletRuntime = lazy(() => import('./components/WalletRuntime').then(({ WalletRuntime }) => ({ default: WalletRuntime })));

const queryClient = new QueryClient();
const Agentation = import.meta.env.DEV
  ? lazy(() => import('agentation').then(({ Agentation }) => ({ default: Agentation })))
  : null;

function withWallet(element: React.ReactNode) {
  return <WalletRuntime>{element}</WalletRuntime>;
}

const env = checkEnv();
const rootEl = document.getElementById('root')!;

if (!env.ok && import.meta.env.PROD) {
  // Fail visibly on missing production config instead of rendering a broken app.
  ReactDOM.createRoot(rootEl).render(
    <div
      role="alert"
      style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', padding: '1.5rem', fontFamily: 'system-ui, sans-serif', textAlign: 'center', background: '#0a0a0a', color: '#fff' }}
    >
      <strong style={{ fontSize: '1.25rem' }}>Configuration error</strong>
      <span style={{ opacity: 0.7, fontSize: '0.9rem' }}>Missing required settings: {env.missing.join(', ')}</span>
    </div>,
  );
} else {
  if (!env.ok) console.warn('[qantara] missing public env (dev):', env.missing);
  ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
      <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ToastContainer />
          <Suspense fallback={<RouteFallback />}>
            {Agentation && <Agentation />}
            <Routes>
            {/* Public Routes */}
            <Route element={<LandingLayout />}>
              <Route path="/" element={<Home />} />
              <Route path="/showcase" element={<Showcase />} />
              <Route path="/manifesto" element={<Manifesto />} />
              <Route path="/status" element={<Status />} />
            </Route>

            {/* Public pay pages (no sidebar) */}
            <Route path="/pay/:hash" element={withWallet(<Pay />)} />
            <Route path="/checkout/:hash" element={withWallet(<Checkout />)} />
            <Route path="/profile/:address" element={withWallet(<Profile />)} />

            {/* App Routes */}
            <Route path="/app" element={withWallet(<AppLayout />)}>
              <Route index element={<Navigate to="/app/start" replace />} />
              <Route path="start" element={<Start />} />

              {/* Pay Links — core V1 */}
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="new-cipher" element={<NewCipher />} />

              {/* Hubs (V1.5 consolidation) */}
              <Route path="advanced" element={<Advanced />} />
              <Route path="distribute" element={<Distribution />} />
              <Route path="developer" element={<Developer />} />
              <Route path="inbox" element={<InboxAndReceipts />} />
              {/* /app/proofs deep-links into Activity → Receipts tab via InboxAndReceipts effect */}
              <Route path="proofs" element={<InboxAndReceipts />} />

              {/* Deep-link compatibility — individual pages still resolve */}
              <Route path="multipay" element={<MultiPay />} />
              <Route path="escrow" element={<Escrow />} />
              <Route path="subscription" element={<Subscription />} />
              <Route path="installment" element={<InstallmentPlan />} />
              <Route path="batch" element={<BatchPayout />} />
              <Route path="checkout-api" element={<CheckoutApi />} />
              <Route path="webhooks" element={<Webhooks />} />
              <Route path="tg-bot" element={<TelegramBot />} />
              <Route path="telegram-bot" element={<TelegramBot />} />
              <Route path="explorer" element={<Explorer />} />
              <Route path="build" element={<Build />} />
              <Route path="guide" element={<Guide />} />

              {/* Standalone */}
              <Route path="settings" element={<Settings />} />
              <Route path="api-keys" element={<ApiKeys />} />
              <Route path="billing" element={<Billing />} />
              <Route path="customers" element={<Customers />} />
              <Route path="notifications" element={<Notifications />} />
              <Route path="proof" element={<Proof />} />
              <Route path="payment-proofs" element={<PaymentProofs />} />

              {/* V4 — On-chain chat */}
              <Route path="chat" element={<ChatThread />} />
              <Route path="chat/:counterparty" element={<ChatThread />} />

              {/* V4 — AI copilot full page */}
              <Route path="agent" element={<Agent />} />

              {/* V4 — Splits + Streams */}
              <Route path="splits" element={<Splits />} />
              <Route path="streams" element={<Streams />} />

              {/* V4 — Fiat onramp */}
              <Route path="onramp" element={<Onramp />} />

              {/* V4 — Public SDK */}
              <Route path="sdk" element={<Sdk />} />
            </Route>

            {/* Fallback — explicit 404 */}
            <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </QueryClientProvider>
      </ErrorBoundary>
  </React.StrictMode>,
  );
}
