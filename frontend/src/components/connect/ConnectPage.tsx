// ABOUTME: The onboarding page — install the recorder, then connect an agent. This is the link you
// ABOUTME: send someone, and it has to carry the download because the extension repo is private:
// ABOUTME: a GitHub release is a 404 for anyone who is not a collaborator. Before this, both the
// ABOUTME: build and the MCP address were passed on by word of mouth.
import { useState } from "react";
import {
  Bot,
  Check,
  Copy,
  Download,
  KeyRound,
  RefreshCw,
  MessageSquareCode,
  Search,
  ShieldCheck,
  Terminal,
} from "lucide-react";

import { mcpEndpointUrl } from "@/lib/bugs-api";
import type { AuthUser } from "@/lib/auth";
import { UserAvatar } from "@/components/common/bits";
import { cn } from "@/lib/utils";

/** What an agent gets once it is connected. Grouped by what the agent is doing, not by which
 *  module implements it — someone reading this is deciding whether to bother connecting. */
const TOOLS: { group: string; icon: typeof Search; items: [string, string][] }[] = [
  {
    group: "Find a session",
    icon: Search,
    items: [
      ["list_sessions", "filter by status or initiative"],
      ["get_session", "the full briefing — environment, failed calls, interaction trail"],
    ],
  },
  {
    group: "Read the evidence",
    icon: Bot,
    items: [
      ["get_console", "console with stacks, deduped"],
      ["get_network", "every request the page made"],
      ["get_network_entry", "one request with its headers and bodies"],
      ["get_dom_at", "the DOM at any moment in the recording"],
      ["get_app_state", "Redux / TanStack Query state, rebuilt at any moment"],
      ["get_cookies", "including httpOnly, which the page itself cannot see"],
      ["get_browser_log", "CORS, CSP and mixed-content blocks that never reach console"],
    ],
  },
  {
    group: "Write back",
    icon: MessageSquareCode,
    items: [
      ["post_finding", "post a conclusion — diagrams, tables and code render on the session"],
      ["update_session", "set status, severity or tags. Evidence is never writable"],
    ],
  },
];

