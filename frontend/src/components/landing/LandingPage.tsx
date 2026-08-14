// ABOUTME: The page a signed-out visitor lands on. Before this they were dropped onto a login form
// ABOUTME: floating in an empty viewport, which said nothing about what this is.
// ABOUTME: Structure follows the reference the owner cited: a sticky header, a two-tier line system
// ABOUTME: (visible structural rules, near-invisible containment borders), a closed type scale,
// ABOUTME: mono micro-labels at NEGATIVE tracking, heading weight capped at 500, one accent, a
// ABOUTME: numbered card deck, and numbered alternating rows carrying real product mockups.
// ABOUTME: Every figure quotes a real capture — see BF-128.
import { useNavigate } from "react-router-dom";
import { ArrowRight, ArrowUpRight, Bot, Clock, MessageSquareX, Network, Rewind, ScanSearch, Terminal } from "lucide-react";
import { PlatformDeck, type DeckCard } from "./PlatformDeck";
import { AgentMockup, RecorderMockup, ReplayVideo, SessionShot } from "./Mockups";
import { InstallSection } from "./InstallSection";
import { useReveal } from "./useReveal";

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
    stat: { value: "120s", label: "buffered before you press record" },
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
    stat: { value: "0", label: "steps to reproduce written by hand" },
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
    stat: { value: "913", label: "dom events, queryable by time" },
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
    stat: { value: "447", label: "requests captured with bodies" },
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
    stat: { value: "1", label: "line to connect an agent" },
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
    title: "QA relays, badly",
    body: "The tester saw everything. What reaches the developer is a sentence, a screenshot, and whatever they thought to copy out of the console before it cleared.",
  },
  {
    icon: Terminal,
    title: "The developer can’t reproduce it",
    body: "Different machine, different build, different state. So the ticket goes back for steps, and the feature waits on a round trip that has nothing to do with the fix.",
  },
  {
    icon: Clock,
    title: "The agent has nothing to read",
    body: "Hand a coding agent a screenshot and a sentence and it guesses. It can only reach a root cause if someone captured the evidence it needs — and nobody did.",
  },
];

/** The numbered rows, in the reference's `01 / author` register: a rule, a mono label, a two-tone
 *  headline, body, a link, and a large product mockup on the alternating side. */
const ROWS = [
  {
    n: "01",
    kicker: "record",
    lead: "QA presses record.",
    trail: "That is the whole handoff.",
    body: "No console dump to copy out, no steps to write up, no message asking the developer to come and look. The recorder was already buffering the last two minutes, so the moment they noticed the bug is in the capture too. One click files it.",
    mock: <RecorderMockup />,
    to: "/connect",
  },
  {
    n: "02",
    kicker: "replay",
    lead: "The developer opens the session,",
    trail: "not a conversation.",
    body: "The replay is the real DOM at every frame, next to the waterfall, the console, storage and app state — all on the same clock. Scrub to the flag and the failing request is right there, two frames before it. This is a recording of the real thing playing back.",
    mock: <ReplayVideo />,
    to: "#platform",
  },
  {
    n: "03",
    kicker: "triage",
    lead: "An agent reads the capture",
    trail: "and names the cause.",
    body: "Point a coding agent at the session over MCP and it queries the evidence directly — response bodies, DOM state at a timestamp, the console group around the error. It arrives at the cause because the data to reach it was recorded, not described.",
    mock: <AgentMockup />,
    to: "#agents",
  },
];

