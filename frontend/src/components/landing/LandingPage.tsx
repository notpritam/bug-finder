// ABOUTME: The page a signed-out visitor lands on. Before this they were dropped onto a login form
// ABOUTME: floating in an empty viewport, which said nothing about what this is.
// ABOUTME: Structure follows the reference the owner cited: a sticky header, a two-tier line system
// ABOUTME: (visible structural rules, near-invisible containment borders), a closed type scale,
// ABOUTME: mono micro-labels at NEGATIVE tracking, heading weight capped at 500, one accent, and a
// ABOUTME: numbered card deck for the platform tour. Every figure quotes a real capture — see BF-128.
import { useNavigate } from "react-router-dom";
import { ArrowRight, Bot, Clock, MessageSquareX, Network, Rewind, ScanSearch, Terminal } from "lucide-react";
import { PlatformDeck, type DeckCard } from "./PlatformDeck";

/** Real figures from BF-128, a 3m58s recording of app.emergent.sh. Not rounded, not invented — a
 *  product arguing "a report should carry its evidence" cannot quote made-up evidence. */
const EVIDENCE = [
  { label: "Network calls", value: "447", note: "headers as sent, bodies included" },
  { label: "Cookies", value: "332", note: "97 of them httpOnly" },
  { label: "DOM events", value: "913", note: "replayable frame by frame" },
  { label: "Storage writes", value: "1,890", note: "every key, before and after" },
  { label: "Browser log", value: "94", note: "CORS, CSP, mixed content" },
  { label: "Time to file", value: "1 click", note: "from the page you found it on" },
];

/** A tiny inline mock, so each card shows the artefact rather than an icon standing in for it. */
const Mock = ({ children }: { children: React.ReactNode }) => <div className="lp-mock">{children}</div>;

const CARDS: DeckCard[] = [
  {
    n: "01",
    title: "It is already recording",
    body: "The recorder buffers the last two minutes on every page, whether or not anyone pressed a button. So the failing request and the stack trace that were gone by the time you reached for Record are in the report anyway — and since 0.2.4 they survive a reload, which is the first thing most people do after seeing an error.",
    figure: (
      <Mock>
        <div className="lp-timeline">
          <span className="lp-tl-seg lp-tl-pre">−2:00 buffered</span>
          <span className="lp-tl-mark">▶ Record</span>
          <span className="lp-tl-seg">live capture</span>
        </div>
        <p className="lp-mock-note">The 500 at −0:47 is in the report. Nobody had to predict it.</p>
      </Mock>
    ),
  },
  {
    n: "02",
    title: "The reproduction steps are the recording",
    body: "No one writes “steps to reproduce” again, and no one argues about them. The developer opens the session and watches the exact clicks, scrolls and inputs that led to it, on the exact viewport and build it happened on.",
    figure: (
      <Mock>
        <ol className="lp-steps">
          <li><span>0:03</span> click <code>#checkout</code></li>
          <li><span>0:11</span> input <code>qty = 3</code></li>
          <li><span>0:14</span> POST /api/cart → <b className="lp-bad">500</b></li>
          <li><span>0:14</span> ⚑ flagged “total didn’t update”</li>
        </ol>
      </Mock>
    ),
  },
  {
    n: "03",
    title: "A DOM history, not a video",
    body: "The replay is the real document at every moment, so it can be queried. Ask what an element looked like at 0:04 versus 0:33 and diff the two — without opening a browser, and without asking the reporter anything.",
    figure: (
      <Mock>
        <pre className="lp-code">{`GET /api/bugs/BF-128/dom?t=4000
      &selector=%23checkout-button

{ "disabled": true,
  "text": "Place order",
  "class": "btn is-loading" }`}</pre>
      </Mock>
    ),
  },
  {
    n: "04",
    title: "The network at the wire",
    body: "Attached through the Chrome DevTools Protocol, not a fetch wrapper. Headers exactly as they went out, response bodies, httpOnly cookies, and the CORS and CSP failures that never reach console.log at all.",
    figure: (
      <Mock>
        <table className="lp-net">
          <tbody>
            <tr><td>POST</td><td>/api/cart</td><td className="lp-bad">500</td><td>412ms</td></tr>
            <tr><td>GET</td><td>/api/pricing</td><td>200</td><td>88ms</td></tr>
            <tr><td>GET</td><td>/api/user</td><td>200</td><td>41ms</td></tr>
            <tr><td colSpan={4} className="lp-net-note">+444 more · bodies retained</td></tr>
          </tbody>
        </table>
      </Mock>
    ),
  },
  {
    n: "05",
    title: "An agent reads the same capture",
    body: "Connect a coding agent over MCP and it gets the evidence directly — console groups, network bodies, DOM state at any timestamp. A human replays the session; an agent debugs it. One recording, no translation step between them.",
    figure: (
      <Mock>
        <pre className="lp-code">{`$ claude mcp add bug-finder \\
    --url .../mcp

→ get_session("BF-128")
  447 requests · 1 error
  "POST /api/cart returned 500
   at 0:14, right before the flag"`}</pre>
      </Mock>
    ),
  },
];

