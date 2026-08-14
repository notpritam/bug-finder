// ABOUTME: The page a signed-out visitor lands on. Before this, they were dropped straight onto a
// ABOUTME: login form floating in an empty viewport, which said nothing about what this is.
// ABOUTME: Structure follows the reference the owner cited: a two-tier line system (visible
// ABOUTME: structural rules, near-invisible containment borders), a closed type scale, mono
// ABOUTME: micro-labels at NEGATIVE tracking, heading weight capped at 500, and exactly one accent.
// ABOUTME: Every number on this page is measured from a real capture — see EVIDENCE below.
import { useNavigate } from "react-router-dom";
import { ArrowRight, Bot, Clock, Network, Rewind, ScanSearch } from "lucide-react";

/**
 * Real figures from BF-128, a 3m58s recording of app.emergent.sh.
 *
 * Deliberately not rounded and not invented. The whole argument of this product is that a report
 * should carry its evidence, so the landing page quoting made-up evidence would be self-defeating.
 */
const EVIDENCE = [
  { label: "Network calls", value: "447", note: "headers as sent, bodies included" },
  { label: "Cookies", value: "332", note: "97 of them httpOnly" },
  { label: "DOM events", value: "913", note: "replayable frame by frame" },
  { label: "Storage writes", value: "1,890", note: "every key, before and after" },
  { label: "Browser log", value: "94", note: "CORS, CSP, mixed content" },
  { label: "Console", value: "with stacks", note: "printf-interpolated, not [object Object]" },
];

const PILLARS = [
  {
    icon: Rewind,
    label: "Pre-roll",
    title: "It captures the two minutes before you pressed record",
    body: "The failing request and the stack trace are already gone by the time anyone reaches for a record button. So the recorder is always buffering — and since 0.2.4 that buffer survives a page reload, which is the first thing most people do after seeing an error.",
  },
  {
    icon: Network,
    label: "Wire level",
    title: "The real network, not a fetch wrapper's guess",
    body: "Attached through the Chrome DevTools Protocol, so a report carries headers exactly as they went out, response bodies, httpOnly cookies, and the CORS and CSP failures that never reach console.log at all.",
  },
  {
    icon: ScanSearch,
    label: "Time travel",
    title: "Ask what the page looked like at 0:04",
    body: "The replay is a DOM history, not a video. Query a selector at any timestamp, diff it against another, and find the moment a element changed — without opening a browser.",
  },
  {
    icon: Bot,
    label: "For agents",
    title: "A human replays it. An agent debugs it.",
    body: "The same capture is served to coding agents over MCP, with drill-downs into network bodies, console groups and DOM state. One recording, two readers, no translation step in between.",
  },
];

const STEPS = [
  { n: "01", title: "Record", body: "Right-click the page, or press ⌘⇧U. A pill sits in the corner — flag a moment, point at a broken element, draw on the page." },
  { n: "02", title: "Review", body: "Stop, and the side panel opens on what it caught. Trim it, name it, and it tells you exactly what the trim would throw away." },
  { n: "03", title: "File", body: "It lands in the dashboard with the replay, the waterfall, the console and the state attached — and a link you can paste into any thread." },
];