export function LandingPage() {
  const navigate = useNavigate();
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  useReveal();

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
            <button type="button" className="lp-navlink" onClick={() => jump("flow")}>How it works</button>
            <button type="button" className="lp-navlink" onClick={() => jump("platform")}>Platform</button>
            <button type="button" className="lp-navlink" onClick={() => jump("agents")}>For agents</button>
          </nav>
          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <button type="button" className="lp-navlink" onClick={() => navigate("/auth")}>Sign in</button>
            <button type="button" className="lp-btn lp-btn-primary lp-btn-sm" onClick={() => jump("install")}>
              Install
            </button>
          </div>
        </div>
      </header>

      {/* --------------------------------------------------------------- hero */}
      {/* The mockups do the arguing here. A screenshot of a session next to an agent naming the
          cause from it is the entire pitch; the copy above it just points at them. */}
      <section className="lp-rule-b lp-hero">
        <div className="lp-wrap py-16 sm:py-24">
          <div className="lp-hero-copy" data-reveal>
            <p className="lp-eyebrow lp-accent">Session capture for manual QA</p>
            <h1 className="lp-display mt-5 max-w-[19ch]">
              QA found it. <span className="lp-dim">Now everyone else has to find it again.</span>
            </h1>
            <p className="lp-lede mt-6 max-w-[58ch]">
              Manual QA is fast at finding bugs and slow at handing them over — the console is cleared,
              the steps get retyped, and the developer reproduces from scratch. Bug Finder records the
              session as it happens, so the report arrives with the evidence already in it, and a
              coding agent can reach the root cause without asking anyone a question.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => jump("install")} className="lp-btn lp-btn-primary">
                Install the recorder
                <ArrowRight className="size-3.5" />
              </button>
              <button type="button" onClick={() => jump("flow")} className="lp-btn lp-btn-ghost">
                See the handoff
              </button>
            </div>

            <p className="lp-meta mt-5">
              <Clock className="mr-1.5 inline-block size-3 -translate-y-px align-middle" />
              Chrome extension · records locally · nothing leaves the browser until you file it
            </p>
          </div>

          <div className="lp-hero-art" data-reveal>
            <div className="lp-hero-back">
              <SessionShot />
            </div>
            <div className="lp-hero-front">
              <AgentMockup />
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ problem */}
      <section id="problem" className="lp-rule-b scroll-mt-16">
        <div className="lp-wrap py-14 sm:py-20">
          <div data-reveal>
            <p className="lp-eyebrow">The problem</p>
            <h2 className="lp-title mt-4 max-w-[26ch]">
              The bug is found in a minute and handed over for two days.
            </h2>
          </div>

          <div className="mt-10 grid gap-px lg:grid-cols-3" style={{ background: "var(--lp-line)" }} data-reveal>
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

          <div className="mt-8 grid gap-4 md:grid-cols-2" data-reveal>
            <div className="lp-card lp-card-bad">
              <p className="lp-eyebrow lp-bad">The handoff today</p>
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
              <p className="lp-eyebrow lp-good">The handoff with a capture</p>
              <ol className="mt-4 space-y-3">
                <li className="flex gap-3">
                  <span className="lp-who">QA</span>
                  <span className="lp-said">Records it. Files it. Moves on.</span>
                </li>
                <li className="flex gap-3">
                  <span className="lp-who">Agent</span>
                  <span className="lp-said">Reads the capture, names the failing call and the line.</span>
                </li>
                <li className="flex gap-3">
                  <span className="lp-who">Dev</span>
                  <span className="lp-said">Opens a bug that already has a first pass on it.</span>
                </li>
              </ol>
              <p className="lp-meta mt-5">No relay. The question never gets asked.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- the flow */}
      {/* Numbered alternating rows. The number and the mono kicker carry the sequence, so the
          headings don't have to say "first" and "then". */}
      <section id="flow" className="scroll-mt-16">
        {ROWS.map((r, i) => (
          <div key={r.n} className="lp-rule-b">
            <div className={`lp-wrap lp-row py-14 sm:py-20${i % 2 ? " is-flipped" : ""}`} data-reveal>
              <div className="lp-row-copy">
                <p className="lp-row-n">
                  {r.n} <span>/ {r.kicker}</span>
                </p>
                <h2 className="lp-title mt-5 max-w-[18ch]">
                  {r.lead} <span className="lp-dim">{r.trail}</span>
                </h2>
                <p className="lp-body mt-5 max-w-[46ch]">{r.body}</p>
                <button
                  type="button"
                  onClick={() => (r.to.startsWith("#") ? jump(r.to.slice(1)) : navigate(r.to))}
                  className="lp-learn mt-7"
                >
                  Learn more
                  <ArrowUpRight className="size-3.5" />
                </button>
              </div>
              <div className="lp-row-art">{r.mock}</div>
            </div>
          </div>
        ))}
      </section>

      {/* ----------------------------------------------------------- platform */}
      <section id="platform" className="lp-rule-b scroll-mt-16">
        <div className="lp-wrap py-14 sm:py-20" data-reveal>
          <PlatformDeck
            cards={CARDS}
            aside={
              <>
                <p className="lp-eyebrow">The platform</p>
                <h2 className="lp-title mt-4">Five things a captured session gives you.</h2>
                <p className="lp-body mt-4">
                  None of them ask the reporter for anything. The browser already knew all of it.
                </p>
              </>
            }
          />
        </div>
      </section>

      {/* ----------------------------------------------------------- evidence */}
      <section className="lp-rule-b">
        <div className="lp-wrap py-14 sm:py-20">
          <div data-reveal>
            <p className="lp-eyebrow">What one report carries</p>
            <h2 className="lp-title mt-4 max-w-[26ch]">Measured from a single four-minute recording.</h2>
            <p className="lp-body mt-4 max-w-[56ch]">
              Not a feature list — an actual session sitting in the dashboard, counted.
            </p>
          </div>

          <dl
            className="mt-10 grid grid-cols-2 gap-px overflow-hidden lg:grid-cols-3"
            style={{ background: "var(--lp-line)" }}
            data-reveal
          >
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

      {/* ------------------------------------------------------------- agents */}
      <section id="agents" className="lp-rule-b scroll-mt-16">
        <div className="lp-wrap py-14 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center" data-reveal>
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

      {/* ------------------------------------------------------------- install */}
      <InstallSection />

      {/* ------------------------------------------------------------------ cta */}
      <section className="lp-rule-b">
        <div className="lp-wrap py-16 sm:py-24" data-reveal>
          <h2 className="lp-title max-w-[24ch]">
            Give QA one click. <span className="lp-dim">Give the developer the whole session.</span>
          </h2>
          <p className="lp-body mt-4 max-w-[52ch]">
            Install the recorder, press record on the next bug you find, and hand over a report that
            answers its own questions.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => jump("install")} className="lp-btn lp-btn-primary">
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
            <button type="button" className="lp-navlink" onClick={() => jump("install")}>Install</button>
            <button type="button" className="lp-navlink" onClick={() => navigate("/auth")}>Sign in</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
