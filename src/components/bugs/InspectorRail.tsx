// ABOUTME: The replay's right-side inspector — Activity / Console / Network / Elements / Info tabs,
// ABOUTME: every row positioned on the replay clock: click seeks, playhead auto-highlights + scrolls.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  Crosshair,
  Globe,
  Info,
  MousePointerClick,
  Navigation,
  Terminal,
} from "lucide-react";
import type { Bug, ConsoleEntry, NetEntry } from "@/lib/types";
import { cn, formatBytes, formatDuration, formatOffset, pathOf, shortName } from "@/lib/utils";
import type { ReplayClock } from "@/components/replay/useReplayClock";

type Tab = "activity" | "console" | "network" | "elements" | "info";

const TABS: { key: Tab; label: string; icon: ReactNode }[] = [
  { key: "activity", label: "Activity", icon: <Activity className="size-3.5" /> },
  { key: "console", label: "Console", icon: <Terminal className="size-3.5" /> },
  { key: "network", label: "Network", icon: <Globe className="size-3.5" /> },
  { key: "elements", label: "Elements", icon: <Crosshair className="size-3.5" /> },
  { key: "info", label: "Info", icon: <Info className="size-3.5" /> },
];

function statusColor(status: number): string {
  if (status === 0) return "var(--muted-foreground)";
  if (status >= 500) return "var(--ev-error)";
  if (status >= 400) return "var(--ev-warn)";
  if (status >= 300) return "var(--ev-input)";
  return "var(--status-resolved)";
}

function levelColor(level: ConsoleEntry["level"]): string {
  switch (level) {
    case "error":
      return "var(--ev-error)";
    case "warn":
      return "var(--ev-warn)";
    case "info":
      return "var(--ev-input)";
    default:
      return "var(--muted-foreground)";
  }
}

/** Row shell shared by every rail list — offset gutter + content, playhead-aware highlight. */
function RailRow({
  t,
  active,
  passed,
  onClick,
  children,
  innerRef,
}: {
  t: number;
  active: boolean;
  passed: boolean;
  onClick: () => void;
  children: ReactNode;
  innerRef?: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={innerRef}
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
        active ? "bg-accent" : "hover:bg-accent/50",
        passed ? "opacity-100" : "opacity-55",
      )}
    >
      <span className="w-8 shrink-0 pt-px text-right font-mono text-[10px] tabular-nums text-muted-foreground">
        {formatOffset(t)}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}

/** Auto-scroll wrapper: keeps the active row in view while playing. */
function useAutoScroll(activeKey: string | null) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (activeKey == null) return;
    const el = refs.current.get(activeKey);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeKey]);
  return (key: string) => (el: HTMLButtonElement | null) => {
    if (el) refs.current.set(key, el);
    else refs.current.delete(key);
  };
}

/* --- Activity tab: everything merged in time order ----------------------- */

interface ActivityItem {
  key: string;
  t: number;
  icon: ReactNode;
  color: string;
  title: string;
  detail?: string;
}

