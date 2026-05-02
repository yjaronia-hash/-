import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-6 text-center">
          <h1 className="text-4xl font-bold text-red-500 mb-4">문제가 발생했습니다</h1>
          <p className="text-gray-400 mb-6 max-w-md">
            애플리케이션을 불러오는 중 예기치 않은 오류가 발생했습니다. 페이지를 새로고침하거나 나중에 다시 시도해 주세요.
          </p>
          <div className="bg-gray-800 p-4 rounded-lg text-left max-w-2xl overflow-auto border border-gray-700">
            <code className="text-sm text-red-300 whitespace-pre-wrap">
              {this.state.error?.toString()}
            </code>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="mt-8 px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-full font-medium transition-colors"
          >
            새로고침
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
