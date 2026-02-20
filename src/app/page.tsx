'use client';

import { useSession } from 'next-auth/react';
import Image from 'next/image';
import Link from 'next/link';

/* ------------------------------------------------------------------ */
/*  Data                                                               */
/* ------------------------------------------------------------------ */

const features = [
  {
    icon: '📊',
    title: 'Portfolio Overview',
    desc: 'Track holdings, allocation breakdown, and real-time profit & loss across all your crypto assets.',
  },
  {
    icon: '📈',
    title: 'Advanced Dashboard',
    desc: '12+ interactive charts — net worth, heatmaps, allocation trends, BTC ratios, trading volume, and more.',
  },
  {
    icon: '💱',
    title: 'Transaction Management',
    desc: 'Add, edit, and delete trades with CSV import, full-text search, date range filters, and pagination.',
  },
  {
    icon: '💵',
    title: 'Cash Flow Analysis',
    desc: 'Visualize money in and out with detailed cash flow breakdowns and yearly summaries.',
  },
  {
    icon: '🧾',
    title: 'Tax Reports',
    desc: 'Calculate capital gains for Romania with FIFO, LIFO, HIFO, and LOFO cost basis strategies.',
  },
  {
    icon: '🔑',
    title: 'API Key System',
    desc: 'Generate secure API keys to connect external integrations and hardware devices to your portfolio.',
  },
  {
    icon: '🖥️',
    title: 'Hardware Ticker',
    desc: 'Drive e-ink display devices showing live portfolio data, asset prices, and allocation charts.',
  },
  {
    icon: '🤖',
    title: 'AI Assistant (MCP)',
    desc: '10 tools for Claude Desktop, Cursor, and other MCP-compatible AI assistants to query your data.',
  },
];

const chartNames = [
  { name: 'Net Worth', type: 'line' },
  { name: 'Heatmap', type: 'heatmap' },
  { name: 'Allocation', type: 'pie' },
  { name: 'Cost vs Value', type: 'bar' },
  { name: 'Composition', type: 'area' },
  { name: 'Trading Volume', type: 'bar' },
  { name: 'P&L Analysis', type: 'line' },
  { name: 'BTC Ratio', type: 'line' },
  { name: 'Alt vs BTC', type: 'area' },
  { name: 'Opportunities', type: 'scatter' },
  { name: 'Cost vs Price', type: 'bar' },
  { name: 'Positions', type: 'scatter' },
];

const steps = [
  {
    title: 'Create Your Account',
    desc: 'Sign up with email or Google OAuth. Verify your email to activate your account.',
  },
  {
    title: 'Create a Portfolio',
    desc: 'Set up your first portfolio from the Overview page. You can manage multiple portfolios.',
  },
  {
    title: 'Add Transactions',
    desc: 'Log your buys, sells, deposits, and withdrawals. Import from CSV for bulk entry.',
  },
  {
    title: 'Explore the Dashboard',
    desc: 'View 12+ interactive charts tracking performance, allocation, P&L, and market trends.',
  },
  {
    title: 'Set Up Integrations',
    desc: 'Generate an API key from Settings to connect your hardware ticker or AI assistant.',
  },
];

const mcpConfig = `{
  "mcpServers": {
    "portfolio": {
      "command": "python",
      "args": ["-m", "portfolio_mcp.server"],
      "env": {
        "PORTFOLIO_API_URL": "https://your-site.com",
        "PORTFOLIO_API_KEY": "tk_your_api_key"
      }
    }
  }
}`;