export function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="lp min-h-0 flex-1 overflow-y-auto scroll-thin">
      {/* ---------------------------------------------------------------- hero */}
      <header className="lp-rule-b">
        <div className="lp-wrap py-16 sm:py-24">
          <p className="lp-eyebrow lp-accent">Bug Finder</p>
          <h1 className="lp-display mt-5 max-w-[19ch]">The console was already cleared.</h1>
          <p className="lp-lede mt-6 max-w-[58ch]">
            Every bug report starts the same way — “it’s broken”, a screenshot, and a developer
            asking what was in the console. By then it’s gone. Bug Finder records the session, so
            the answer arrives with the report instead of after it.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => navigate("/connect")} className="lp-btn lp-btn-primary">
              Install the recorder
              <ArrowRight className="size-3.5" />
            </button>
            <button type="button" onClick={() => navigate("/auth")} className="lp-btn lp-btn-ghost">
              Sign in
            </button>
          </div>

          {/* Not a flex row: the text is one node, so on a narrow screen it wrapped as a block and
              left the icon stranded on a line of its own. Inline keeps them together. */}
          <p className="lp-meta mt-5">
            <Clock className="mr-1.5 inline-block size-3 -translate-y-px align-middle" />
            Chrome extension · records locally · nothing leaves the browser until you file it
          </p>
        </div>
      </header>

      {/* ------------------------------------------------------- the round trip */}
      <section className="lp-rule-b">
        <div className="lp-wrap py-14 sm:py-20">
          <p className="lp-eyebrow">The round trip</p>
          <h2 className="lp-title mt-4 max-w-[24ch]">Most of a bug’s life is spent asking for what was already on screen.</h2>

          <div className="mt-10 grid gap-4 md:grid-cols-2">
            <div className="lp-card lp-card-bad">
              <p className="lp-eyebrow lp-bad">Without a recording</p>
              <ol className="mt-4 space-y-3">
                {[
                  ["QA", "“The total doesn’t update.”"],
                  ["Dev", "“What was in the console?”"],
                  ["QA", "“It’s gone now.”"],
                  ["Dev", "“Can you reproduce it?”"],
                ].map(([who, said]) => (
                  <li key={said} className="flex gap-3">
                    <span className="lp-who">{who}</span>
                    <span className="lp-said">{said}</span>
                  </li>
                ))}
              </ol>
              <p className="lp-meta mt-5">Four messages, two days, and the evidence never existed.</p>
            </div>

            <div className="lp-card lp-card-good">
              <p className="lp-eyebrow lp-good">With one</p>
              <ol className="mt-4 space-y-3">
                <li className="flex gap-3">
                  <span className="lp-who">QA</span>
                  <span className="lp-said">Records it. Files it.</span>
                </li>
                <li className="flex gap-3">
                  <span className="lp-who">Dev</span>
                  <span className="lp-said">Opens the replay, scrubs to the flag, reads the 500.</span>
                </li>
              </ol>
              <p className="lp-meta mt-5">One hop. The question never gets asked.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- evidence */}
      <section className="lp-rule-b">
        <div className="lp-wrap py-14 sm:py-20">
          <p className="lp-eyebrow">What a report carries</p>
          <h2 className="lp-title mt-4 max-w-[26ch]">One capture. Everything needed to fix it.</h2>
          <p className="lp-body mt-4 max-w-[56ch]">
            Measured from a single four-minute recording — not a feature list, an actual session
            sitting in the dashboard right now.
          </p>

          <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden lg:grid-cols-3" style={{ background: "var(--lp-line)" }}>
            {EVIDENCE.map((e) => (
              <div key={e.label} className="lp-stat">
                <dt className="lp-eyebrow">{e.label}</dt>
                <dd className="lp-stat-v mt-2">{e.value}</dd>
                <dd className="lp-meta mt-1">{e.note}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* -------------------------------------------------------------- pillars */}
      <section className="lp-rule-b">
        <div className="lp-wrap py-14 sm:py-20">
          <p className="lp-eyebrow">Why it’s different</p>
          <div className="mt-8 grid gap-px lg:grid-cols-2" style={{ background: "var(--lp-line)" }}>
            {PILLARS.map((p) => (
              <article key={p.label} className="lp-pillar">
                <p className="lp-eyebrow lp-accent flex items-center gap-2">
                  <p.icon className="size-3.5" />
                  {p.label}
                </p>
                <h3 className="lp-h3 mt-3 max-w-[26ch]">{p.title}</h3>
                <p className="lp-body mt-3 max-w-[52ch]">{p.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------------- flow */}
      <section className="lp-rule-b">
        <div className="lp-wrap py-14 sm:py-20">
          <p className="lp-eyebrow">How it works</p>
          <div className="mt-8 grid gap-8 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n}>
                {/* Numbered because this genuinely is a sequence — you cannot review before you record. */}
                <p className="lp-step-n">{s.n}</p>
                <h3 className="lp-h3 mt-3">{s.title}</h3>
                <p className="lp-body mt-2">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ cta */}
      <section>
        <div className="lp-wrap py-16 sm:py-24">
          <h2 className="lp-title max-w-[22ch]">Stop asking what was in the console.</h2>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => navigate("/connect")} className="lp-btn lp-btn-primary">
              Install the recorder
              <ArrowRight className="size-3.5" />
            </button>
            <button type="button" onClick={() => navigate("/drafts")} className="lp-btn lp-btn-ghost">
              Look around first
            </button>
          </div>
          <p className="lp-meta mt-8">Bug Finder · records the session, files the evidence</p>
        </div>
      </section>
    </div>
  );
}
