import { Component } from 'react';

// App-level safety net. A render-time crash — e.g. accidentally rendering an
// object as a React child (React error #31, which a 402 plan-limit detail used
// to trigger) — would white-screen the ENTIRE app. This catches it and shows a
// recoverable message instead of a blank page. Targeted fixes still prevent the
// known cases; this is defense-in-depth so a white screen never ships again.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Keep the stack in the console (and Cloud Run logs in prod) for debugging.
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24,
        textAlign: 'center', fontFamily: 'inherit',
      }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Something went wrong</h1>
        <p style={{ color: '#6b7280', margin: 0, maxWidth: 420 }}>
          The page hit an unexpected error. Reloading usually fixes it.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            border: 'none', cursor: 'pointer', borderRadius: 999,
            padding: '8px 16px', fontSize: 13, background: '#0071E3', color: '#fff',
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
