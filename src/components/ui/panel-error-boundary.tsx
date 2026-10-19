"use client";

import { Component, type ReactNode } from "react";

interface Props {
  /** Shown in the fallback so the user knows which panel failed. */
  label: string;
  children: ReactNode;
}

interface State {
  message: string | null;
}

/**
 * Contains a render error to one panel.
 *
 * Without this, a single bad property access anywhere in a page's tree throws
 * during render and React unmounts the *whole* page — which is how a missing
 * field in the analytics payload made the funding page's Records and Pipeline
 * views both appear to "do nothing". A panel that cannot render should say so
 * and leave the rest of the page working.
 */
export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : "Unknown error" };
  }

  componentDidCatch(error: unknown) {
    console.error(`[${this.props.label}] render failed:`, error);
  }

  render() {
    if (this.state.message !== null) {
      return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {this.props.label} couldn&apos;t be displayed — {this.state.message}. The rest of the page
          is unaffected.
        </div>
      );
    }
    return this.props.children;
  }
}
