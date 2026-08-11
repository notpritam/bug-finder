// ABOUTME: "Not synced" indicators for bugs whose server publish failed or never happened —
// ABOUTME: a compact list-row badge and a full-width detail banner, both with a real Retry.
import { useState } from "react";
import { CloudOff, RefreshCw } from "lucide-react";
import type { Bug } from "@/lib/types";
import { cn } from "@/lib/utils";

/** True when this row's server copy is missing or stale — the states the user must see. */
export function isUnsynced(bug: Bug): boolean {
  return bug.syncState === "failed" || bug.syncState === "local-only";
}

function reason(bug: Bug): string {
  const why =
    bug.syncState === "local-only"
      ? "It could not be reached (offline or no backend), so teammates and agents cannot see this bug yet."
      : `The server refused it${bug.syncError ? `: ${bug.syncError}` : "."}`;
  return `This bug exists only on this device — it never reached the server. ${why}`;
}

function useRetry(onRetry?: () => Promise<unknown> | unknown) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy || !onRetry) return;
    setBusy(true);
    try {
      await onRetry();
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

/** Compact pill for list rows: state + one-click retry. Rendered as its own button, never
 *  nested inside the row's open-button. */
export function SyncBadge({ bug, onRetry }: { bug: Bug; onRetry?: () => Promise<unknown> | unknown }) {
  const { busy, run } = useRetry(onRetry);
  if (!isUnsynced(bug)) return null;
  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={busy || !onRetry}
      title={`${reason(bug)}${onRetry ? " Click to retry now." : ""}`}
      data-testid="sync-badge"
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors",
        bug.syncState === "failed"
          ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-400"
          : "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400",
      )}
    >
      {busy ? <RefreshCw className="size-3 animate-spin" /> : <CloudOff className="size-3" />}
      {busy ? "Syncing…" : "Not synced"}
      {!busy && onRetry && <span className="font-semibold underline underline-offset-2">Retry</span>}
    </button>
  );
}

/** Full-width banner for the bug detail page — impossible to miss, with the reason and a
 *  Retry control. */
export function SyncBanner({ bug, onRetry }: { bug: Bug; onRetry?: () => Promise<unknown> | unknown }) {
  const { busy, run } = useRetry(onRetry);
  if (!isUnsynced(bug)) return null;
  const failed = bug.syncState === "failed";
  return (
    <div
      role="alert"
      data-testid="sync-banner"
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3",
        failed
          ? "border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10"
          : "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10",
      )}
    >
      <CloudOff className={cn("size-4 shrink-0", failed ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400")} />
      <div className="min-w-0 flex-1">
        <p className={cn("text-[13px] font-bold", failed ? "text-red-800 dark:text-red-300" : "text-amber-800 dark:text-amber-300")}>
          Not synced — only on this device
        </p>
        <p className={cn("mt-0.5 text-[12px] leading-relaxed", failed ? "text-red-700/90 dark:text-red-400/90" : "text-amber-700/90 dark:text-amber-400/90")}>
          {reason(bug)}
        </p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold text-white transition",
            failed ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700",
            busy && "cursor-wait opacity-70",
          )}
        >
          <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
          {busy ? "Retrying…" : "Retry sync"}
        </button>
      )}
    </div>
  );
}
