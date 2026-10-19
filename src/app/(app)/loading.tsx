/** Skeleton that mirrors a page: a title bar and a ruled table, so nothing jumps when data arrives. */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="flex-1">
      <span className="sr-only">Loading…</span>
      <div className="h-16 px-8 flex items-center border-b border-border bg-card">
        <div className="h-6 w-48 rounded-full bg-muted animate-pulse motion-reduce:animate-none" />
      </div>
      <div className="p-4 md:p-8 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-surface-container-low animate-pulse motion-reduce:animate-none" />
          ))}
        </div>
        <div className="rounded-xl bg-surface-container-low divide-y divide-border">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="grid grid-cols-[1fr_2fr_1fr_1fr] gap-4 px-6 py-4">
              {[0, 1, 2, 3].map((c) => (
                <div key={c} className="h-4 rounded-full bg-muted animate-pulse motion-reduce:animate-none" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