function ActivityList({ bug, clock }: { bug: Bug; clock: ReplayClock }) {
  const items = useMemo<ActivityItem[]>(() => {
    const out: ActivityItem[] = [];
    for (const ev of bug.replay) {
      if (ev.kind === "click")
        out.push({
          key: `c${ev.t}`,
          t: ev.t,
          icon: <MousePointerClick className="size-3.5" />,
          color: "var(--ev-click)",
          title: "Click",
          detail: ev.target,
        });
      else if (ev.kind === "nav")
        out.push({
          key: `n${ev.t}`,
          t: ev.t,
          icon: <Navigation className="size-3.5" />,
          color: "var(--ev-nav)",
          title: "Navigate",
          detail: pathOf(ev.url),
        });
      else if (ev.kind === "input")
        out.push({
          key: `i${ev.t}`,
          t: ev.t,
          icon: <Terminal className="size-3.5" />,
          color: "var(--ev-input)",
          title: `Typed in ${ev.field}`,
          detail: ev.value,
        });
    }
    for (const c of bug.console)
      if (c.level === "error" || c.level === "warn")
        out.push({
          key: `l${c.t}`,
          t: c.t,
          icon: <AlertTriangle className="size-3.5" />,
          color: levelColor(c.level),
          title: c.level === "error" ? "Console error" : "Console warning",
          detail: c.text.split("\n")[0],
        });
    // Replay error events (uncaught exceptions) — skip ones already covered by a console
    // error at the same moment so the same failure isn't listed twice.
    for (const ev of bug.replay)
      if (ev.kind === "error" && !bug.console.some((c) => c.level === "error" && Math.abs(c.t - ev.t) < 150))
        out.push({
          key: `e${ev.t}`,
          t: ev.t,
          icon: <AlertTriangle className="size-3.5" />,
          color: "var(--ev-error)",
          title: "Error",
          detail: ev.message,
        });
    for (const n of bug.network)
      out.push({
        key: `r${n.id}`,
        t: n.t,
        icon: <Globe className="size-3.5" />,
        color: statusColor(n.status),
        title: `${n.method} ${n.status}`,
        detail: shortName(n.url),
      });
    return out.sort((a, b) => a.t - b.t);
  }, [bug]);

  const activeIdx = items.reduce((acc, item, i) => (item.t <= clock.t ? i : acc), -1);
  const setRef = useAutoScroll(activeIdx >= 0 ? items[activeIdx].key : null);

  if (items.length === 0) return <EmptyTab label="No activity captured." />;
  return (
    <div className="flex flex-col gap-px p-1.5">
      {items.map((item, i) => (
        <RailRow
          key={item.key}
          t={item.t}
          active={i === activeIdx}
          passed={item.t <= clock.t}
          onClick={() => clock.seek(item.t)}
          innerRef={setRef(item.key)}
        >
          <span className="flex items-center gap-1.5">
            <span style={{ color: item.color }}>{item.icon}</span>
            <span className="text-[11.5px] font-semibold">{item.title}</span>
          </span>
          {item.detail && (
            <span className="mt-0.5 block truncate font-mono text-[10.5px] text-muted-foreground">{item.detail}</span>
          )}
        </RailRow>
      ))}
    </div>
  );
}

/* --- Console tab ---------------------------------------------------------- */