const mcpExamples = [
  "How's my portfolio doing?",
  'What are my top holdings?',
  'Log a buy of 0.5 BTC at $68,000',
  "What's my tax liability for 2025?",
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function LandingPage() {
  const { data: session, status } = useSession();
  const isAuthenticated = !!session;
  const isLoading = status === 'loading';

  return (
    <div className="landing-page">
      {/* ── Hero ── */}
      <section className="landing-section landing-hero">
        <div className="landing-inner">
          <h1 className="landing-hero-title">
            Track Your Crypto&nbsp;Portfolio
          </h1>
          <p className="landing-hero-subtitle">
            Open-source portfolio tracker with advanced analytics, hardware
            ticker integration, and AI&nbsp;assistant&nbsp;support.
          </p>
          <div className="landing-hero-ctas">
            {isLoading ? (
              <div style={{ height: 48 }} />
            ) : isAuthenticated ? (
              <Link href="/overview" className="btn btn-primary btn-lg">
                Go to Dashboard
              </Link>
            ) : (
              <>
                <Link href="/register" className="btn btn-primary btn-lg">
                  Get Started
                </Link>
                <Link href="/login" className="btn btn-secondary btn-lg">
                  Sign In
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="landing-section">
        <div className="landing-inner">
          <h2 className="landing-section-title">Everything You Need</h2>
          <p className="landing-section-subtitle">
            From basic portfolio tracking to advanced analytics and external
            integrations.
          </p>
          <div className="landing-features-grid">
            {features.map((f) => (
              <div key={f.title} className="landing-feature-card">
                <div className="landing-feature-icon">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Dashboard Preview ── */}
      <section className="landing-section">
        <div className="landing-inner">
          <h2 className="landing-section-title">
            Powerful Analytics Dashboard
          </h2>
          <p className="landing-section-subtitle">
            12+ interactive charts designed for both
            desktop and mobile.
          </p>
          <div className="landing-preview-frame">
            <div className="landing-preview-chrome">
              <span className="landing-dot" />
              <span className="landing-dot" />
              <span className="landing-dot" />
            </div>
            <div className="landing-preview-grid">
              {chartNames.map((c) => (
                <div
                  key={c.name}
                  className={`landing-preview-chart landing-chart-${c.type}`}
                >
                  <span>{c.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Integrations ── */}
      <section className="landing-section">
        <div className="landing-inner">
          <h2 className="landing-section-title">Integrations</h2>
          <p className="landing-section-subtitle">
            Connect external devices and AI assistants to your portfolio data.
          </p>
          <div className="landing-integrations-grid">
            {/* Ticker */}
            <div className="landing-integration-card">
              <h3>Hardware Ticker Display</h3>
              <p>
                Connect a Cardano Ticker or similar e-ink display to show live
                portfolio data on your desk. The device shows BTC price,
                portfolio value in multiple currencies, allocation pie chart,
                and 7&#8209;day performance &mdash; all updating automatically via
                the Ticker&nbsp;API.
              </p>
              <div className="landing-ticker-image">
                <Image
                  src="/ticker-showcase.jpeg"
                  alt="Cardano Ticker hardware display showing portfolio data, allocation chart, and 7-day performance"
                  fill
                  sizes="(max-width: 1024px) 100vw, 360px"
                  style={{ objectFit: 'cover', objectPosition: 'center' }}
                  priority={false}
                />
              </div>
              <p className="landing-muted-sm" style={{ marginBottom: 'var(--space-sm)' }}>
                Open-source hardware project:{' '}
                <a
                  className="landing-inline-link"
                  href="https://github.com/en7angled/CardanoTicker#"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  en7angled/CardanoTicker
                </a>
              </p>
              <div className="landing-endpoints">
                <code>GET /api/ticker/portfolio</code>
                <code>GET /api/ticker/portfolio/history</code>
              </div>
              <p className="landing-muted-sm">
                Authenticate with <code>X-API-Key</code> header. Generate keys
                from Settings.
              </p>
            </div>

            {/* MCP */}
            <div className="landing-integration-card">
              <h3>AI Assistant (MCP)</h3>
              <p>
                Use the Portfolio MCP Server to query your data through Claude
                Desktop, Claude Code, Cursor, or any MCP&#8209;compatible AI
                assistant. 10 tools cover holdings, transactions, cash flow, tax
                reports, and price data.
              </p>
              <div className="landing-code-block">
                <pre>{mcpConfig}</pre>
              </div>
              <div className="landing-mcp-examples">
                <h4>Example prompts</h4>
                <ul>
                  {mcpExamples.map((ex) => (
                    <li key={ex}>
                      <span className="landing-prompt-icon">&#8250;</span> {ex}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Getting Started ── */}
      <section className="landing-section">
        <div className="landing-inner">
          <h2 className="landing-section-title">Get Started in Minutes</h2>
          <div className="landing-steps">
            {steps.map((s, i) => (
              <div key={s.title} className="landing-step">
                <div className="landing-step-number">{i + 1}</div>
                <div className="landing-step-content">
                  <h3>{s.title}</h3>
                  <p>{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="landing-steps-cta">
            {!isLoading && !isAuthenticated && (
              <Link href="/register" className="btn btn-primary btn-lg">
                Create Your Account
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="landing-footer">
        <div className="landing-inner">
          <p>
            Built by{' '}
            <a
              className="landing-inline-link"
              href="https://www.e7d.tech/"
              target="_blank"
              rel="noopener noreferrer"
            >
              the e7d.tech team
            </a>
          </p>
          {!isAuthenticated && (
            <div className="landing-footer-links">
              <Link href="/login">Login</Link>
              <Link href="/register">Register</Link>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}
