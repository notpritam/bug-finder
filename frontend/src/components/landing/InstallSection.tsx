// ABOUTME: The download, on the landing page itself. A visitor who has decided should not have to
// ABOUTME: find a second page to act on it — /connect still exists for the full setup and the agent
// ABOUTME: side, and this links there, but the zip is one click from the pitch.
// ABOUTME: The version comes from /api/extension/latest, which is unauthenticated precisely so a
// ABOUTME: signed-out visitor (and an extension that has never signed in) can read it. Hardcoding it
// ABOUTME: is how /connect ended up offering 0.2.3 for two releases after 0.2.5 shipped.
import { ArrowUpRight, Download } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useRelease } from "@/lib/extension";

const STEPS: [string, React.ReactNode][] = [
  ["Unzip it", <>Keep the folder somewhere permanent — Chrome loads it from where it sits, so moving it uninstalls the extension.</>],
  ["Open chrome://extensions", <>Turn on <b>Developer mode</b>, top right.</>],
  ["Load unpacked", <>Select the <code>dist</code> folder from the unzipped download.</>],
  ["Pin it", <>Press <code>⌘⇧U</code> on any page to start recording.</>],
];

export function InstallSection() {
  const navigate = useNavigate();
  const release = useRelease();

  return (
    <section id="install" className="lp-rule-b scroll-mt-16">
      <div className="lp-wrap py-14 sm:py-20" data-reveal>
        <div className="lp-install">
          <div className="lp-install-lede">
            <p className="lp-eyebrow lp-accent">Install</p>
            <h2 className="lp-title mt-4 max-w-[18ch]">
              Download it here. <span className="lp-dim">Recording in about a minute.</span>
            </h2>
            <p className="lp-body mt-4 max-w-[44ch]">
              A Chrome extension. It records locally and nothing leaves the browser until someone
              files a report.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              {release ? (
                <a href={release.downloadUrl} download className="lp-btn lp-btn-primary">
                  <Download className="size-3.5" />
                  Download {release.version}
                </a>
              ) : (
                // No version yet: send them to the page that always has one rather than guess a
                // filename. Never renders as a dead download.
                <button type="button" onClick={() => navigate("/connect")} className="lp-btn lp-btn-primary">
                  <Download className="size-3.5" />
                  Get the recorder
                </button>
              )}
              <span className="lp-meta">Chrome 130+ · loads unpacked</span>
            </div>

            <button type="button" onClick={() => navigate("/connect")} className="lp-learn mt-7">
              Full setup, and connecting an agent
              <ArrowUpRight className="size-3.5" />
            </button>
          </div>

          {/* The four steps as grid cells with rules between them, not cards. */}
          <ol className="lp-install-steps">
            {STEPS.map(([title, body], i) => (
              <li key={title}>
                <p className="lp-install-n">{String(i + 1).padStart(2, "0")}</p>
                <p className="lp-install-t">{title}</p>
                <p className="lp-install-b">{body}</p>
              </li>
            ))}
          </ol>
        </div>

        <p className="lp-meta mt-8 max-w-[70ch]">
          Chrome does not auto-update extensions loaded this way, so the recorder checks this
          dashboard itself and says so at the start of a recording when a newer build exists.
        </p>
      </div>
    </section>
  );
}
