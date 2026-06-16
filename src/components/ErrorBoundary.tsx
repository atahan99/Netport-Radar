import { Component, type ReactNode } from 'react';
import { useFiltersStore } from '@/store/filters';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

// Wraps the view area so a crash in a view (e.g. the lazy-loaded globe chunk or
// a three.js error) shows a recovery panel instead of white-screening the app.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error('[view] crashed:', error);
  }

  private reset = (): void => this.setState({ error: null });

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black p-8 text-center">
        <div className="text-base font-semibold text-zinc-100">View crashed</div>
        <p className="max-w-md font-mono text-xs text-zinc-500">{this.state.error.message}</p>
        <div className="flex gap-2">
          <button
            onClick={() => {
              useFiltersStore.getState().setViewMode('2d');
              this.reset();
            }}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-900"
          >
            Switch to 2D
          </button>
          <button
            onClick={() => location.reload()}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-900"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
