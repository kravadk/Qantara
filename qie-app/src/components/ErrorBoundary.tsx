import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * App-wide error boundary. Without this, any render exception unmounts the whole
 * React tree and leaves a blank page. Catches the error and offers a reload.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface for diagnostics. No third-party telemetry is wired by default.
    console.error('[qantara] render error:', error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg-base px-6 text-center"
        >
          <h1 className="text-2xl font-bold text-white">Something went wrong</h1>
          <p className="max-w-md text-sm text-text-muted">
            The page hit an unexpected error. Reloading usually fixes it. If it keeps happening, please report it.
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="rounded-xl bg-primary px-5 py-2.5 font-medium text-black transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
