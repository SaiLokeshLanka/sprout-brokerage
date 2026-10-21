# e2e — Playwright tests

Placeholder for the Playwright framework (roadmap Phase 7): page objects, fixtures, and UI / API / real-time tests.

The frontend already exposes what the tests will need:

- `data-testid` attributes on every interactive element
- `window.__market` test hooks in dev mode: `pause()`, `resume()`, `setPrice(symbol, price)`, `getQuote(symbol)`
