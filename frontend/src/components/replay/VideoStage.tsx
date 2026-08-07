// ABOUTME: Plays the low-bitrate tab video recorded alongside the DOM stream, slaved to the same
// ABOUTME: replay clock so scrubbing, play/pause and speed stay in step with everything else.
import { useEffect, useRef } from "react";
import { storageDownloadUrl } from "@/lib/storage-api";
import type { ReplayClock } from "./useReplayClock";

/** Past this much drift it is worth a seek; below it, correcting looks like stutter. */
const DRIFT_TOLERANCE_S = 0.35;

export function VideoStage({
  fileId,
  clock,
  offset,
}: {
  fileId: string;
  clock: ReplayClock;
  /** Where the trimmed window starts inside the full recording, ms. */
  offset: number;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  // The clock is the single source of truth; the video follows it rather than the other way
  // round, so the timeline, markers and inspector never disagree with what is on screen.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const want = (offset + clock.t) / 1000;
    if (Math.abs(el.currentTime - want) > DRIFT_TOLERANCE_S) el.currentTime = want;
  }, [clock.t, offset]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.playbackRate = clock.speed;
    if (clock.playing) void el.play().catch(() => {});
    else el.pause();
  }, [clock.playing, clock.speed]);

  return (
    <video
      ref={ref}
      src={storageDownloadUrl(fileId)}
      className="h-full w-full bg-black object-contain"
      muted
      playsInline
      preload="auto"
    />
  );
}
