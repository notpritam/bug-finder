// ABOUTME: The privacy policy, at a public URL — the Chrome Web Store will not accept a listing
// ABOUTME: without one, and this extension reads httpOnly cookies, response bodies and the screen,
// ABOUTME: which is several sensitive data categories at once.
// ABOUTME: Written against the extension's source: it talks to exactly two hosts and carries no
// ABOUTME: analytics. If the extension's behaviour changes, this has to change with it — a privacy
// ABOUTME: policy that has drifted from the code is worse than not having one.
import { useNavigate } from "react-router-dom";

/** Kept in one place so the extension version this describes is stated rather than implied. */
const APPLIES_FROM = "0.2.5";
const UPDATED = "14 August 2026";
const CONTACT = "pritam@emergent.sh";

const DASHBOARD_HOST = "auto-fill-dashboard.internal.emergent.host";
const STORAGE_HOST = "storage-api-docs.internal.emergent.host";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="lp-h3 text-[15px]">{title}</h2>
      <div className="lp-legal-body">{children}</div>
    </section>
  );
}

export function PrivacyPage() {
  const navigate = useNavigate();

  return (
    <div className="lp min-h-0 flex-1 overflow-y-auto scroll-thin">
      <header className="lp-header">
        <div className="lp-wrap flex items-center gap-6 py-3.5">
          <button type="button" className="lp-brand" onClick={() => navigate("/")}>
            <span className="lp-brand-dot" aria-hidden="true" />
            Bug&nbsp;Finder
          </button>
          <button type="button" className="lp-navlink ml-auto" onClick={() => navigate("/")}>
            Back to the site
          </button>
        </div>
      </header>

      <div className="lp-wrap lp-legal py-14 sm:py-20">
        <p className="lp-eyebrow lp-accent">Privacy</p>
        <h1 className="lp-title mt-4">Privacy Policy</h1>
        <p className="lp-meta mt-4">
          Last updated {UPDATED} · Applies to the Bug Finder Chrome extension, version {APPLIES_FROM} and
          later.
        </p>

        <Section title="What this extension is">
          <p>
            Bug Finder records a browser session so that a bug report carries the evidence needed to
            diagnose it. It is a debugging tool for software teams. Recording is deliberate: nothing
            is transmitted anywhere until you choose to file a report.
          </p>
        </Section>

        <Section title="What is recorded">
          <p>
            Only while a recording is running, and only for the tab you started it on:
          </p>
          <ul>
            <li>
              <b>The page itself</b> — the DOM at every change, so the session can be replayed. This
              includes text on the page and values you type into form fields.
            </li>
            <li><b>Console output</b> — messages, warnings, errors and their stack traces.</li>
            <li>
              <b>Network activity</b> — requests and responses, including URLs, headers as sent, and
              request and response bodies. Captured through the Chrome DevTools Protocol, which is
              why the extension needs the <code>debugger</code> permission.
            </li>
            <li>
              <b>Cookies for the recorded tab</b>, including <code>httpOnly</code> cookies, which a
              page cannot read itself. These are authentication credentials. They are captured
              because reproducing a bug usually means reproducing the signed-in state it happened in.
            </li>
            <li><b>Storage</b> — localStorage, sessionStorage and IndexedDB writes.</li>
            <li><b>Video of the tab</b>, if you start the recording in a way that includes it.</li>
          </ul>
          <p>
            Before you press record, a rolling buffer of the <b>previous two minutes</b> is held in
            the page, so a failure you have just watched is not already lost. It is discarded when
            you navigate away without recording, and it never leaves your browser unless you file a
            report.
          </p>
          <p className="lp-legal-strong">Not recorded: other tabs and windows, anything outside the
          tab being recorded, any page while no recording is running, and the Bug Finder dashboard
          itself, which is excluded so it never records itself.</p>
        </Section>

        <Section title="Where it goes">
          <p>
            While you are recording and reviewing, everything stays <b>in your browser</b>, in local
            extension storage. Nothing has been transmitted at that point, and discarding the capture
            destroys it.
          </p>
          <p>When you file a report, the recording is sent to two places:</p>
          <ul>
            <li>your Bug Finder dashboard, at <code>{DASHBOARD_HOST}</code>; and</li>
            <li>
              its storage service, at <code>{STORAGE_HOST}</code>, which holds the larger files —
              video and the DOM recording.
            </li>
          </ul>
          <p>
            That is the complete list. There are no analytics, no third-party trackers, no
            advertising identifiers and no other destinations. The extension additionally asks the
            dashboard whether a newer version of itself exists; that request carries the version it
            is running and nothing else.
          </p>
          <p>
            Your recordings are visible to the people with access to your dashboard. They are not
            sold, and they are not shared with anyone else.
          </p>
        </Section>

        <Section title="How long it is kept">
          <p>
            A report you file is kept in your dashboard until someone deletes it. There is no
            automatic expiry. Captures you do not file are never transmitted, and are removed from
            local storage when you discard them.
          </p>
        </Section>

        <Section title="Your control">
          <ul>
            <li>Recording only happens when you start it.</li>
            <li>You review every capture before filing, and can trim what it contains or discard it.</li>
            <li>Unfiled captures never leave the browser.</li>
            <li>Removing the extension deletes the local storage it holds.</li>
            <li>
              To delete a filed report, delete it in the dashboard, or write to us at the address
              below.
            </li>
          </ul>
        </Section>

        <Section title="A caution worth stating plainly">
          <p className="lp-legal-strong">
            Because a recording captures the page, its network traffic and its cookies, it can
            contain passwords, tokens, personal data and anything else visible or transmitted while
            it was running. Treat a recording with the same care as the system it was taken from, and
            prefer test accounts and test data when recording against anything holding real user
            information.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            <a href={`mailto:${CONTACT}`} className="lp-legal-link">{CONTACT}</a>
          </p>
        </Section>

        <Section title="Changes">
          <p>
            If this policy changes, the updated version is published at this URL with a new date at
            the top.
          </p>
        </Section>
      </div>
    </div>
  );
}