const PROBLEMS = [
  {
    icon: MessageSquareX,
    title: "The back-and-forth",
    body: "“It’s broken.” “What was in the console?” “It’s gone now.” Four messages and two days before anyone has looked at the actual failure.",
  },
  {
    icon: Terminal,
    title: "No reproduction",
    body: "A developer who can’t reproduce it can’t fix it. So the bug goes back to QA for steps, or sits open until someone stumbles into it again.",
  },
  {
    icon: Clock,
    title: "Manual QA, twice",
    body: "The tester does the work once to find it and again to document it — screenshots, notes, a guess at what mattered. Most of that is retyping what the browser already knew.",
  },
];

const STEPS = [
  { n: "01", title: "Record", body: "Right-click the page, or ⌘⇧U. A pill sits in the corner — flag a moment, point at a broken element, draw on the page." },
  { n: "02", title: "Review", body: "Stop, and the side panel opens on what it caught. Trim it, name it, and it tells you exactly what the trim would throw away." },
  { n: "03", title: "File", body: "It lands with the replay, the waterfall, the console and the state attached — and a link you can paste into any thread." },
];

export function LandingPage() {
  const navigate = useNavigate();
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="lp min-h-0 flex-1 overflow-y-auto scroll-thin">
      {/* ------------------------------------------------------------- header */}
      <header className="lp-header">
        <div className="lp-wrap flex items-center gap-6 py-3.5">
          <span className="lp-brand">
            <span className="lp-brand-dot" aria-hidden="true" />
            Bug&nbsp;Finder
          </span>
          <nav className="ml-auto hidden items-center gap-6 md:flex" aria-label="Sections">
            <button type="button" className="lp-navlink" onClick={() => jump("problem")}>The problem</button>
            <button type="button" className="lp-navlink" onClick={() => jump("platform")}>Platform</button>
            <button type="button" className="lp-navlink" onClick={() => jump("how")}>How it works</button>
            <button type="button" className="lp-navlink" onClick={() => jump("agents")}>For agents</button>
          </nav>
          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <button type="button" className="lp-navlink" onClick={() => navigate("/auth")}>Sign in</button>
            <button type="button" className="lp-btn lp-btn-primary lp-btn-sm" onClick={() => navigate("/connect")}>
              Install
            </button>
          </div>
        </div>
      </header>

      {/* --------------------------------------------------------------- hero */}
      <section className="lp-rule-b">
        <div className="lp-wrap py-16 sm:py-24">
          <p className="lp-eyebrow lp-accent">Session capture for bug reports</p>
          <h1 className="lp-display mt-5 max-w-[19ch]">The console was already cleared.</h1>
          <p className="lp-lede mt-6 max-w-[58ch]">
            A bug report arrives as a sentence and a screenshot. The developer asks what was in the
            console, what the request returned, what the page looked like — and by then none of it
            exists. Bug Finder records the session, so the answer ships with the report instead of
            two days after it.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => navigate("/connect")} className="lp-btn lp-btn-primary">
              Install the recorder
              <ArrowRight className="size-3.5" />
            </button>
            <button type="button" onClick={() => jump("platform")} className="lp-btn lp-btn-ghost">
              See what it captures
            </button>
          </div>

          <p className="lp-meta mt-5">
            <Clock className="mr-1.5 inline-block size-3 -translate-y-px align-middle" />
            Chrome extension · records locally · nothing leaves the browser until you file it
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------------ problem */}
      <section id="problem" className="lp-rule-b scroll-mt-16">
        <div className="lp-wrap py-14 sm:py-20">
          <p className="lp-eyebrow">The problem</p>
          <h2 className="lp-title mt-4 max-w-[24ch]">
            Most of a bug’s life is spent asking for what was already on screen.
          </h2>

          <div className="mt-10 grid gap-px lg:grid-cols-3" style={{ background: "var(--lp-line)" }}>
            {PROBLEMS.map((p) => (
              <article key={p.title} className="lp-pillar">
                <p className="lp-eyebrow lp-bad flex items-center gap-2">
                  <p.icon className="size-3.5" />
                  {p.title}
                </p>
                <p className="lp-body mt-3 max-w-[42ch]">{p.body}</p>
              </article>
            ))}
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className="lp-card lp-card-bad">
              <p className="lp-eyebrow lp-bad">Without a recording</p>
              <ol className="mt-4 space-y-3">
                {[
                  ["QA", "“The total doesn’t update.”"],
                  ["Dev", "“What was in the console?”"],
                  ["QA", "“It’s gone now.”"],
                  ["Dev", "“Can you write the steps?”"],
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

      {/* ----------------------------------------------------------- platform */}
      <section id="platform" className="lp-rule-b scroll-mt-16">
        <div className="lp-wrap py-14 sm:py-20">
          <p className="lp-eyebrow">The platform</p>
          <h2 className="lp-title mt-4 max-w-[26ch]">Five things a captured session gives you.</h2>
          <p className="lp-body mt-4 max-w-[56ch]">
            None of them ask the reporter for anything. The browser already knew all of it.
          </p>
          <div className="mt-10">
            <PlatformDeck cards={CARDS} />
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- evidence */}
      <section className="lp-rule-b">
        <div className="lp-wrap py-14 sm:py-20">
          <p className="lp-eyebrow">What one report carries</p>
          <h2 className="lp-title mt-4 max-w-[26ch]">Measured from a single four-minute recording.</h2>
          <p className="lp-body mt-4 max-w-[56ch]">
            Not a feature list — an actual session sitting in the dashboard, counted.
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

      {/* ---------------------------------------------------------------- how */}
      <section id="how" className="lp-rule-b scroll-mt-16">
        <div className="lp-wrap py-14 sm:py-20">
          <p className="lp-eyebrow">How it works</p>
          <h2 className="lp-title mt-4 max-w-[22ch]">Three steps, and two of them are optional.</h2>
          <div className="mt-9 grid gap-8 md:grid-cols-3">
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

      {/* ------------------------------------------------------------- agents */}
      <section id="agents" className="lp-rule-b scroll-mt-16">
        <div className="lp-wrap py-14 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="lp-eyebrow lp-accent flex items-center gap-2">
                <Bot className="size-3.5" />
                For agents
              </p>
              <h2 className="lp-title mt-4 max-w-[20ch]">The evidence is machine-readable too.</h2>
              <p className="lp-body mt-4 max-w-[50ch]">
                Connect a coding agent over MCP and it reads the same capture a human replays —
                console groups with stacks, network bodies, app state, and the DOM at any timestamp.
                It can post what it finds back onto the session, so the next person opens a bug that
                already has a first pass on it.
              </p>
              <button type="button" onClick={() => navigate("/connect")} className="lp-btn lp-btn-ghost mt-7">
                Connect an agent
                <ArrowRight className="size-3.5" />
              </button>
            </div>
            <div className="grid gap-px sm:grid-cols-2" style={{ background: "var(--lp-line)" }}>
              {[
                { icon: Rewind, t: "Pre-roll", d: "reaches before Record" },
                { icon: Network, t: "Wire-level", d: "CDP, not a wrapper" },
                { icon: ScanSearch, t: "DOM at t", d: "queryable, diffable" },
                { icon: Bot, t: "MCP + OAuth", d: "one line to connect" },
              ].map((f) => (
                <div key={f.t} className="lp-stat">
                  <f.icon className="size-4 text-[color:var(--lp-accent)]" />
                  <p className="lp-h3 mt-3 text-[15px]">{f.t}</p>
                  <p className="lp-meta mt-1">{f.d}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ cta */}
      <section className="lp-rule-b">
        <div className="lp-wrap py-16 sm:py-24">
          <h2 className="lp-title max-w-[22ch]">Stop asking what was in the console.</h2>
          <p className="lp-body mt-4 max-w-[52ch]">
            Install the recorder, press record on the next bug you find, and hand over a report that
            answers its own questions.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => navigate("/connect")} className="lp-btn lp-btn-primary">
              Install the recorder
              <ArrowRight className="size-3.5" />
            </button>
            <button type="button" onClick={() => navigate("/drafts")} className="lp-btn lp-btn-ghost">
              Look around first
            </button>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------------- footer */}
      <footer>
        <div className="lp-wrap flex flex-wrap items-center gap-x-6 gap-y-2 py-8">
          <span className="lp-brand">
            <span className="lp-brand-dot" aria-hidden="true" />
            Bug&nbsp;Finder
          </span>
          <span className="lp-meta">Records the session, files the evidence.</span>
          <div className="ml-auto flex gap-5">
            <button type="button" className="lp-navlink" onClick={() => navigate("/connect")}>Install</button>
            <button type="button" className="lp-navlink" onClick={() => navigate("/auth")}>Sign in</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
