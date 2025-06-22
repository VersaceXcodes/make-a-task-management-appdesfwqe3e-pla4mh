import React, { Component, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  has_error: boolean;
  error: Error | null;
  error_info: React.ErrorInfo | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    has_error: false,
    error: null,
    error_info: null,
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    // Update state so the next render will show the fallback UI.
    return { has_error: true, error, error_info: null };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // You can also log the error to an error reporting service
    console.error("Uncaught error in UV_Login ErrorBoundary:", error, errorInfo);
    this.setState({ error_info: errorInfo });
  }

  public render() {
    if (this.state.has_error) {
      // You can render any custom fallback UI
      return (
        <div className="flex flex-col items-center justify-center p-8 bg-red-100 border border-red-400 text-red-700 rounded-lg shadow-md">
          <h2 className="text-2xl font-bold mb-4">Oops! Something went wrong.</h2>
          <p className="text-lg">We're sorry, but an unexpected error occurred. Please try refreshing the page.</p>
          {this.state.error && (
            <details className="mt-6 p-4 bg-red-200 rounded-md text-sm text-red-800 break-words max-w-full overflow-auto">
              <summary className="font-semibold cursor-pointer">Error Details</summary>
              <pre className="mt-2 text-xs">
                {this.state.error.toString()}
                <br />
                {this.state.error_info?.componentStack}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}