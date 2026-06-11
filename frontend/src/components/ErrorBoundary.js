import React from 'react';

/**
 * ErrorBoundary — catches any unhandled React render/lifecycle error
 * and shows a friendly recovery UI instead of a white screen.
 *
 * Usage:
 *   Wrap the whole app in index.js:
 *     <ErrorBoundary><App /></ErrorBoundary>
 *
 *   Or wrap individual risky sections:
 *     <ErrorBoundary fallback={<p>Section failed to load</p>}>
 *       <SomeComponent />
 *     </ErrorBoundary>
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    // Log to console so you can see it in hosting logs
    console.error('[ShopZen ErrorBoundary]', error, errorInfo);
  }

  handleReload = () => {
    // Clear state and reload the page
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.href = '/';
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    // Custom fallback if provided
    if (this.props.fallback) return this.props.fallback;

    const isDev = process.env.NODE_ENV === 'development';

    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#fafaf8',
        fontFamily: 'system-ui, sans-serif',
        padding: 24,
      }}>
        <div style={{
          maxWidth: 480,
          width: '100%',
          background: '#fff',
          borderRadius: 20,
          boxShadow: '0 20px 60px rgba(0,0,0,0.1)',
          padding: 40,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#111', margin: '0 0 8px' }}>
            Something went wrong
          </h2>
          <p style={{ color: '#64748b', fontSize: 14, margin: '0 0 28px', lineHeight: 1.6 }}>
            The page ran into an unexpected error. This is usually temporary —
            try refreshing or going back to the home page.
          </p>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={this.handleReload}
              style={{
                background: '#b5451b',
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                padding: '12px 24px',
                fontWeight: 700,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              🔄 Reload Page
            </button>
            <button
              onClick={this.handleGoHome}
              style={{
                background: '#f1f5f9',
                color: '#374151',
                border: 'none',
                borderRadius: 12,
                padding: '12px 24px',
                fontWeight: 700,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              🏠 Go to Home
            </button>
          </div>

          {/* Show error details in dev mode only */}
          {isDev && this.state.error && (
            <details style={{ marginTop: 24, textAlign: 'left' }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>
                Error details (dev only)
              </summary>
              <pre style={{
                marginTop: 8, padding: 12, background: '#fef2f2',
                borderRadius: 8, fontSize: 11, color: '#dc2626',
                overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {this.state.error.toString()}
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}