function ConsoleList({ bug, clock }: { bug: Bug; clock: ReplayClock }) {
  const [filter, setFilter] = useState<"all" | "error">("all");
  // "Errors" means errors — the same predicate as the tab badge, so the numbers always agree.
  const entries = bug.console.filter((c) => filter === "all" || c.level === "error");
  const activeIdx = entries.reduce((acc, e, i) => (e.t <= clock.t ? i : acc), -1);
  const setRef = useAutoScroll(activeIdx >= 0 ? `${entries[activeIdx].t}` : null);
  const errorCount = bug.console.filter((c) => c.level === "error").length;

  if (bug.console.length === 0) return <EmptyTab label="No console output captured." />;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border/60 px-2.5 py-1.5">
        {(["all", "error"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
              filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {f === "all" ? `All ${bug.console.length}` : `Errors ${errorCount}`}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <div className="flex flex-col gap-px p-1.5">
          {entries.map((c, i) => (
            <RailRow
              key={`${c.t}-${i}`}
              t={c.t}
              active={i === activeIdx}
              passed={c.t <= clock.t}
              onClick={() => clock.seek(c.t)}
              innerRef={setRef(`${c.t}`)}
            >
              <span className="flex items-start gap-1.5">
                <span
                  className="mt-1 size-1.5 shrink-0 rounded-full"
                  style={{ background: levelColor(c.level) }}
                />
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-[10.5px] leading-relaxed text-foreground/85">
                  {c.text}
                </span>
                <CopyButton text={c.text} label="Copy console line" />
              </span>
            </RailRow>
          ))}
        </div>
      </div>
    </div>
  );
}

/* --- Network tab ---------------------------------------------------------- */

function NetworkList({ bug, clock }: { bug: Bug; clock: ReplayClock }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const activeIdx = bug.network.reduce((acc, e, i) => (e.t <= clock.t ? i : acc), -1);
  const setRef = useAutoScroll(activeIdx >= 0 ? bug.network[activeIdx].id : null);

  if (bug.network.length === 0) return <EmptyTab label="No network calls captured." />;
  return (
    <div className="flex flex-col gap-px p-1.5">
      {bug.network.map((n, i) => (
        <div key={n.id} className="min-w-0">
          <RailRow
            t={n.t}
            active={i === activeIdx}
            passed={n.t <= clock.t}
            onClick={() => {
              clock.seek(n.t);
              setOpenId(openId === n.id ? null : n.id);
            }}
            innerRef={setRef(n.id)}
          >
            <span className="flex items-center gap-1.5">
              <span className="w-9 shrink-0 font-mono text-[10px] font-bold text-muted-foreground">{n.method}</span>
              <span
                className="shrink-0 rounded px-1 font-mono text-[10px] font-bold text-white"
                style={{ background: statusColor(n.status) }}
              >
                {n.status}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-foreground/85">{shortName(n.url)}</span>
              <span className="shrink-0 font-mono text-[9.5px] text-muted-foreground">{n.durationMs}ms</span>
              <ChevronDown
                className={cn("size-3 shrink-0 text-muted-foreground transition-transform", openId === n.id && "rotate-180")}
              />
            </span>
          </RailRow>
          {openId === n.id && <NetworkDetail entry={n} />}
        </div>
      ))}
    </div>
  );
}

function NetworkDetail({ entry }: { entry: NetEntry }) {
  return (
    <div className="mx-2 mb-1.5 space-y-2 rounded-md border border-border/60 bg-muted/40 p-2.5">
      <div className="flex items-start gap-1.5">
        <p className="min-w-0 flex-1 break-all font-mono text-[10px] text-muted-foreground">{entry.url}</p>
        <CopyButton text={entry.url} label="Copy URL" />
      </div>
      <div className="grid grid-cols-3 gap-2 text-[10px]">
        <Fact label="Status" value={`${entry.status} ${entry.statusText ?? ""}`} wrap />
        <Fact label="Duration" value={`${entry.durationMs} ms`} />
        <Fact label="Size" value={formatBytes(entry.sizeBytes)} />
      </div>
      {entry.requestHeaders && Object.keys(entry.requestHeaders).length > 0 && (
        <DetailSection title="Request headers">
          <HeaderList headers={entry.requestHeaders} />
        </DetailSection>
      )}
      {entry.requestBody && (
        <DetailSection title="Request body">
          <Payload text={entry.requestBody} />
        </DetailSection>
      )}
      {entry.responseHeaders && Object.keys(entry.responseHeaders).length > 0 && (
        <DetailSection title="Response headers">
          <HeaderList headers={entry.responseHeaders} />
        </DetailSection>
      )}
      {entry.responseBody && (
        <DetailSection title="Response body">
          <Payload text={entry.responseBody} />
        </DetailSection>
      )}
    </div>
  );
}

function HeaderList({ headers }: { headers: Record<string, string> }) {
  return (
    <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-2 gap-y-0.5">
      {Object.entries(headers).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="truncate font-mono text-[10px] text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-all font-mono text-[10px] text-foreground/80">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="shrink-0 rounded border border-border/60 bg-card px-1.5 py-0.5 text-[9.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
      title={label}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/* --- Elements tab ---------------------------------------------------------- */

function ElementsList({
  bug,
  clock,
  selectedPick,
  onSelectPick,
}: {
  bug: Bug;
  clock: ReplayClock;
  selectedPick: number | null;
  onSelectPick: (i: number | null) => void;
}) {
  if (bug.pickedElements.length === 0)
    return <EmptyTab label="The reporter didn't pick any elements." />;
  return (
    <div className="flex flex-col gap-1.5 p-2">
      {bug.pickedElements.map((el, i) => (
        <button
          key={i}
          type="button"
          onClick={() => {
            if (selectedPick === i) {
              onSelectPick(null);
            } else {
              onSelectPick(i);
              if (el.t != null) clock.seek(el.t);
            }
          }}
          className={cn(
            "rounded-lg border p-2.5 text-left transition-colors",
            selectedPick === i ? "border-amber-400 bg-amber-50/60" : "border-border/60 hover:border-amber-300 hover:bg-accent/40",
          )}
        >
          <div className="flex items-center gap-1.5">
            <Crosshair className="size-3.5 shrink-0 text-amber-600" />
            <span className="truncate font-mono text-[11px] font-semibold text-foreground">{el.selector}</span>
            {el.t != null && (
              <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">{formatOffset(el.t)}</span>
            )}
          </div>
          {el.component && (
            <p className="mt-1 font-mono text-[10px] text-violet-600">{el.component}</p>
          )}
          {el.text && <p className="mt-1 truncate text-[11px] text-muted-foreground">“{el.text}”</p>}
          {el.note && <p className="mt-1.5 text-[11.5px] leading-relaxed text-foreground/80">{el.note}</p>}
        </button>
      ))}
      <p className="px-1 pt-1 text-[10.5px] leading-relaxed text-muted-foreground">
        Selecting an element highlights it on the replay and seeks to the moment it was picked.
      </p>
    </div>
  );
}

/* --- Info tab ---------------------------------------------------------- */

function InfoPanel({ bug }: { bug: Bug }) {
  const env = bug.environment;
  return (
    <div className="space-y-3 p-3">
      <DetailSection title="Recording">
        <div className="grid grid-cols-2 gap-2">
          <Fact label="Duration" value={formatDuration(bug.durationMs)} />
          <Fact label="Pages visited" value={`${bug.visits.length}`} />
          <Fact label="Console errors" value={`${bug.console.filter((c) => c.level === "error").length}`} />
          <Fact label="Network calls" value={`${bug.network.length}`} />
        </div>
      </DetailSection>
      <DetailSection title="Environment">
        <div className="grid grid-cols-2 gap-2">
          <Fact label="Browser" value={env.browser} />
          <Fact label="OS" value={env.os} />
          <Fact label="Viewport" value={`${env.viewport.w} × ${env.viewport.h} @${env.dpr}x`} />
          <Fact label="Language" value={env.language} />
          <Fact label="Timezone" value={env.timezone} />
          <Fact label="Connection" value={env.connection ?? "—"} />
          <Fact label="Memory" value={env.memoryGb ? `${env.memoryGb} GB` : "—"} />
          <Fact label="CPU cores" value={env.cores ? `${env.cores}` : "—"} />
        </div>
      </DetailSection>
      <DetailSection title="Reporter">
        <div className="grid grid-cols-1 gap-2">
          <Fact label="Name" value={bug.reporter.name} />
          <Fact label="Email" value={bug.reporter.email} />
          <Fact label="Page" value={bug.pageUrl} mono />
        </div>
      </DetailSection>
    </div>
  );
}

/* --- shared atoms ---------------------------------------------------------- */

function EmptyTab({ label }: { label: string }) {
  return <p className="px-4 py-10 text-center text-[12px] text-muted-foreground">{label}</p>;
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground/70">{title}</p>
      {children}
    </div>
  );
}

function Fact({ label, value, mono, wrap }: { label: string; value: string; mono?: boolean; wrap?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[9.5px] font-medium uppercase tracking-wide text-muted-foreground/60">{label}</p>
      <p
        className={cn(
          "text-[11.5px] font-medium text-foreground",
          mono && "font-mono text-[10.5px]",
          wrap ? "break-words" : "truncate",
        )}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

function Payload({ text }: { text: string }) {
  return (
    <div className="relative">
      <pre className="max-h-48 overflow-auto scroll-thin whitespace-pre-wrap break-words rounded bg-card p-2 pr-14 font-mono text-[10px] leading-relaxed text-foreground/85">
        {text}
      </pre>
      <span className="absolute right-1.5 top-1.5">
        <CopyButton text={text} label="Copy body" />
      </span>
    </div>
  );
}

/* --- the rail ---------------------------------------------------------- */

export function InspectorRail({
  bug,
  clock,
  selectedPick,
  onSelectPick,
}: {
  bug: Bug;
  clock: ReplayClock;
  selectedPick: number | null;
  onSelectPick: (i: number | null) => void;
}) {
  const [tab, setTab] = useState<Tab>("activity");
  const errorCount = bug.console.filter((c) => c.level === "error").length;
  const failedRequests = bug.network.filter((n) => n.status >= 400 || n.status === 0).length;

  const badge: Partial<Record<Tab, number>> = {
    console: errorCount || undefined,
    network: failedRequests || undefined,
    elements: bug.pickedElements.length || undefined,
  };
  const redBadge: Partial<Record<Tab, boolean>> = { console: true, network: true };

  return (
    <div className="@container flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card shadow-card">
      {/* Labels collapse to icons in a narrow rail so every tab (incl. Info) stays reachable. */}
      <div className="flex shrink-0 items-center border-b border-border/60 px-1.5 pt-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-label={t.label}
            title={t.label}
            className={cn(
              "relative flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-md px-2.5 py-2 text-[11.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
              tab === t.key ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.icon}
            <span className="hidden @[430px]:inline">{t.label}</span>
            {badge[t.key] != null && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-[9.5px] font-bold",
                  redBadge[t.key] ? "bg-red-100 text-red-600" : "bg-muted text-muted-foreground",
                )}
              >
                {badge[t.key]}
              </span>
            )}
            {tab === t.key && <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-primary" />}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {tab === "activity" && <ActivityList bug={bug} clock={clock} />}
        {tab === "console" && <ConsoleList bug={bug} clock={clock} />}
        {tab === "network" && <NetworkList bug={bug} clock={clock} />}
        {tab === "elements" && (
          <ElementsList bug={bug} clock={clock} selectedPick={selectedPick} onSelectPick={onSelectPick} />
        )}
        {tab === "info" && <InfoPanel bug={bug} />}
      </div>
    </div>
  );
}
