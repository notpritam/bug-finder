// ABOUTME: The drafts list — captured sessions waiting for review. Click one to review & submit.
import { useNavigate } from "react-router-dom";
import { Clapperboard, FileVideo, Sparkles, Trash2 } from "lucide-react";
import type { Draft } from "@/lib/types";
import { formatDuration, hostOf, relativeTime } from "@/lib/utils";

export function DraftsPage({
  drafts,
  onOpen,
  onDiscard,
}: {
  drafts: Draft[];
  onOpen: (id: string) => void;
  onDiscard: (id: string) => void;
}) {
  const navigate = useNavigate();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-thin bg-background px-8 py-8">
      <div className="mx-auto w-full">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <FileVideo className="size-5 text-primary" />
          <h1 className="text-[20px] font-bold tracking-tight">Drafts</h1>
          <p className="text-[12px] text-muted-foreground">Recordings from the extension, waiting for review</p>
          <button
            type="button"
            onClick={() => navigate("/demo-capture")}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-card px-3 py-1.5 text-[12px] font-semibold text-foreground shadow-card transition hover:bg-accent"
            title="Records a real rrweb session of a demo page right now, then opens it for review"
          >
            <Sparkles className="size-3.5" /> Record a demo capture
          </button>
        </div>

        {drafts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-14 text-center">
            <p className="text-[13.5px] font-semibold text-foreground">No drafts yet</p>
            <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-muted-foreground">
              Record a bug with the Bug Finder extension — when you hit <b>Stop &amp; review</b>, the capture lands
              here so you can trim it, flag the key moments, and submit it as a bug. Or try{" "}
              <button type="button" onClick={() => navigate("/demo-capture")} className="font-semibold text-foreground underline">
                a live demo capture
              </button>{" "}
              right now — it records a real session of a sample page.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {drafts.map((d, i) => (
              <li
                key={d.id}
                className="card-rise flex items-center gap-3 rounded-xl border border-border/60 bg-card px-3.5 py-3 transition-colors hover:border-primary/40 hover:bg-accent/40"
                style={{ "--stagger": i } as React.CSSProperties}
              >
                <button
                  type="button"
                  onClick={() => onOpen(d.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                    Draft
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-foreground">
                      {d.title?.trim() || d.pageTitle || "Untitled capture"}
                    </p>
                    <p className="mt-0.5 flex items-center gap-2 text-[11.5px] text-muted-foreground">
                      <span className="truncate">{hostOf(d.pageUrl)}</span>
                      <span className="inline-flex shrink-0 items-center gap-1">
                        <Clapperboard className="size-3" />
                        {formatDuration(d.durationMs)}
                      </span>
                      {d.markers.length > 0 && <span className="shrink-0">⚑ {d.markers.length}</span>}
                    </p>
                  </div>
                  <span className="w-16 shrink-0 text-right text-[11px] text-muted-foreground">
                    {relativeTime(d.createdAt)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm("Discard this draft? The recording will be lost.")) onDiscard(d.id);
                  }}
                  className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                  title="Discard draft"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
