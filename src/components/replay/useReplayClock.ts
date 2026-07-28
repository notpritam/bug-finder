// ABOUTME: The replay playback engine — a rAF-driven clock with play/pause/seek/speed,
// ABOUTME: shared by the player stage, timeline, and the synced inspector rail.
import { useCallback, useEffect, useRef, useState } from "react";

export interface ReplayClock {
  /** Current playhead position, ms from recording start. */
  t: number;
  playing: boolean;
  speed: number;
  duration: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (t: number) => void;
  skip: (deltaMs: number) => void;
  setSpeed: (s: number) => void;
}

export function useReplayClock(duration: number): ReplayClock {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const frame = useRef<number | null>(null);
  const last = useRef<number>(0);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  useEffect(() => {
    if (!playing) return;
    last.current = performance.now();
    const loop = (now: number) => {
      const dt = (now - last.current) * speedRef.current;
      last.current = now;
      setT((prev) => {
        const next = prev + dt;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
      frame.current = requestAnimationFrame(loop);
    };
    frame.current = requestAnimationFrame(loop);
    return () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    };
  }, [playing, duration]);

  const play = useCallback(() => {
    // Restart from the top when the recording already ran out.
    setT((prev) => (prev >= duration ? 0 : prev));
    setPlaying(true);
  }, [duration]);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => {
    setPlaying((p) => {
      if (!p) setT((prev) => (prev >= duration ? 0 : prev));
      return !p;
    });
  }, [duration]);
  const seek = useCallback(
    (next: number) => setT(Math.max(0, Math.min(duration, next))),
    [duration],
  );
  const skip = useCallback(
    (delta: number) => setT((prev) => Math.max(0, Math.min(duration, prev + delta))),
    [duration],
  );

  return { t, playing, speed, duration, play, pause, toggle, seek, skip, setSpeed };
}
