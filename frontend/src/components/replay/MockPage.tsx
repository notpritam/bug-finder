// ABOUTME: Wireframe stand-in stage for captures without an rrweb recording — renders a neutral
// ABOUTME: page skeleton with the real cursor path, click ripples, and error state from the capture.
import { useMemo } from "react";
import type { Bug, ReplayEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Derived {
  url: string;
  errors: { t: number; message: string }[];
}

function derive(bug: Bug, t: number): Derived {
  let url = bug.visits[0]?.url ?? bug.pageUrl;
  const errors: { t: number; message: string }[] = [];
  for (const ev of bug.replay) {
    if (ev.t > t) break;
    if (ev.kind === "nav") url = ev.url;
    else if (ev.kind === "error") errors.push({ t: ev.t, message: ev.message });
  }
  return { url, errors };
}

function Line({ w, className }: { w: string; className?: string }) {
  return <div className={cn("h-2 rounded-full bg-zinc-200", className)} style={{ width: w }} />;
}

function GenericPage({ d }: { d: Derived }) {
  let host = "captured page";
  try {
    host = new URL(d.url).host;
  } catch {
    /* keep fallback */
  }
  const failed = d.errors.length > 0;
  return (
    <div className="flex h-full flex-col bg-zinc-50">
      <div className="flex h-10 items-center gap-4 border-b border-zinc-200 bg-white px-4">
        <div className="flex items-center gap-1.5">
          <div className="size-4 rounded bg-zinc-800" />
          <span className="text-[11px] font-bold text-zinc-800">{host}</span>
        </div>
        {["Home", "Docs", "Account"].map((l) => (
          <span key={l} className="text-[10px] font-medium text-zinc-400">
            {l}
          </span>
        ))}
        <div className="ml-auto size-5 rounded-full bg-zinc-300" />
      </div>
      <div className="flex-1 space-y-4 p-6">
        <div className="space-y-2">
          <Line w="34%" className="h-3 bg-zinc-300" />
          <Line w="58%" />
          <Line w="46%" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3">
              <div className="h-14 rounded-md bg-zinc-100" />
              <Line w="70%" className="bg-zinc-300" />
              <Line w="45%" />
            </div>
          ))}
        </div>
        <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3">
          {[64, 52, 58, 40].map((w, i) => (
            <Line key={i} w={`${w}%`} />
          ))}
        </div>
        <p className="pt-1 text-center text-[9.5px] text-zinc-300">
          Wireframe stand-in — this capture has no pixel recording
        </p>
      </div>
      {failed && (
        <div className="absolute bottom-4 right-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 font-mono text-[9.5px] text-red-600 shadow-sm">
          {d.errors[d.errors.length - 1].message.split("\n")[0].slice(0, 80)}
        </div>
      )}
    </div>
  );
}

/* --- stage overlays (cursor, ripples, element highlight) ------------------ */

function cursorAt(replay: ReplayEvent[], t: number): { x: number; y: number } {
  let prev: { t: number; x: number; y: number } | null = null;
  let next: { t: number; x: number; y: number } | null = null;
  for (const ev of replay) {
    if (ev.kind !== "move" && ev.kind !== "click") continue;
    if (ev.t <= t) prev = ev;
    else {
      next = ev;
      break;
    }
  }
  if (!prev) return next ?? { x: 0.5, y: 0.5 };
  if (!next || next.t === prev.t) return prev;
  const f = (t - prev.t) / (next.t - prev.t);
  return { x: prev.x + (next.x - prev.x) * f, y: prev.y + (next.y - prev.y) * f };
}

export function MockPage({
  bug,
  t,
  highlightRect,
}: {
  bug: Bug;
  t: number;
  /** A picked element's normalized rect to spotlight over the page, or null. */
  highlightRect: { x: number; y: number; w: number; h: number } | null;
}) {
  const d = useMemo(() => derive(bug, t), [bug, t]);
  const cursor = cursorAt(bug.replay, t);
  const ripples = bug.replay.filter((ev) => ev.kind === "click" && t - ev.t >= 0 && t - ev.t < 550);

  return (
    <div className="relative h-full w-full select-none overflow-hidden">
      <GenericPage d={d} />

      {/* picked-element spotlight */}
      {highlightRect && (
        <div
          className="pointer-events-none absolute z-20 rounded-sm border-2 border-amber-500 bg-amber-400/10 shadow-[0_0_0_4000px_rgba(17,18,23,0.28)] transition-all duration-200"
          style={{
            left: `${highlightRect.x * 100}%`,
            top: `${highlightRect.y * 100}%`,
            width: `${highlightRect.w * 100}%`,
            height: `${highlightRect.h * 100}%`,
          }}
        />
      )}

      {/* click ripples */}
      {ripples.map((ev) =>
        ev.kind === "click" ? (
          <span
            key={ev.t}
            className="click-ripple pointer-events-none absolute z-30 size-8 rounded-full border-2 border-blue-500 bg-blue-400/30"
            style={{ left: `${ev.x * 100}%`, top: `${ev.y * 100}%` }}
          />
        ) : null,
      )}

      {/* cursor */}
      <svg
        className="pointer-events-none absolute z-30 drop-shadow-sm transition-transform duration-75"
        style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%`, width: 15, height: 15 }}
        viewBox="0 0 16 16"
      >
        <path d="M1 1l5.5 13 1.8-5.7L14 6.5z" fill="#18181b" stroke="#fff" strokeWidth="1.2" />
      </svg>
    </div>
  );
}
