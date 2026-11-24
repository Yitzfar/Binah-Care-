import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'An unexpected error occurred.',
    };
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#FAF9F6] flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-[#E6E4DF] rounded-xl p-8">
            <h2 className="text-xl font-semibold text-[#181A1F] mb-2">
              BINAH CARE Workspace Notice
            </h2>
            <p className="text-sm text-[#575B66] mb-6 leading-relaxed">
              We encountered a security or connectivity interruption while loading your workspace.
            </p>
            <div className="bg-[#F3F2EE] border border-[#E6E4DF] rounded-lg p-3 text-xs font-mono text-[#181A1F] break-all mb-6">
              {this.state.message}
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 bg-[#0F5C53] text-white text-sm font-medium rounded-lg hover:bg-[#0B4740] transition-colors"
            >
              Reload Workspace
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
