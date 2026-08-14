// ABOUTME: The product, on the landing page. The session views are real captures of the running
// ABOUTME: dashboard — a screenshot and a screen recording of it replaying BF-147, which the built-in
// ABOUTME: demo recorder produced from a genuine rrweb session. Regenerate with scripts/capture.mjs
// ABOUTME: whenever the session UI changes, or these quietly become a picture of an older product.
// ABOUTME: The recorder pill is still drawn: it is extension UI, which lives outside this app.
// ABOUTME: The layout follows the reference — a chromed window, and a second window overlapping it
// ABOUTME: with the result, so the claim and its proof land as one image.

import { useEffect, useRef } from "react";

/** A macOS-style window frame. `title` sits in the bar; children are the content area. */
export function AppWindow({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`lp-win ${className}`}>
      <div className="lp-win-bar">
        <span className="lp-win-dots" aria-hidden="true">
          <i /><i /><i />
        </span>
        <span className="lp-win-title">{title}</span>
      </div>
      <div className="lp-win-body">{children}</div>
    </div>
  );
}

/** The session detail — a real screenshot of the dashboard replaying BF-147, a session produced by
 *  the built-in demo recorder. The replay's own browser chrome inside the frame is the recorded
 *  page; the frame around it is the dashboard. Both are the product, not a drawing of it. */
export function SessionShot() {
  return (
    <AppWindow title="BF-147 · Save profile fails with 500">
      <img
        src="/media/session.webp"
        width={1488}
        height={700}
        alt="The Bug Finder session view: the recorded page replayed at 0:04 with the form filled in and the Save button mid-request, next to an activity list where the failing PUT and the console error are highlighted."
        className="lp-shot"
        loading="lazy"
        decoding="async"
      />
    </AppWindow>
  );
}

/** The same session, playing. Screen-recorded off the running dashboard: the DOM replays, the
 *  playhead moves, and the activity rail highlights each step as it is reached. */
export function ReplayVideo() {
  const ref = useRef<HTMLVideoElement | null>(null);

  // Played on intersection rather than by `autoplay`. Three reasons: autoplay did not fire here
  // even muted, it would pull the file down for visitors who never scroll this far, and it gives
  // reduced-motion a real answer — controls and a poster instead of movement nobody asked for.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      el.controls = true;
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) void el.play().catch(() => { el.controls = true; });
        else el.pause();
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <AppWindow title="BF-147 · Save profile fails with 500">
      {/* The poster is the failure frame, so the story is legible before a byte of video arrives —
          and stays legible if playback never starts. */}
      <video
        ref={ref}
        className="lp-shot"
        width={1488}
        height={700}
        poster="/media/replay-poster.webp"
        muted
        loop
        playsInline
        preload="none"
        aria-label="Screen recording of the Bug Finder replay: the recorded form fills in, Save is pressed, and the failing PUT lights up in the activity rail."
      >
        <source src="/media/replay.webm" type="video/webm" />
        <source src="/media/replay.mp4" type="video/mp4" />
      </video>
    </AppWindow>
  );
}

/** The agent, reaching a conclusion from the capture — the payoff the product exists for.
 *  Every value here is read off BF-147's own API: the request timing and status from
 *  /network/0, the wording and offsets from /console, the flag from the session itself. */
export function AgentMockup() {
  return (
    <AppWindow title="claude · bug-finder mcp" className="lp-win-term">
      <pre className="lp-term">
        <span className="lp-term-cmd">$ claude "why did BF-147 fail?"</span>
        {"\n\n"}
        <span className="lp-term-dim">→ get_session("BF-147")</span>{"\n"}
        <span className="lp-term-ok">✓</span> <span className="lp-term-dim">read console · network · DOM at 0:04</span>{"\n"}
        <span className="lp-term-ok">✓</span> <span className="lp-term-dim">6s recording · 4 console · 1 request</span>{"\n\n"}
        <span className="lp-term-label">Root cause</span>{"\n"}
        <span className="lp-term-body">
          {"PUT /api/profile returned 500 after 903ms, at\n3.376s — before the reporter flagged it at\n4.279s. Response body:\n"}
        </span>
        <span className="lp-term-quote">{'  { "error": "profile service unavailable" }'}</span>
        <span className="lp-term-body">
          {"\n\nThe form holds its error state, so the edit is\nnever persisted. The retry fails identically."}
        </span>
        {"\n\n"}
        <span className="lp-term-label">Next</span>{"\n"}
        <span className="lp-term-body">{"Upstream, not the client — profile service\nwas returning 500 for the whole window."}</span>
      </pre>
    </AppWindow>
  );
}

/** What the reporter does — one pill, no form to fill in.
 *
 *  Drawn rather than captured: the pill is injected by the extension into a CLOSED shadow root, so
 *  nothing outside it can read the markup, and it does not exist anywhere in this app. The controls
 *  below are transcribed from extension/src/content/widget.ts and checked against a real recording
 *  session (Playwright, extension loaded, `bf:start` sent). Two things that check corrected: the
 *  stop button reads "Stop & review", not "Stop", and the earlier drawing was missing Shot and
 *  Note. At rest the middle group is folded away and only the dot, the clock and stop show. */
export function RecorderMockup() {
  return (
    <AppWindow title="shop.example.com">
      <div className="lp-rec">
        <div className="lp-rec-page">
          <div className="lp-stage-nav">
            <span className="lp-stage-logo" />
            <i /><i /><i />
            <span className="lp-stage-cart">2</span>
          </div>
          <div className="lp-stage-cols">
            <div className="lp-stage-hero" />
            <div className="lp-stage-side">
              <span style={{ width: "70%" }} />
              <span style={{ width: "45%" }} />
              <div className="lp-stage-qty">
                <b>qty</b>
                <em>3</em>
              </div>
              <span style={{ width: "58%" }} />
              <button type="button" className="lp-stage-cta" disabled>Place order</button>
            </div>
          </div>
        </div>
        <div className="lp-rec-pill">
          <span className="lp-rec-dot" />
          <b>0:14</b>
          <span className="lp-rec-sep" />
          <span>⚑ Flag</span>
          <span>⌖ Pick</span>
          <span>✎ Draw</span>
          <span>⧉ Shot</span>
          <span>✎ Note</span>
          <span className="lp-rec-stop">■ Stop &amp; review</span>
        </div>
      </div>
    </AppWindow>
  );
}
