// ABOUTME: The session-replay player — browser-chrome stage around the simulated page, transport
// ABOUTME: controls, and a scrubbable timeline with event ticks and marker flags (PostHog-style).
import { useCallback, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  Flag,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
} from "lucide-react";
import type { Bug } from "@/lib/types";
import { formatOffset, pathOf } from "@/lib/utils";
import { MockPage } from "./MockPage";
import type { ReplayClock } from "./useReplayClock";

const SPEEDS = [0.5, 1, 2, 4];

export interface Trim {
  in: number;
  out: number;
}

export function ReplayPlayer({
  bug,
  clock,
  highlightRect,
  trim,
  onTrimChange,
}: {
  bug: Bug;
  clock: ReplayClock;
  highlightRect: { x: number; y: number; w: number; h: number } | null;
  /** Draft mode: the kept window, rendered as shaded-out regions + draggable handles. */
  trim?: Trim;
  onTrimChange?: (trim: Trim) => void;
}) {
  const { t, playing, duration, speed } = clock;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const currentUrl = useMemo(() => {
    let url = bug.visits[0]?.url ?? bug.pageUrl;
    for (const v of bug.visits) if (v.t <= t) url = v.url;
    return url;
  }, [bug, t]);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      setFullscreen(false);
    } else {
      void el.requestFullscreen().then(() => setFullscreen(true)).catch(() => {});
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card shadow-card [&:fullscreen]:rounded-none"
    >
      {/* Browser chrome */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 bg-muted/60 px-3">
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-[#f87171]" />
          <span className="size-2.5 rounded-full bg-[#fbbf24]" />
          <span className="size-2.5 rounded-full bg-[#34d399]" />
        </span>
        <div className="mx-auto flex h-6 min-w-0 max-w-[70%] flex-1 items-center justify-center gap-1.5 rounded-md bg-card px-3 text-[11px] text-muted-foreground shadow-sm">
          <span className="truncate font-mono">{currentUrl.replace(/^https?:\/\//, "")}</span>
        </div>
        <button
          type="button"
          onClick={toggleFullscreen}
          className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </button>
      </div>

      {/* Stage */}
      <div className="relative min-h-0 flex-1 bg-zinc-100">
        <MockPage bug={bug} t={t} highlightRect={highlightRect} />
        {!playing && t === 0 && (
          <button
            type="button"
            onClick={clock.play}
            className="absolute inset-0 z-40 grid place-items-center bg-foreground/20 backdrop-blur-[1px] transition-opacity hover:bg-foreground/25"
            aria-label="Play recording"
          >
            <span className="grid size-14 place-items-center rounded-full bg-card text-foreground shadow-panel">
              <Play className="ml-0.5 size-6" />
            </span>
          </button>
        )}
      </div>

      {/* Timeline */}
      <Timeline bug={bug} clock={clock} trim={trim} onTrimChange={onTrimChange} />

      {/* Transport controls */}
      <div className="flex h-11 shrink-0 items-center gap-1 border-t border-border/60 px-2.5">
        <button
          type="button"
          onClick={clock.toggle}
          className="grid size-8 place-items-center rounded-lg text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          title={playing ? "Pause (space)" : "Play (space)"}
        >
          {playing ? <Pause className="size-[18px]" /> : <Play className="ml-0.5 size-[18px]" />}
        </button>
        <button
          type="button"
          onClick={() => clock.skip(-10_000)}
          className="grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          title="Back 10s"
        >
          <RotateCcw className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => clock.skip(10_000)}
          className="grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          title="Forward 10s"
        >
          <RotateCw className="size-4" />
        </button>
        <span className="ml-2 font-mono text-[11.5px] tabular-nums text-muted-foreground">
          <span className="text-foreground">{formatOffset(t)}</span> / {formatOffset(duration)}
        </span>
        <span className="ml-3 hidden truncate font-mono text-[10.5px] text-muted-foreground/70 sm:block">
          {pathOf(currentUrl)}
        </span>
        <button
          type="button"
          onClick={() => clock.setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}
          className="ml-auto rounded-lg px-2 py-1 font-mono text-[11.5px] font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          title="Playback speed"
        >
          {speed}×
        </button>
      </div>
    </div>
  );
}

/** The scrubbable timeline: progress fill, click/nav/error ticks, marker flags above, and
 *  (in draft mode) trim handles with shaded dropped regions. */
function Timeline({
  bug,
  clock,
  trim,
  onTrimChange,
}: {
  bug: Bug;
  clock: ReplayClock;
  trim?: Trim;
  onTrimChange?: (trim: Trim) => void;
}) {
  const { t, duration } = clock;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const trimDrag = useRef<"in" | "out" | null>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);

  const ticks = useMemo(() => {
    const out: { t: number; color: string; label: string }[] = [];
    for (const ev of bug.replay) {
      if (ev.kind === "click") out.push({ t: ev.t, color: "var(--ev-click)", label: `Click ${ev.target ?? ""}` });
      else if (ev.kind === "nav") out.push({ t: ev.t, color: "var(--ev-nav)", label: `Navigate ${pathOf(ev.url)}` });
      else if (ev.kind === "error") out.push({ t: ev.t, color: "var(--ev-error)", label: ev.message });
    }
    for (const c of bug.console)
      if (c.level === "error") out.push({ t: c.t, color: "var(--ev-error)", label: c.text.split("\n")[0] });
    return out;
  }, [bug]);

  const timeFromPointer = useCallback(
    (e: PointerEvent) => {
      const el = trackRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      return f * duration;
    },
    [duration],
  );

  return (
    <div className="shrink-0 border-t border-border/60 px-2.5 pb-1 pt-3">
      <div
        ref={trackRef}
        role="slider"
        aria-label="Replay timeline"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration / 1000)}
        aria-valuenow={Math.round(t / 1000)}
        tabIndex={0}
        className="group relative h-5 cursor-pointer touch-none"
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          clock.pause();
          clock.seek(timeFromPointer(e));
        }}
        onPointerMove={(e) => {
          setHoverT(timeFromPointer(e));
          if (trimDrag.current && trim && onTrimChange) {
            const nt = timeFromPointer(e);
            if (trimDrag.current === "in") onTrimChange({ in: Math.min(nt, trim.out - 500), out: trim.out });
            else onTrimChange({ in: trim.in, out: Math.max(nt, trim.in + 500) });
          } else if (dragging.current) {
            clock.seek(timeFromPointer(e));
          }
        }}
        onPointerUp={() => {
          dragging.current = false;
          trimDrag.current = null;
        }}
        onPointerLeave={() => setHoverT(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") clock.skip(-5000);
          if (e.key === "ArrowRight") clock.skip(5000);
        }}
      >
        {/* marker flags above the track */}
        {bug.markers.map((m, i) => (
          <button
            key={i}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              clock.seek(m.t);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute -top-2 z-10 -translate-x-1/2"
            style={{ left: `${(m.t / duration) * 100}%` }}
            title={`${m.label ?? "Marker"} · ${formatOffset(m.t)}`}
          >
            <Flag
              className="size-3"
              style={{ color: m.kind === "error" ? "var(--ev-error)" : "var(--ev-marker)" }}
              fill="currentColor"
            />
          </button>
        ))}

        {/* trimmed-out shading + handles */}
        {trim && (
          <>
            {trim.in > 0 && (
              <div
                className="absolute inset-y-0 left-0 rounded-l bg-foreground/8"
                style={{ width: `${(trim.in / duration) * 100}%` }}
              />
            )}
            {trim.out < duration && (
              <div
                className="absolute inset-y-0 right-0 rounded-r bg-foreground/8"
                style={{ width: `${((duration - trim.out) / duration) * 100}%` }}
              />
            )}
            {(["in", "out"] as const).map((which) => (
              <div
                key={which}
                role="slider"
                aria-label={which === "in" ? "Trim start" : "Trim end"}
                aria-valuemin={0}
                aria-valuemax={Math.round(duration / 1000)}
                aria-valuenow={Math.round(trim[which] / 1000)}
                className="absolute top-1/2 z-20 h-5 w-[7px] -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-[3px] border border-card bg-amber-500 shadow-sm"
                style={{ left: `${(trim[which] / duration) * 100}%` }}
                title={`${which === "in" ? "Trim start" : "Trim end"} · ${formatOffset(trim[which])} — drag to adjust`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  trimDrag.current = which;
                  (e.currentTarget.parentElement as HTMLElement | null)?.setPointerCapture(e.pointerId);
                  clock.pause();
                }}
              />
            ))}
          </>
        )}

        {/* track */}
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary/80"
            style={{ width: `${Math.min(100, (t / duration) * 100)}%` }}
          />
        </div>

        {/* event ticks */}
        {ticks.map((tick, i) => (
          <span
            key={i}
            className="absolute top-1/2 h-2.5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: `${(tick.t / duration) * 100}%`, background: tick.color }}
            title={`${tick.label} · ${formatOffset(tick.t)}`}
          />
        ))}

        {/* playhead */}
        <span
          className="absolute top-1/2 z-10 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-primary shadow-sm transition-transform group-hover:scale-110"
          style={{ left: `${Math.min(100, (t / duration) * 100)}%` }}
        />

        {/* hover time tooltip */}
        {hoverT != null && (
          <span
            className="pointer-events-none absolute -top-5 -translate-x-1/2 rounded bg-primary px-1.5 py-px font-mono text-[10px] text-primary-foreground"
            style={{ left: `${(hoverT / duration) * 100}%` }}
          >
            {formatOffset(hoverT)}
          </span>
        )}
      </div>
    </div>
  );
}