export function ConnectPage({ user }: { user: AuthUser | null }) {
  const endpoint = mcpEndpointUrl();
  const command = `claude mcp add --transport http bug-finder ${endpoint}`;

  return (
    // The scroll container every other page has and these two did not. `body` is `overflow:
    // hidden` and this is a direct flex child of a column `main`, so without it the content simply
    // overflowed and was clipped — no scrollbar, no way down. On a 1366×768 laptop that put the
    // whole agent-tools list and both the Authorization and account cards permanently out of
    // reach, on the one page you send a new person to install the recorder.
    <div className="min-h-0 flex-1 overflow-y-auto scroll-thin bg-background">
    <div className="mx-auto w-full max-w-[860px] px-5 py-6">
      <header className="mb-5">
        <h1 className="text-[19px] font-bold tracking-tight">Get set up</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Install the recorder, then point a coding agent at this dashboard. It can read a recorded
          session — the DOM at any moment, the response bodies, the httpOnly cookies — and post what
          it found back onto the thread.
        </p>
      </header>

      {/* Install comes first: the recorder is what produces the sessions everything below reads.
          This is the page to send someone — the extension repo is private, so a release link is a
          404 for anyone who is not a collaborator, and the dashboard is the one place every
          reporter already has. */}
      <Card title="Install the recorder" hint="Chrome" icon={Download} className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/bug-finder-0.2.3.zip"
            download
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Download className="size-3.5" />
            Download Bug Finder 0.2.3
          </a>
          <span className="text-[11.5px] text-muted-foreground">169 KB · Chrome 130+</span>
        </div>
        <ol className="mt-3 grid gap-1.5 text-[12px] text-muted-foreground">
          <li>
            <b className="text-foreground">1.</b> Unzip it. Keep the folder somewhere permanent —
            Chrome loads it from where it sits, so moving or deleting it uninstalls the extension.
          </li>
          <li>
            <b className="text-foreground">2.</b> Open <Code>chrome://extensions</Code> and turn on{" "}
            <b className="text-foreground">Developer mode</b> (top right).
          </li>
          <li>
            <b className="text-foreground">3.</b> Click <b className="text-foreground">Load unpacked</b> and
            select the <Code>dist</Code> folder from the unzipped download.
          </li>
          <li>
            <b className="text-foreground">4.</b> Pin it, then press{" "}
            <Code>⌘⇧U</Code> on any page to start recording.
          </li>
        </ol>
        <p className="mt-3 flex gap-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
          <RefreshCw className="mt-px size-3.5 shrink-0" />
          <span>
            Chrome does not auto-update extensions loaded this way, so the recorder checks this
            dashboard for you and says so at the start of a recording when a newer build exists.
            Updating means downloading again and pressing reload on the extensions page.
          </span>
        </p>
      </Card>

      <Card
        title="Add the server"
        hint="Claude Code"
        icon={Terminal}
      >
        <CopyRow value={command} />
        <p className="mt-2 text-[12px] text-muted-foreground">
          Then run <Code>/mcp</Code> and authorize in the browser. There is no token to copy —
          the server speaks OAuth 2.1, so the sign-in happens where you are already signed in.
        </p>
        <p className="mt-3 text-[12px] text-muted-foreground">
          For any other MCP client, the endpoint is:
        </p>
        <CopyRow value={endpoint} className="mt-1.5" />
      </Card>

      <Card title="What the agent can do" icon={Bot} className="mt-4">
        <div className="space-y-4">
          {TOOLS.map(({ group, icon: Icon, items }) => (
            <div key={group}>
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                <Icon className="size-3.5" />
                {group}
              </p>
              <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]">
                {items.map(([name, what]) => (
                  <div key={name} className="contents">
                    <dt>
                      <Code>{name}</Code>
                    </dt>
                    <dd className="min-w-0 text-muted-foreground">{what}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Card title="Authorization" icon={KeyRound}>
          <dl className="space-y-2 text-[12px]">
            <Row k="Protocol" v="OAuth 2.1 with PKCE" />
            <Row k="Scopes" v="sessions:read · sessions:write" />
            <Row k="Acts as" v={user ? user.name : "whoever authorizes it"} />
          </dl>
          <p className="mt-3 flex gap-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-px size-3.5 shrink-0" />
            <span>
              An agent posts under the account that authorized it, named from its token rather than
              from the request — so a finding cannot be filed under someone else's name.
            </span>
          </p>
        </Card>

        <Card title="Your account" icon={undefined}>
          {user ? (
            <div className="flex items-start gap-3">
              <UserAvatar name={user.name} seed={user.id} size={38} />
              <dl className="min-w-0 flex-1 space-y-2 text-[12px]">
                <Row k="Name" v={user.name} />
                <Row k="Email" v={user.email || "—"} />
                <Row k="Role" v={`${user.role}${user.isAdmin ? " · admin" : ""}`} />
                <Row k="Team" v={user.team} />
              </dl>
            </div>
          ) : (
            <p className="text-[12px] text-muted-foreground">
              You are browsing as a guest. Sign in to connect an agent — it authorizes as you.
            </p>
          )}
        </Card>
      </div>
    </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function Card({
  title,
  hint,
  icon: Icon,
  className,
  children,
}: {
  title: string;
  hint?: string;
  icon?: typeof Bot;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-xl border border-border/60 bg-card p-4 shadow-card", className)}>
      <h2 className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
        {Icon && <Icon className="size-3.5" />}
        {title}
        {hint && <span className="ml-auto font-normal normal-case tracking-normal">{hint}</span>}
      </h2>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-[52px] shrink-0 text-muted-foreground">{k}</dt>
      <dd className="min-w-0 break-words font-medium">{v}</dd>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1 py-px font-mono text-[11.5px]">{children}</code>
  );
}

/** The command is the whole point of the page, so copying it confirms in place — a clipboard
 *  write changes nothing on screen, and silence reads as failure. */
function CopyRow({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        /* clipboard denied — the text is selectable */
      });
  };

  return (
    <div className={cn("flex items-stretch gap-2", className)}>
      <div className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-border/60 bg-muted/30 px-2.5 py-2">
        <code className="whitespace-pre font-mono text-[11.5px]">{value}</code>
      </div>
      <button
        type="button"
        onClick={copy}
        title="Copy to clipboard"
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-lg border border-border/60 px-2.5 text-[11.5px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/50",
          copied && "border-primary/50 text-foreground",
        )}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
