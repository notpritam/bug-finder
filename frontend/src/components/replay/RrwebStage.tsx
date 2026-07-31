// ABOUTME: Pixel-accurate replay stage for real extension captures — hosts an rrweb Replayer
// ABOUTME: kept in lockstep with our shared replay clock (play/pause/seek/speed + drift check).
import { useEffect, useRef } from "react";
import { Replayer } from "rrweb";
import "rrweb/dist/style.css";
import type { ReplayClock } from "./useReplayClock";

export function RrwebStage({
  events,
  offset,
  clock,
  scale,
  highlightRect,
}: {
  events: unknown[];
  /** ms into the rrweb stream where our t=0 lives (trim start). */
  offset: number;
  clock: ReplayClock;
  /** Stage-box width / recorded viewport width. */
  scale: number;
  highlightRect: { x: number; y: number; w: number; h: number } | null;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const replayerRef = useRef<Replayer | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || events.length < 2) return;
    const replayer = new Replayer(events as never[], {
      root: host,
      mouseTail: false,
      showWarning: false,
      triggerFocus: false,
      speed: 1,
    });
    replayer.pause(offset);
    replayerRef.current = replayer;
    return () => {
      try {
        replayer.destroy();
      } catch {
        /* already torn down */
      }
      replayerRef.current = null;
      host.innerHTML = "";
    };
  }, [events, offset]);

  // Play/pause/speed follow the shared clock.
  useEffect(() => {
    const replayer = replayerRef.current;
    if (!replayer) return;
    replayer.setConfig({ speed: clock.speed });
    if (clock.playing) replayer.play(offset + clock.t);
    else replayer.pause(offset + clock.t);
    // Intentionally NOT keyed on clock.t: while playing the replayer advances itself; the
    // drift check below re-syncs if the two clocks separate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock.playing, clock.speed, events]);

  // Scrub-sync while paused; drift-correct while playing.
  useEffect(() => {
    const replayer = replayerRef.current;
    if (!replayer) return;
    const target = offset + clock.t;
    if (!clock.playing) {
      replayer.pause(target);
    } else if (Math.abs(replayer.getCurrentTime() - target) > 600) {
      replayer.play(target);
    }
  }, [clock.t, clock.playing, offset]);

  // Fit the recorded page into the stage box.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const wrapper = host.querySelector<HTMLElement>(".replayer-wrapper");
    if (wrapper) {
      wrapper.style.transform = `scale(${scale})`;
      wrapper.style.transformOrigin = "top left";
      wrapper.style.position = "absolute";
      wrapper.style.left = "0";
      wrapper.style.top = "0";
    }
  }, [scale, events]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-white">
      <div ref={hostRef} className="pointer-events-none absolute inset-0 [&_iframe]:border-0" />
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
    </div>
  );
}
