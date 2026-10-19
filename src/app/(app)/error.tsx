"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex-1 grid place-items-center p-8">
      <div role="alert" className="max-w-md rounded-[28px] bg-surface-container-low p-8">
        <h1 className="text-xl font-bold text-foreground">This page could not load</h1>
        <p className="mt-2 text-base text-foreground">
          Something went wrong on our side. Nothing you entered has been lost. Try again, and if it keeps happening, tell your administrator.
        </p>
        {error.digest && <p className="mt-2 text-sm text-muted-foreground">Reference: {error.digest}</p>}
        <div className="mt-6">
          <Button onClick={reset}>Try again</Button>
        </div>
      </div>
    </div>
  );
}
