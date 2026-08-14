// ABOUTME: Product mockups for the landing page, built as real markup rather than screenshots —
// ABOUTME: so they stay sharp at any zoom, follow the theme, and never go stale when the app moves.
// ABOUTME: The pattern is the one the reference uses: a chromed window, and a second window
// ABOUTME: overlapping it showing the result — the claim and its proof in one image.

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

/** The session detail as it actually is: replay stage on the left, evidence rail on the right. */
export function SessionMockup() {
  const tabs = ["Activity", "Console", "Network", "State"];
  // Deliberately more rows than fit. The list is clipped by its container at every width, so the
  // rail always looks full rather than trailing off into empty panel — and "+442 more" stays true.
  const rows: [string, string, string, boolean][] = [
    ["0:09", "GET", "/api/session", false],
    ["0:11", "GET", "/api/pricing", false],
    ["0:14", "POST", "/api/cart", true],
    ["0:14", "GET", "/api/user", false],
    ["0:15", "POST", "/api/cart", true],
    ["0:19", "GET", "/api/flags", false],
    ["0:21", "GET", "/api/inventory", false],
    ["0:23", "POST", "/api/telemetry", false],
    ["0:26", "GET", "/api/cart", false],
    ["0:31", "GET", "/api/pricing", false],
    ["0:33", "POST", "/api/telemetry", false],
    ["0:38", "GET", "/api/user", false],
  ];
  return (
    <AppWindow title="BF-128 · Request ID: Mismatch Version 3">
      <div className="lp-session">
        <div className="lp-session-stage">
          <div className="lp-stage-chrome">app.emergent.sh/home</div>
          {/* A recognisable checkout, not a generic wireframe: the frame is a moment in a recording,
              and the cursor resting on the disabled button is the moment being reported. */}
          <div className="lp-stage-frame">
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
                {/* The cursor is a child of the button's wrapper, not absolutely placed in the
                    frame — that way it stays on the control at every mockup size. */}
                <span className="lp-stage-cta-wrap">
                  <button type="button" className="lp-stage-cta" disabled>Place order</button>
                  <span className="lp-stage-cursor" aria-hidden="true" />
                </span>
              </div>
            </div>
          </div>
          <div className="lp-stage-timeline">
            <span className="lp-tlbar">
              <i className="lp-tl-flag" style={{ left: "34%" }} />
              <i className="lp-tl-err" style={{ left: "58%" }} />
              <i className="lp-tl-head" style={{ left: "58%" }} />
            </span>
            <span className="lp-tl-time">0:14 / 3:58</span>
          </div>
        </div>
        {/* Absolutely filled from the stage's height, so the over-long row list clips instead of
            stretching the window and squashing the replay beside it. */}
        <div className="lp-session-rail">
         <div className="lp-rail-inner">
          <div className="lp-rail-tabs">
            {tabs.map((t, i) => (
              <span key={t} className={i === 2 ? "is-on" : ""}>{t}</span>
            ))}
          </div>
          <ul className="lp-rail-rows">
            {rows.map(([t, verb, path, failed], i) => (
              <li key={i} className={failed ? "is-hit" : undefined}>
                <b>{t}</b>
                <span>{verb} {path}</span>
                <em className={failed ? "bad" : "ok"}>{failed ? "500" : "200"}</em>
              </li>
            ))}
          </ul>
          <p className="lp-rail-more">+435 more · bodies retained</p>
         </div>
        </div>
      </div>
    </AppWindow>
  );
}

/** The agent, reaching a conclusion from the capture. This is the payoff the product exists for. */
export function AgentMockup() {
  return (
    <AppWindow title="claude · bug-finder mcp" className="lp-win-term">
      <pre className="lp-term">
        <span className="lp-term-cmd">$ claude "why did BF-128 fail?"</span>
        {"\n\n"}
        <span className="lp-term-dim">→ get_session("BF-128")</span>{"\n"}
        <span className="lp-term-ok">✓</span> <span className="lp-term-dim">read console · network · DOM at 0:14      1.2s</span>{"\n"}
        <span className="lp-term-ok">✓</span> <span className="lp-term-dim">447 requests · 1 error · 913 DOM events</span>{"\n\n"}
        <span className="lp-term-label">Root cause</span>{"\n"}
        <span className="lp-term-body">
          {"POST /api/cart returned 500 at 0:14, two frames\nbefore the reporter flagged it. Response body:\n"}
        </span>
        <span className="lp-term-quote">{'  { "error": "variant_id must be an integer" }'}</span>
        <span className="lp-term-body">
          {"\n\nThe qty input posts a string. #checkout stayed\ndisabled because the cart never updated."}
        </span>
        {"\n\n"}
        <span className="lp-term-label">Fix</span>{"\n"}
        <span className="lp-term-body">{"cart.ts:88 — coerce variantId before POST."}</span>
      </pre>
    </AppWindow>
  );
}

/** What the reporter does — one pill, four controls, no form to fill in. */
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
          <span className="lp-rec-stop">■ Stop</span>
        </div>
      </div>
    </AppWindow>
  );
}
