// ABOUTME: The replay's right-side inspector — Activity / Console / Network / Elements / Info tabs,
// ABOUTME: every row positioned on the replay clock: click seeks, playhead auto-highlights + scrolls.
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Globe,
  Image as ImageIcon,
  Info,
  Layers,
  Maximize2,
  Minimize2,
  MousePointerClick,
  Navigation,
  Search,
  Terminal,
  X,
} from "lucide-react";
import type { Bug, ConsoleEntry, NetEntry } from "@/lib/types";
import { fetchStoredJson, storageDownloadUrl } from "@/lib/storage-api";
import { OFFLOADED_EVIDENCE_KEYS } from "@/lib/drafts";
import { expandStorageChanges, type StorageWrite } from "@/lib/storageCompact";
import { cn, formatBytes, formatDuration, formatOffset, pathOf, shortName } from "@/lib/utils";
import { JsonTree, JsonView, TextView, tryParseJson } from "@/components/common/JsonView";
import type { ReplayClock } from "@/components/replay/useReplayClock";

type Tab =
  | "activity"
  | "console"
  | "network"
  | "browserlog"
  | "state"
  | "cookies"
  | "storage"
  | "elements"
  | "shots"
  | "layout"
  | "info";

const TABS: { key: Tab; label: string; icon: ReactNode }[] = [
  { key: "activity", label: "Activity", icon: <Activity className="size-3.5" /> },
  { key: "console", label: "Console", icon: <Terminal className="size-3.5" /> },
  { key: "network", label: "Network", icon: <Globe className="size-3.5" /> },
  // The deep-capture tabs only appear when the capture carries them — see visibleTabs.
  { key: "browserlog", label: "Browser", icon: <Terminal className="size-3.5" /> },
  { key: "state", label: "State", icon: <Layers className="size-3.5" /> },
  { key: "cookies", label: "Cookies", icon: <Info className="size-3.5" /> },
  { key: "storage", label: "Storage", icon: <Layers className="size-3.5" /> },
  { key: "elements", label: "Elements", icon: <Crosshair className="size-3.5" /> },
  { key: "shots", label: "Shots", icon: <ImageIcon className="size-3.5" /> },
  // Only shown when the capture carries layout-debugger evidence (bug.layoutDebug).
  { key: "layout", label: "Layout", icon: <Layers className="size-3.5" /> },
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

/** Which edges of a horizontal scroller still have content behind them. The tab strip scrolls, and
 *  without this there is nothing to tell a reader there are more tabs off the edge. */
function useEdgeFade(ref: RefObject<HTMLDivElement | null>, watch: unknown) {
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth;
      setEdges({ left: el.scrollLeft > 1, right: el.scrollLeft < max - 1 });
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [ref, watch]);
  return edges;
}

/** The one filter box every evidence tab shares. Chrome DevTools puts a filter on each of its
 *  panels for the reason this needs one: a capture with 300 storage keys or 90 cookies is not
 *  readable by scrolling, and the key you want is one you already have a name for. */
function RailSearch({
  value,
  onChange,
  placeholder,
  label,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
  testId?: string;
}) {
  return (
    <label className="relative ml-auto flex min-w-[120px] flex-1 items-center gap-1.5 rounded-md border border-border/60 bg-card px-2 focus-within:border-primary/50">
      <Search className="size-3 shrink-0 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-6 min-w-0 flex-1 border-none bg-transparent text-[11px] outline-none placeholder:text-muted-foreground/60"
        data-testid={testId}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear filter"
          className="grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      )}
    </label>
  );
}

/** Case-insensitive "does any of these fields contain the needle". Every panel's filter asks the
 *  same question over a different set of strings, so they all ask it here. */
function hit(query: string, ...fields: (string | number | undefined | null)[]): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return fields.some((f) => f != null && String(f).toLowerCase().includes(needle));
}

/** Rows hidden by the filter, stated rather than silently missing — a filtered list that looks
 *  like the whole capture is how a reader concludes evidence was never recorded. */
function FilterNote({ shown, total, noun }: { shown: number; total: number; noun: string }) {
  if (shown === total) return null;
  return (
    <div className="px-2.5 py-1 text-[10.5px] text-muted-foreground">
      {shown} of {total} {noun} match the filter.
    </div>
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
  const [query, setQuery] = useState("");
  // "Errors" means errors — the same predicate as the tab badge, so the numbers always agree.
  const entries = bug.console.filter(
    (c) => (filter === "all" || c.level === "error") && hit(query, c.text, c.stack, c.level),
  );
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
        <RailSearch
          value={query}
          onChange={setQuery}
          placeholder="Filter console…"
          label="Filter console output"
          testId="console-search-input"
        />
      </div>
      <FilterNote shown={entries.length} total={bug.console.length} noun="lines" />
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
                  {highlightText(c.text, query)}
                </span>
                <CopyButton text={c.stack ? `${c.text}\n${c.stack}` : c.text} label="Copy console line" />
              </span>
              {c.stack && (
                // The component stack is the part that NAMES the owning surface — collapsed so
                // repeated warnings stay scannable, one click to see where it came from.
                <details className="ml-3 mt-0.5" onClick={(e) => e.stopPropagation()}>
                  <summary className="cursor-pointer select-none text-[10px] text-muted-foreground hover:text-foreground">
                    component stack
                  </summary>
                  <pre className="mt-0.5 whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-muted-foreground">
                    {c.stack}
                  </pre>
                </details>
              )}
            </RailRow>
          ))}
        </div>
      </div>
    </div>
  );
}

/* --- Layout tab ------------------------------------------------------------ */

/** One overlap-relevant slot row, normalised: the overlay's Copy payload flattens rows
 *  ({index,label,realHeight}) while the extension's auto-pull ships snapshot() verbatim
 *  (VirtualRowSlot: {row:{index,label,height}, reserved, delta}). */
type LayoutSlotView = { index: unknown; label: string; reserved: unknown; real: unknown; delta: number };

function layoutSlotView(s: Record<string, unknown>): LayoutSlotView | null {
  const delta = typeof s.delta === "number" ? s.delta : null;
  if (delta === null || Math.abs(delta) <= 1) return null;
  const row = (s.row && typeof s.row === "object" ? s.row : s) as Record<string, unknown>;
  return {
    index: row.index,
    label: String(row.label ?? ""),
    reserved: s.reserved,
    real: (s as { realHeight?: unknown }).realHeight ?? row.height,
    delta,
  };
}

/** Layout-debugger evidence the extension auto-pulled off the page at stop — the page's own
 *  overlap/duplicate-key verdicts plus the slot rows whose real height disagrees with the space
 *  the virtualizer reserved. This is the geometry story a video can only show. */
function LayoutEvidence({ bug }: { bug: Bug }) {
  const layout = (bug.layoutDebug ?? null) as {
    snapshot?: { virtualRows?: unknown[]; virtualRowIssues?: Record<string, unknown>[] | null } | null;
    rowLedgerTail?: unknown[] | null;
  } | null;
  if (!layout) return <EmptyTab label="No layout-debugger evidence on this capture." />;
  const issues = layout.snapshot?.virtualRowIssues ?? [];
  const slots = (layout.snapshot?.virtualRows ?? [])
    .map((s) => layoutSlotView(s as Record<string, unknown>))
    .filter((s): s is LayoutSlotView => s !== null);
  const ledger = layout.rowLedgerTail ?? null;
  return (
    <div className="flex flex-col gap-3 p-3 text-[11px]">
      <div>
        <div className="mb-1.5 font-medium text-foreground">Verdicts</div>
        {issues.length === 0 && (
          <div className="text-muted-foreground">No overlap/gap verdicts at capture time.</div>
        )}
        <div className="flex flex-col gap-1.5">
          {issues.map((issue, i) => (
            <div key={i} className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5">
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "rounded-full px-1.5 py-px text-[9.5px] font-semibold uppercase",
                    issue.severity === "high" ? "bg-red-500/15 text-red-500" : "bg-amber-500/15 text-amber-600",
                  )}
                >
                  {String(issue.severity ?? "?")}
                </span>
                <span className="font-mono font-medium">{String(issue.kind ?? "?")}</span>
                <span className="text-muted-foreground">idx {String(issue.index ?? "?")}</span>
                {typeof issue.amountPx === "number" && (
                  <span className="text-muted-foreground">· {Math.round(issue.amountPx as number)}px</span>
                )}
              </div>
              {typeof issue.detail === "string" && issue.detail && (
                <div className="mt-1 leading-relaxed text-foreground/80">{issue.detail}</div>
              )}
            </div>
          ))}
        </div>
      </div>
      {slots.length > 0 && (
        <div>
          <div className="mb-1.5 font-medium text-foreground">Slots off by ³1px+ (real vs reserved)</div>
          <table className="w-full font-mono text-[10.5px]">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-0.5 pr-2 font-normal">idx</th>
                <th className="py-0.5 pr-2 font-normal">row</th>
                <th className="py-0.5 pr-2 text-right font-normal">reserved</th>
                <th className="py-0.5 pr-2 text-right font-normal">real</th>
                <th className="py-0.5 text-right font-normal">delta</th>
              </tr>
            </thead>
            <tbody>
              {slots.map((s, i) => (
                <tr key={i} className="border-t border-border/40">
                  <td className="py-0.5 pr-2">{String(s.index ?? "?")}</td>
                  <td className="max-w-0 truncate py-0.5 pr-2" title={s.label}>{s.label}</td>
                  <td className="py-0.5 pr-2 text-right">{String(s.reserved ?? "—")}</td>
                  <td className="py-0.5 pr-2 text-right">{String(s.real ?? "—")}</td>
                  <td className={cn("py-0.5 text-right font-semibold", s.delta > 0 ? "text-red-500" : "text-amber-600")}>
                    {s.delta > 0 ? `+${s.delta}` : s.delta}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {Array.isArray(ledger) && ledger.length > 0 && (
        <details>
          <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">
            Measurement ledger tail ({ledger.length} events)
          </summary>
          <div className="mt-1.5 max-h-64 overflow-y-auto scroll-thin rounded-md border border-border/60 bg-muted/30 p-2">
            <JsonTree data={ledger} />
          </div>
        </details>
      )}
    </div>
  );
}

/* --- Network tab (DevTools-style) ------------------------------------------ */

type NetFilter = "all" | "xhr" | "errors";
type NetTab = "headers" | "preview" | "response";

function matchesQuery(n: NetEntry, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  if (n.method.toLowerCase().includes(needle)) return true;
  if (String(n.status).includes(needle)) return true;
  if (n.url.toLowerCase().includes(needle)) return true;
  if ((n.responseBody ?? "").toLowerCase().includes(needle)) return true;
  if ((n.requestBody ?? "").toLowerCase().includes(needle)) return true;
  return false;
}

function NetworkList({ bug, clock }: { bug: Bug; clock: ReplayClock }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<NetTab>("preview");
  const [filter, setFilter] = useState<NetFilter>("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim();
    return bug.network.filter((n) => {
      if (filter === "xhr" && !(n.type === "xhr" || n.type === "fetch")) return false;
      if (filter === "errors" && !(n.status >= 400 || n.status === 0)) return false;
      return matchesQuery(n, q);
    });
  }, [bug.network, filter, query]);

  const activeIdx = filtered.reduce((acc, e, i) => (e.t <= clock.t ? i : acc), -1);
  const setRef = useAutoScroll(activeIdx >= 0 ? filtered[activeIdx].id : null);

  const failedCount = bug.network.filter((n) => n.status >= 400 || n.status === 0).length;
  const xhrCount = bug.network.filter((n) => n.type === "xhr" || n.type === "fetch").length;

  if (bug.network.length === 0) return <EmptyTab label="No network calls captured." />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar: filters + search */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/60 px-2.5 py-1.5">
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
          All <span className="opacity-70">{bug.network.length}</span>
        </FilterChip>
        <FilterChip active={filter === "xhr"} onClick={() => setFilter("xhr")}>
          XHR/Fetch <span className="opacity-70">{xhrCount}</span>
        </FilterChip>
        <FilterChip active={filter === "errors"} onClick={() => setFilter("errors")} danger>
          Errors <span className="opacity-70">{failedCount}</span>
        </FilterChip>
        <RailSearch
          value={query}
          onChange={setQuery}
          placeholder="Filter URL, body, status…"
          label="Filter network requests"
          testId="network-search-input"
        />
      </div>

      {/* Column header — feels like DevTools */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-muted/40 px-2 py-1 text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        <span className="w-8 text-right">t</span>
        <span className="w-10">Method</span>
        <span className="w-10">Status</span>
        <span className="min-w-0 flex-1">Path</span>
        <span className="w-12 text-right">Type</span>
        <span className="w-12 text-right">Size</span>
        <span className="w-12 text-right">Time</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {filtered.length === 0 ? (
          <p className="px-4 py-6 text-center text-[11.5px] text-muted-foreground">
            No requests match your filter.
          </p>
        ) : (
          <div className="flex flex-col gap-px p-1">
            {filtered.map((n, i) => (
              <div key={n.id} className="min-w-0">
                <button
                  ref={setRef(n.id)}
                  type="button"
                  onClick={() => {
                    clock.seek(n.t);
                    setOpenId(openId === n.id ? null : n.id);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left font-mono text-[10.5px] transition-colors",
                    i === activeIdx ? "bg-accent" : "hover:bg-accent/50",
                    n.t <= clock.t ? "opacity-100" : "opacity-60",
                  )}
                  data-testid={`network-row-${n.id}`}
                >
                  <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">
                    {formatOffset(n.t)}
                  </span>
                  <span className="w-10 shrink-0 font-semibold text-foreground/80">{n.method}</span>
                  <span
                    className="w-10 shrink-0 rounded px-1 text-center text-[9.5px] font-bold text-white"
                    style={{ background: statusColor(n.status) }}
                  >
                    {n.status || "—"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-foreground/85" title={n.url}>
                    {highlightText(shortName(n.url), query)}
                  </span>
                  <span className="w-12 shrink-0 text-right text-[9.5px] uppercase text-muted-foreground">
                    {n.type ?? "—"}
                  </span>
                  <span className="w-12 shrink-0 text-right text-muted-foreground">
                    {formatBytes(n.sizeBytes)}
                  </span>
                  <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">
                    {n.durationMs}ms
                  </span>
                  <ChevronDown
                    className={cn(
                      "size-3 shrink-0 text-muted-foreground transition-transform",
                      openId === n.id && "rotate-180",
                    )}
                  />
                </button>
                {openId === n.id && (
                  <NetworkDetail
                    entry={n}
                    query={query}
                    tab={detailTab}
                    onTabChange={setDetailTab}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  danger,
  onClick,
  children,
}: {
  active: boolean;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
        active
          ? danger
            ? "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300"
            : "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function highlightText(text: string, query: string): ReactNode {
  if (!query) return text;
  const q = query.toLowerCase();
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < text.length) {
    const at = lower.indexOf(q, i);
    if (at === -1) {
      parts.push(text.slice(i));
      break;
    }
    if (at > i) parts.push(text.slice(i, at));
    parts.push(
      <mark key={key++} className="rounded-sm bg-amber-200/70 px-px text-inherit dark:bg-amber-400/40">
        {text.slice(at, at + query.length)}
      </mark>,
    );
    i = at + query.length;
  }
  return <>{parts}</>;
}

function NetworkDetail({
  entry,
  query,
  tab,
  onTabChange,
}: {
  entry: NetEntry;
  query: string;
  tab: NetTab;
  onTabChange: (t: NetTab) => void;
}) {
  const responseJson = useMemo(() => tryParseJson(entry.responseBody ?? null), [entry.responseBody]);
  const requestJson = useMemo(() => tryParseJson(entry.requestBody ?? null), [entry.requestBody]);
  const hasRequestBody = (entry.requestBody ?? "").trim().length > 0;
  const hasResponseBody = (entry.responseBody ?? "").trim().length > 0;

  // In-detail search — like DevTools' find-in-response. Falls back to the list query.
  const [localQ, setLocalQ] = useState("");
  const [matchIdx, setMatchIdx] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const q = localQ.trim() !== "" ? localQ : query;

  useEffect(() => setMatchIdx(0), [localQ, tab]);

  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    const marks = Array.from(root.querySelectorAll("mark"));
    setMatchCount(marks.length);
    if (marks.length === 0) return;
    const i = Math.min(matchIdx, marks.length - 1);
    marks.forEach((m, j) => m.classList.toggle("mark-active", j === i));
    marks[i].scrollIntoView({ block: "nearest" });
  }, [q, matchIdx, tab, entry]);

  const step = (dir: 1 | -1) => {
    if (matchCount === 0) return;
    setMatchIdx((i) => (i + dir + matchCount) % matchCount);
  };

  return (
    <div className="mx-2 mb-1.5 space-y-2 rounded-md border border-border/60 bg-muted/30 p-2.5">
      {/* URL row */}
      <div className="flex items-start gap-1.5">
        <p className="min-w-0 flex-1 break-all font-mono text-[10px] text-muted-foreground">
          {highlightText(entry.url, query)}
        </p>
        <CopyButton text={entry.url} label="Copy URL" />
      </div>

      {/* Facts strip */}
      <div className="grid grid-cols-3 gap-2 text-[10px]">
        <Fact label="Status" value={`${entry.status} ${entry.statusText ?? ""}`.trim()} wrap />
        <Fact label="Duration" value={`${entry.durationMs} ms`} />
        <Fact label="Size" value={formatBytes(entry.sizeBytes)} />
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-0.5 border-b border-border/60">
        {(["headers", "preview", "response"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onTabChange(t)}
            className={cn(
              "relative px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wide transition-colors",
              tab === t ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            data-testid={`network-detail-tab-${t}`}
          >
            {t}
            {tab === t && <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-primary" />}
          </button>
        ))}
      </div>

      {/* Find in response — searches keys, values, headers and raw body of this call. */}
      <div className="flex items-center gap-1">
        <label className="relative flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border/60 bg-card px-2 focus-within:border-primary/50">
          <Search className="size-3 shrink-0 text-muted-foreground" />
          <input
            value={localQ}
            onChange={(e) => setLocalQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                step(e.shiftKey ? -1 : 1);
              }
            }}
            placeholder="Search in response…"
            aria-label="Search within this request's headers and bodies"
            className="h-6 min-w-0 flex-1 border-none bg-transparent text-[11px] outline-none placeholder:text-muted-foreground/60"
            data-testid="network-body-search-input"
          />
          {q && (
            <span
              className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground"
              data-testid="network-body-search-count"
            >
              {matchCount ? `${matchIdx + 1}/${matchCount}` : "0/0"}
            </span>
          )}
          {localQ && (
            <button
              type="button"
              onClick={() => setLocalQ("")}
              aria-label="Clear response search"
              className="grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
        </label>
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={matchCount === 0}
          aria-label="Previous match"
          title="Previous match (Shift+Enter)"
          className="grid size-6 shrink-0 place-items-center rounded-md border border-border/60 bg-card text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          data-testid="network-body-search-prev"
        >
          <ChevronUp className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={matchCount === 0}
          aria-label="Next match"
          title="Next match (Enter)"
          className="grid size-6 shrink-0 place-items-center rounded-md border border-border/60 bg-card text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          data-testid="network-body-search-next"
        >
          <ChevronDown className="size-3.5" />
        </button>
      </div>

      <div ref={bodyRef} className="space-y-2">
      {tab === "headers" && (
        <div className="space-y-3">
          <DetailSection title="Request headers">
            {entry.requestHeaders && Object.keys(entry.requestHeaders).length > 0 ? (
              <HeaderList headers={entry.requestHeaders} query={q} />
            ) : (
              <EmptyLine label="No request headers captured." />
            )}
          </DetailSection>
          <DetailSection title="Response headers">
            {entry.responseHeaders && Object.keys(entry.responseHeaders).length > 0 ? (
              <HeaderList headers={entry.responseHeaders} query={q} />
            ) : (
              <EmptyLine label="No response headers captured." />
            )}
          </DetailSection>
        </div>
      )}

      {tab === "preview" && (
        <div className="space-y-3">
          <DetailSection
            title={
              <span className="flex items-center gap-1.5">
                Request payload
                {requestJson != null && (
                  <span className="rounded bg-emerald-100 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                    JSON
                  </span>
                )}
              </span>
            }
          >
            {!hasRequestBody ? (
              <EmptyLine label="No request body." />
            ) : requestJson != null ? (
              <PayloadWithCopy raw={entry.requestBody ?? ""}>
                {q ? <JsonView data={requestJson} search={q} /> : <JsonTree data={requestJson} />}
              </PayloadWithCopy>
            ) : (
              <PayloadWithCopy raw={entry.requestBody ?? ""}>
                <TextView text={entry.requestBody ?? ""} search={q} />
              </PayloadWithCopy>
            )}
          </DetailSection>
          <DetailSection
            title={
              <span className="flex items-center gap-1.5">
                Response preview
                {responseJson != null && (
                  <span className="rounded bg-emerald-100 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                    JSON
                  </span>
                )}
              </span>
            }
          >
            {!hasResponseBody ? (
              <EmptyLine label="No response body." />
            ) : responseJson != null ? (
              <PayloadWithCopy raw={entry.responseBody ?? ""}>
                {q ? <JsonView data={responseJson} search={q} /> : <JsonTree data={responseJson} />}
              </PayloadWithCopy>
            ) : (
              <PayloadWithCopy raw={entry.responseBody ?? ""}>
                <TextView text={entry.responseBody ?? ""} search={q} />
              </PayloadWithCopy>
            )}
          </DetailSection>
        </div>
      )}

      {tab === "response" && (
        <div className="space-y-3">
          <DetailSection title="Raw response body">
            {!hasResponseBody ? (
              <EmptyLine label="No response body." />
            ) : responseJson != null ? (
              <PayloadWithCopy raw={entry.responseBody ?? ""}>
                <JsonView data={responseJson} search={q} />
              </PayloadWithCopy>
            ) : (
              <PayloadWithCopy raw={entry.responseBody ?? ""}>
                <TextView text={entry.responseBody ?? ""} search={q} />
              </PayloadWithCopy>
            )}
          </DetailSection>
        </div>
      )}
      </div>
    </div>
  );
}

function HeaderList({ headers, query }: { headers: Record<string, string>; query: string }) {
  const filtered = Object.entries(headers).filter(
    ([k, v]) => !query || k.toLowerCase().includes(query.toLowerCase()) || v.toLowerCase().includes(query.toLowerCase()),
  );
  if (filtered.length === 0) return <EmptyLine label="No matching headers." />;
  return (
    <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-2 gap-y-0.5">
      {filtered.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="truncate font-mono text-[10px] font-semibold text-[color:var(--json-key)]">
            {highlightText(k, query)}
          </dt>
          <dd className="min-w-0 break-all font-mono text-[10px] text-foreground/80">
            {highlightText(v, query)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function PayloadWithCopy({ raw, children }: { raw: string; children: ReactNode }) {
  return (
    <div className="relative">
      {children}
      <span className="absolute right-1.5 top-1.5">
        <CopyButton text={raw} label="Copy body" />
      </span>
    </div>
  );
}

function EmptyLine({ label }: { label: string }) {
  return <p className="rounded bg-muted/40 px-2 py-1.5 text-[10.5px] italic text-muted-foreground">{label}</p>;
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
            selectedPick === i ? "border-amber-400 bg-amber-50/60 dark:border-amber-500/60 dark:bg-amber-500/10" : "border-border/60 hover:border-amber-300 hover:bg-accent/40 dark:hover:border-amber-500/40",
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
  const build = readAppBuild(bug.appInfo);
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
      {(bug.harFileId || bug.cdp) && (
        <DetailSection title="Full browser capture">
          <div className="grid grid-cols-2 gap-2">
            {bug.harEntryCount ? <Fact label="HAR requests" value={`${bug.harEntryCount}`} /> : null}
            <Fact
              label="Debugger"
              value={bug.cdp?.attached ? "attached" : "not attached"}
            />
          </div>
          {bug.cdp && !bug.cdp.attached && (
            // A capture that is thin because the debugger never attached looks exactly like a
            // page that was quiet. Say which it was, in Chrome's own words.
            <p className="text-[10.5px] leading-snug text-amber-600 dark:text-amber-400">
              Evidence below is incomplete — {bug.cdp.reason ?? "the debugger could not attach"}.
            </p>
          )}
          {bug.harFileId && (
            <a
              href={storageDownloadUrl(bug.harFileId)}
              download={`${bug.humanId}.har`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-muted"
            >
              Download HAR
              <span className="text-muted-foreground">— opens in any Network panel</span>
            </a>
          )}
        </DetailSection>
      )}
      <DetailSection title="App build">
        <div className="grid grid-cols-1 gap-2">
          <Fact label="Version" value={build.version} mono />
          <Fact label="Built at" value={build.builtAt} mono />
          {build.commit ? <Fact label="Commit" value={build.commit} mono /> : null}
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

/* ---------------- app state ---------------- */

/** One RFC 6902 op, rendered as a line a human reads rather than a JSON blob. `remove` and the
 *  old half of a `replace` are the interesting halves — a token going null is the bug more often
 *  than a token appearing. */
function PatchOp({ op }: { op: Record<string, unknown> }) {
  const kind = String(op.op ?? "");
  const path = String(op.path ?? "");
  const color =
    kind === "add" ? "var(--ev-net)" : kind === "remove" ? "var(--ev-error)" : "var(--ev-warn)";
  const sign = kind === "add" ? "+" : kind === "remove" ? "-" : "~";
  let value = "";
  if ("value" in op) {
    try {
      const json = JSON.stringify(op.value);
      value = json === undefined ? String(op.value) : json;
    } catch {
      value = String(op.value);
    }
  }
  return (
    <div className="flex gap-1.5 font-mono text-[10.5px] leading-relaxed">
      <span style={{ color }}>{sign}</span>
      <span className="shrink-0 text-foreground">{path.replace(/\//g, ".").replace(/^\./, "")}</span>
      {value && <span className="min-w-0 flex-1 truncate text-muted-foreground">{value}</span>}
    </div>
  );
}

/** JSON that never throws — patch values come off a live app store and can hold anything. */
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** A change's ops. The first few give the shape of the change; the rest are one click away rather
 *  than dropped, since a forty-op patch is exactly where an unexpected write hides. */
function PatchOps({ ops }: { ops: Record<string, unknown>[] }) {
  const [open, setOpen] = useState(false);
  const shown = open ? ops : ops.slice(0, 6);
  return (
    <>
      {shown.map((op, j) => (
        <PatchOp key={j} op={op} />
      ))}
      {ops.length > 6 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          className="font-mono text-[10.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {open ? "show fewer ops" : `+${ops.length - 6} more ops`}
        </button>
      )}
    </>
  );
}

/** The state timeline. Changes are deltas against a baseline, so the panel follows the replay
 *  clock the way console and network do — scrub to a moment and the change that landed there is
 *  the active row. That pairing is the whole point: a state change next to the click that caused it. */
function StatePanel({ bug, clock }: { bug: Bug; clock: ReplayClock }) {
  const sources = (bug.stateSources ?? []) as {
    id: string;
    kind: string;
    label?: string;
    discoveredVia?: string;
    bytes?: number;
    baseline?: unknown;
  }[];
  const changes = (bug.stateChanges ?? []) as {
    t: number;
    sourceId: string;
    cause?: string;
    patch?: Record<string, unknown>[];
    snapshot?: unknown;
  }[];
  const [only, setOnly] = useState<string>("all");
  const [query, setQuery] = useState("");

  // Built once per capture, not per keystroke: a busy store runs to thousands of changes and each
  // one has to be flattened (cause + store + every op path and value) before it can be searched.
  // Keyed on the bug's own fields, not the coerced locals: those are fresh array literals whenever
  // the capture carries no state, which would defeat the memo on every render.
  const haystacks = useMemo(() => {
    const srcs = (bug.stateSources ?? []) as { id: string; kind: string; label?: string }[];
    const chgs = (bug.stateChanges ?? []) as {
      sourceId: string;
      cause?: string;
      patch?: Record<string, unknown>[];
    }[];
    return chgs.map((c) => {
      const src = srcs.find((s) => s.id === c.sourceId);
      const ops = (c.patch ?? [])
        .map((op) => `${String(op.op ?? "")} ${String(op.path ?? "")} ${safeJson(op.value)}`)
        .join(" ");
      return `${c.cause ?? ""} ${c.sourceId} ${src?.kind ?? ""} ${src?.label ?? ""} ${ops}`.toLowerCase();
    });
  }, [bug.stateChanges, bug.stateSources]);

  const needle = query.trim().toLowerCase();
  const shown = changes.filter(
    (c, i) => (only === "all" || c.sourceId === only) && (!needle || haystacks[i].includes(needle)),
  );
  const activeIdx = shown.reduce((acc, c, i) => (c.t <= clock.t ? i : acc), -1);
  const setRef = useAutoScroll(activeIdx >= 0 ? `${shown[activeIdx].t}` : null);

  if (!sources.length) return <EmptyTab label="No app state captured on this session." />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/60 px-2.5 py-1.5">
        <button
          type="button"
          onClick={() => setOnly("all")}
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
            only === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
          )}
        >
          All {changes.length}
        </button>
        {sources.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setOnly(s.id)}
            title={`${s.kind}${s.label ? ` · ${s.label}` : ""} — found via ${s.discoveredVia ?? "?"}`}
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
              only === s.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {s.label ? `${s.kind}:${s.label}` : s.kind}
          </button>
        ))}
        <RailSearch
          value={query}
          onChange={setQuery}
          placeholder="Filter cause, path, value…"
          label="Filter state changes"
          testId="state-search-input"
        />
      </div>
      <FilterNote shown={shown.length} total={changes.length} noun="changes" />

      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {shown.length === 0 && <EmptyTab label="No changes recorded for this store." />}
        <div className="flex flex-col gap-px p-1.5">
          {shown.map((c, i) => (
            <RailRow
              key={`${c.t}-${i}`}
              t={c.t}
              active={i === activeIdx}
              passed={c.t <= clock.t}
              onClick={() => clock.seek(c.t)}
              innerRef={setRef(`${c.t}`)}
            >
              <div className="min-w-0">
                <div className="truncate text-[11px] text-foreground">
                  {highlightText(c.cause ?? "state change", query)}
                </div>
                <div className="mt-0.5 space-y-0.5">
                  {c.snapshot !== undefined ? (
                    <div className="font-mono text-[10.5px] text-muted-foreground">
                      store replaced wholesale ({JSON.stringify(c.snapshot).length} bytes)
                    </div>
                  ) : (
                    <PatchOps ops={c.patch ?? []} />
                  )}
                </div>
              </div>
            </RailRow>
          ))}
        </div>
      </div>

      <div className="shrink-0 border-t border-border/60 px-2.5 py-1.5 text-[10.5px] text-muted-foreground">
        {sources.length} store{sources.length === 1 ? "" : "s"} · baselines captured at record start; every row is a
        delta against the one before it.
      </div>
    </div>
  );
}

/* ---------------- browser log ---------------- */

/** CORS blocks, CSP violations, mixed content, deprecations. This tab exists because none of it
 *  reaches console.* — a reader looking only at the console concludes nothing happened, when the
 *  browser refused the request before the page ever saw it. */
function BrowserLogPanel({ bug, clock }: { bug: Bug; clock: ReplayClock }) {
  const all = (bug.browserLog ?? []) as {
    t: number;
    source: string;
    level: string;
    text: string;
    url?: string;
  }[];
  const [filter, setFilter] = useState<"all" | "error" | "security">("all");
  const [query, setQuery] = useState("");

  const entries = all.filter(
    (e) =>
      (filter === "all" ? true : filter === "error" ? e.level === "error" : e.source === "security") &&
      hit(query, e.text, e.source, e.level, e.url),
  );
  const activeIdx = entries.reduce((acc, e, i) => (e.t <= clock.t ? i : acc), -1);
  const setRef = useAutoScroll(activeIdx >= 0 ? `${entries[activeIdx].t}` : null);

  if (!all.length) return <EmptyTab label="No browser-level log entries captured." />;
  const counts = {
    error: all.filter((e) => e.level === "error").length,
    security: all.filter((e) => e.source === "security").length,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border/60 px-2.5 py-1.5">
        {(["all", "error", "security"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
              filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {f === "all" ? `All ${all.length}` : f === "error" ? `Errors ${counts.error}` : `Security ${counts.security}`}
          </button>
        ))}
        <RailSearch
          value={query}
          onChange={setQuery}
          placeholder="Filter browser log…"
          label="Filter browser log"
          testId="browserlog-search-input"
        />
      </div>
      <FilterNote shown={entries.length} total={all.length} noun="entries" />
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <div className="flex flex-col gap-px p-1.5">
          {entries.map((e, i) => (
            <RailRow
              key={`${e.t}-${i}`}
              t={e.t}
              active={i === activeIdx}
              passed={e.t <= clock.t}
              onClick={() => clock.seek(e.t)}
              innerRef={setRef(`${e.t}`)}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    className="shrink-0 rounded px-1.5 py-px font-mono text-[9.5px]"
                    style={{
                      background: e.level === "error" ? "color-mix(in srgb, var(--ev-error) 15%, transparent)" : "var(--muted)",
                      color: e.level === "error" ? "var(--ev-error)" : "var(--muted-foreground)",
                    }}
                  >
                    {e.source}
                  </span>
                </div>
                <div className="mt-0.5 whitespace-pre-wrap break-words text-[11px] text-foreground">
                  {highlightText(e.text, query)}
                </div>
                {e.url && <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/70">{e.url}</div>}
              </div>
            </RailRow>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------- storage ---------------- */

/** localStorage / sessionStorage as they stood at stop, with the writes that happened during the
 *  recording listed first — a key that changed mid-session is far more interesting than one that
 *  merely existed. IndexedDB and Cache Storage are summarised rather than dumped. */
function StoragePanel({ bug, clock }: { bug: Bug; clock: ReplayClock }) {
  // Rebuild the values the extension compacted away. A page whose analytics SDK rewrites a 200KB
  // blob per event otherwise produces a 50MB capture, so repeat writes travel as patches against
  // the write before them; this puts the full strings back, byte for byte. Memoised because it
  // rebuilds every value and the panel re-renders on every keystroke in the filter box.
  const writes = useMemo(
    () => expandStorageChanges((bug.storageChanges ?? []) as StorageWrite[]),
    [bug.storageChanges],
  );
  const atStop = (bug.storageAtStop ?? {}) as Record<string, Record<string, unknown>>;
  const idb = bug.indexedDb as Record<string, unknown> | undefined;
  const [query, setQuery] = useState("");

  const origins = Object.entries(atStop);
  const hasAnything = writes.length > 0 || origins.length > 0 || (idb && Object.keys(idb).length > 0);
  if (!hasAnything) return <EmptyTab label="No web storage captured on this session." />;

  const shownWrites = writes.filter((w) => hit(query, w.area, w.op, w.key, w.newValue, w.oldValue));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border/60 px-2.5 py-1.5">
        <RailSearch
          value={query}
          onChange={setQuery}
          placeholder="Filter key, value, area…"
          label="Filter web storage"
          testId="storage-search-input"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
      <div className="flex flex-col gap-3 p-3 text-[11px]">
        <div>
          <div className="mb-1.5 font-medium text-foreground">
            Writes during the recording · {shownWrites.length === writes.length ? writes.length : `${shownWrites.length} of ${writes.length}`}
          </div>
          {writes.length === 0 && (
            <div className="text-muted-foreground">Nothing was written to web storage while recording.</div>
          )}
          {writes.length > 0 && shownWrites.length === 0 && (
            <div className="text-muted-foreground">No writes match the filter.</div>
          )}
          <div className="flex flex-col gap-px">
            {shownWrites.map((w, i) => (
              <button
                key={i}
                type="button"
                onClick={() => clock.seek(w.t)}
                className="flex items-baseline gap-2 rounded px-1 py-0.5 text-left hover:bg-muted/50"
              >
                <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground/70">{formatOffset(w.t)}</span>
                <span
                  className="shrink-0 font-mono text-[10.5px]"
                  style={{ color: w.op === "remove" || w.op === "clear" ? "var(--ev-error)" : "var(--ev-net)" }}
                >
                  {w.op === "remove" ? "-" : w.op === "clear" ? "×" : "+"}
                </span>
                <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">{w.area}</span>
                <span className="truncate font-mono text-[10.5px] text-foreground">
                  {highlightText(w.key ?? "(all keys)", query)}
                </span>
                {w.newValue && (
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground/70">
                    {highlightText(w.newValue, query)}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {origins.map(([origin, areas]) => (
          <div key={origin}>
            <div className="mb-1.5 truncate font-medium text-foreground" title={origin}>
              {origin}
            </div>
            {Object.entries(areas as Record<string, Record<string, string>>).map(([area, kv]) => (
              <KvTable key={area} area={area} kv={kv ?? {}} query={query} />
            ))}
          </div>
        ))}

        {idb && Object.keys(idb).length > 0 && (
          <div>
            <div className="mb-1.5 font-medium text-foreground">IndexedDB</div>
            {Object.entries(idb).map(([name, db]) => {
              const stores = (db as { stores?: Record<string, unknown[]> })?.stores ?? {};
              return (
                <div key={name} className="mb-1 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5">
                  <div className="font-mono text-[10.5px] text-foreground">{name}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                    {Object.entries(stores)
                      .map(([s, rows]) => `${s} (${Array.isArray(rows) ? rows.length : "?"})`)
                      .join(" · ") || "no object stores"}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

/** One storage area, rendered the way DevTools renders one: a Key/Value table. */
function KvTable({ area, kv, query }: { area: string; kv: Record<string, string>; query: string }) {
  const total = Object.keys(kv).length;
  const pairs = Object.entries(kv).filter(([k, v]) => hit(query, k, String(v ?? "")));
  if (!total) return null;
  return (
    <div className="mb-2">
      <div className="mb-1 flex items-baseline gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{area}</span>
        <span className="text-[10px] text-muted-foreground/70">
          {pairs.length === total ? total : `${pairs.length} of ${total}`}
        </span>
      </div>
      {pairs.length === 0 ? (
        <div className="px-1 text-[10.5px] text-muted-foreground">No keys match the filter.</div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border/60">
          <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            <span className="w-1/3 min-w-0">Key</span>
            <span className="min-w-0 flex-1">Value</span>
          </div>
          {pairs.map(([k, v]) => (
            <KvRow key={k} name={k} value={String(v ?? "")} query={query} />
          ))}
        </div>
      )}
    </div>
  );
}

/** A storage row. Collapsed it is one line so the area stays scannable; opened it gives the whole
 *  value, because these are routinely serialised blobs many times wider than the rail and the tail
 *  of a redux-persist payload is exactly where the wrong state hides. */
function KvRow({ name, value, query }: { name: string; value: string; query: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border/40 last:border-b-0 odd:bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-baseline gap-2 px-1.5 py-1 text-left hover:bg-accent/50"
      >
        <span className="w-1/3 min-w-0 break-all font-mono text-[10.5px] text-foreground">
          {highlightText(name, query)}
        </span>
        <span className={cn("min-w-0 flex-1 font-mono text-[10px] text-muted-foreground", !open && "truncate")}>
          {open ? `${value.length} bytes` : highlightText(value, query)}
        </span>
        <ChevronDown className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="px-1.5 pb-1.5">
          <div className="mb-1 flex items-center justify-end">
            <CopyButton text={value} label={`Copy value of ${name}`} />
          </div>
          <StoredValue text={value} />
        </div>
      )}
    </div>
  );
}

/** Storage values are almost always JSON that was stringified to fit a string-only store. Showing
 *  the parsed tree is the difference between reading state and reading an escaped one-liner. */
function StoredValue({ text }: { text: string }) {
  const parsed = tryParseJson(text);
  if (parsed && typeof parsed === "object") {
    return (
      <div className="max-h-56 overflow-auto rounded bg-muted/50 p-1.5 scroll-thin">
        <JsonTree data={parsed} />
      </div>
    );
  }
  return (
    <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-1.5 font-mono text-[10px] leading-relaxed text-foreground scroll-thin">
      {text}
    </pre>
  );
}

/* ---------------- cookies ---------------- */

/** Cookies at stop, with the httpOnly ones surfaced first — those are the session cookies the
 *  page itself is forbidden to read, so they are both the most useful and the ones no other
 *  bug report can carry. Changes during the recording are listed underneath. */
function CookiesPanel({ bug }: { bug: Bug }) {
  const cookies = ((bug.cookiesAtStop ?? bug.cookiesAtStart ?? []) as {
    name: string;
    value: string;
    domain: string;
    path: string;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: string;
    session?: boolean;
    expirationDate?: number;
  }[]).slice();
  const changes = (bug.cookieChanges ?? []) as {
    t: number;
    cause: string;
    removed: boolean;
    cookie: { name: string; domain: string };
  }[];
  const [onlyHttpOnly, setOnlyHttpOnly] = useState(false);
  const [query, setQuery] = useState("");

  if (!cookies.length) return <EmptyTab label="No cookies captured on this session." />;

  cookies.sort((a, b) => Number(Boolean(b.httpOnly)) - Number(Boolean(a.httpOnly)) || a.name.localeCompare(b.name));
  const httpOnlyCount = cookies.filter((c) => c.httpOnly).length;
  const shown = cookies.filter(
    (c) => (!onlyHttpOnly || c.httpOnly) && hit(query, c.name, c.value, c.domain, c.path, c.sameSite),
  );
  const shownChanges = changes.filter((ch) => hit(query, ch.cookie?.name, ch.cookie?.domain, ch.cause));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border/60 px-2.5 py-1.5">
        <button
          type="button"
          onClick={() => setOnlyHttpOnly(false)}
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
            !onlyHttpOnly ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
          )}
        >
          All {cookies.length}
        </button>
        <button
          type="button"
          onClick={() => setOnlyHttpOnly(true)}
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
            onlyHttpOnly ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
          )}
        >
          httpOnly {httpOnlyCount}
        </button>
        <RailSearch
          value={query}
          onChange={setQuery}
          placeholder="Filter name, value, domain…"
          label="Filter cookies"
          testId="cookies-search-input"
        />
      </div>
      <FilterNote shown={shown.length} total={cookies.length} noun="cookies" />

      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <div className="flex flex-col gap-1 p-1.5">
          {shown.length === 0 && (
            <p className="px-2 py-6 text-center text-[11.5px] text-muted-foreground">No cookies match your filter.</p>
          )}
          {shown.map((c, i) => (
            <CookieRow key={`${c.domain}|${c.path}|${c.name}|${i}`} c={c} query={query} />
          ))}
        </div>

        {shownChanges.length > 0 && (
          <div className="border-t border-border/60 p-1.5">
            <div className="px-1 pb-1 text-[10.5px] font-medium text-foreground">
              Changed during the recording · {shownChanges.length}
              {shownChanges.length !== changes.length ? ` of ${changes.length}` : ""}
            </div>
            {/* Every change, not the first 60: the cookie that got cleared is as often the last
                one as the first, and a list that silently stops reads as a list that ended. */}
            <div className="flex flex-col gap-px">
              {shownChanges.map((ch, i) => (
                <div key={i} className="flex items-baseline gap-2 px-1 font-mono text-[10.5px]">
                  <span className="shrink-0 text-muted-foreground/70">{formatOffset(ch.t)}</span>
                  <span style={{ color: ch.removed ? "var(--ev-error)" : "var(--ev-net)" }}>
                    {ch.removed ? "-" : "+"}
                  </span>
                  <span className="truncate text-foreground">{highlightText(ch.cookie?.name ?? "", query)}</span>
                  <span className="shrink-0 text-muted-foreground/70">{ch.cause}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** One cookie. Collapsed it is a scannable three-line card; opened it gives the untruncated value
 *  and the attributes DevTools puts in columns — a session cookie's value is the thing a developer
 *  actually needs to paste somewhere, and truncating it makes the capture useless for that. */
function CookieRow({
  c,
  query,
}: {
  c: {
    name: string;
    value: string;
    domain: string;
    path: string;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: string;
    session?: boolean;
    expirationDate?: number;
  };
  query: string;
}) {
  const [open, setOpen] = useState(false);
  const expires = c.session
    ? "session"
    : c.expirationDate
      ? new Date(c.expirationDate * 1000).toLocaleString()
      : "—";
  return (
    <div className="rounded-md border border-border/60 bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full flex-col items-stretch gap-0.5 px-2.5 py-1.5 text-left hover:bg-muted/50"
      >
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium text-foreground">
            {highlightText(c.name, query)}
          </span>
          {c.httpOnly && (
            <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-px font-mono text-[9.5px] text-amber-600 dark:text-amber-400">
              httpOnly
            </span>
          )}
          {c.secure && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-px font-mono text-[9.5px] text-muted-foreground">secure</span>
          )}
          {c.sameSite && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-px font-mono text-[9.5px] text-muted-foreground">
              {c.sameSite}
            </span>
          )}
          <ChevronDown className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </span>
        <span className={cn("font-mono text-[10.5px] text-muted-foreground", !open && "truncate")}>
          {open ? c.value : highlightText(c.value, query)}
        </span>
        <span className="truncate font-mono text-[10px] text-muted-foreground/70">
          {highlightText(`${c.domain}${c.path}`, query)}
          {c.session ? " · session" : ""}
        </span>
      </button>
      {open && (
        <div className="border-t border-border/60 px-2.5 py-1.5">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground/70">Value</span>
            <CopyButton text={c.value} label={`Copy value of ${c.name}`} />
          </div>
          <pre className="mb-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-1.5 font-mono text-[10px] leading-relaxed text-foreground scroll-thin">
            {c.value}
          </pre>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
            <span className="text-muted-foreground/70">Domain</span>
            <span className="break-all text-foreground">{c.domain}</span>
            <span className="text-muted-foreground/70">Path</span>
            <span className="break-all text-foreground">{c.path}</span>
            <span className="text-muted-foreground/70">Expires</span>
            <span className="break-all text-foreground">{expires}</span>
            <span className="text-muted-foreground/70">Size</span>
            <span className="text-foreground">{c.name.length + c.value.length} B</span>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailSection({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground/70">{title}</p>
      {children}
    </div>
  );
}

/** The build the bug happened ON, read off the page at capture time. Worth its own section:
 *  it decides whether a report is even still reproducible, and a fix that merged minutes after
 *  the release cut is absent from production while looking shipped everywhere else. "Not
 *  captured" is a real answer too — an old content script records nothing here, and silence
 *  reads as "same build as today", which is exactly when it is not. */
function readAppBuild(appInfo: unknown): { version: string; builtAt: string; commit?: string } {
  const info = appInfo && typeof appInfo === "object" ? (appInfo as Record<string, unknown>) : null;
  const str = (key: string): string | undefined => {
    const v = info?.[key];
    return typeof v === "string" || typeof v === "number" ? String(v) : undefined;
  };
  if (!info || info.status === "unavailable") {
    const why = typeof info?.reason === "string" ? info.reason : "not captured";
    return { version: `⚠ ${why}`, builtAt: "—" };
  }
  const raw = str("__BUILD_TIME__");
  // Keep it comparable to a git log by eye — that comparison is the whole point of the field.
  const builtAt = raw ? raw.replace("T", " ").replace(/\.\d+Z$/, "Z") : "—";
  return {
    version: str("__APP_VERSION__") ?? str("__VERSION__") ?? "—",
    builtAt,
    commit: str("__BUILD_COMMIT__") ?? str("__BUILD_ID__"),
  };
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
  // Legacy — kept as a fallback if callers outside this file exist. Prefer JsonView / TextView.
  return (
    <pre className="max-h-48 overflow-auto scroll-thin whitespace-pre-wrap break-words rounded bg-card p-2 font-mono text-[10px] leading-relaxed text-foreground/85">
      {text}
    </pre>
  );
}
void Payload;

/* --- the rail ---------------------------------------------------------- */

/** Rows rendered from this browser's IndexedDB carry every field inline. A row that came from
 *  the server (agent share, another device) instead carries `evidenceFileId`: the heavy fields
 *  — network, console, replay, state, cookies, storage, browser log — are ALWAYS offloaded to
 *  one storage file at publish time. Fetch and merge that file so the tabs render identically
 *  either way, instead of showing empty panels for exactly the large captures. */
function useOffloadedEvidence(source: Bug): { bug: Bug; evidenceLoading: boolean; evidenceError: string | null } {
  const asRecord = source as unknown as Record<string, unknown>;
  const offloaded = Boolean(
    source.evidenceFileId && OFFLOADED_EVIDENCE_KEYS.some((k) => asRecord[k] === undefined),
  );
  const [fetched, setFetched] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setFetched(null);
    setError(null);
    if (!offloaded || !source.evidenceFileId) return;
    let alive = true;
    fetchStoredJson<Record<string, unknown>>(source.evidenceFileId)
      .then((data) => {
        if (alive) setFetched(data);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [source.evidenceFileId, offloaded]);
  const bug = useMemo<Bug>(() => {
    const out: Record<string, unknown> = { ...asRecord };
    if (fetched) {
      for (const k of OFFLOADED_EVIDENCE_KEYS) {
        if (out[k] === undefined && fetched[k] !== undefined) out[k] = fetched[k];
      }
    }
    // Lists the type marks required but a slim server row omits — a tab must never crash on them.
    out.console ??= [];
    out.network ??= [];
    out.replay ??= [];
    out.pickedElements ??= [];
    return out as unknown as Bug;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, fetched]);
  return { bug, evidenceLoading: offloaded && !fetched && !error, evidenceError: error };
}

export function InspectorRail({
  bug: bugProp,
  clock,
  selectedPick,
  onSelectPick,
}: {
  bug: Bug;
  clock: ReplayClock;
  selectedPick: number | null;
  onSelectPick: (i: number | null) => void;
}) {
  const { bug, evidenceLoading, evidenceError } = useOffloadedEvidence(bugProp);
  const [tab, setTab] = useState<Tab>("activity");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen().catch(() => {});
  };

  const errorCount = bug.console.filter((c) => c.level === "error").length;
  const failedRequests = bug.network.filter((n) => n.status >= 400 || n.status === 0).length;

  const layoutIssueCount = Array.isArray(
    (bug.layoutDebug as { snapshot?: { virtualRowIssues?: unknown[] } } | undefined)?.snapshot?.virtualRowIssues,
  )
    ? ((bug.layoutDebug as { snapshot: { virtualRowIssues: unknown[] } }).snapshot.virtualRowIssues.length as number)
    : 0;
  const badge: Partial<Record<Tab, number>> = {
    console: errorCount || undefined,
    network: failedRequests || undefined,
    elements: bug.pickedElements.length || undefined,
    layout: layoutIssueCount || undefined,
  };
  const redBadge: Partial<Record<Tab, boolean>> = { console: true, network: true, layout: true };
  // The Layout tab only exists when the capture carries evidence — an empty tab teaches
  // reporters the feature is broken rather than optional. While offloaded evidence is still
  // downloading, the inline counts stand in so tabs don't blink out and back.
  const counts = bug.evidenceCounts;
  const visibleTabs = TABS.filter((t) => {
    if (t.key === "layout") return Boolean(bug.layoutDebug);
    if (t.key === "state") return Boolean(bug.stateSources?.length || counts?.stateSources);
    if (t.key === "cookies")
      return Boolean(bug.cookiesAtStop?.length || bug.cookiesAtStart?.length || counts?.cookies);
    if (t.key === "browserlog") return Boolean(bug.browserLog?.length || counts?.browserLog);
    if (t.key === "storage")
      return Boolean(
        bug.storageChanges?.length ||
          Object.keys((bug.storageAtStop ?? {}) as Record<string, unknown>).length ||
          Object.keys((bug.indexedDb ?? {}) as Record<string, unknown>).length ||
          counts?.storageChanges,
      );
    return true;
  });

  const tabEdges = useEdgeFade(tabStripRef, visibleTabs.length);

  // Selecting a tab that is scrolled out of the strip would otherwise look like nothing happened.
  useEffect(() => {
    tabStripRef.current
      ?.querySelector<HTMLElement>(`[data-tab="${tab}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);

  return (
    <div
      ref={rootRef}
      className="@container flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card shadow-card [&:fullscreen]:rounded-none"
    >
      {/* Labels collapse to icons in a narrow rail, but with eleven tabs even icons overflow one —
          and an overflowed tab used to be simply unreachable, since the rail clips. The strip
          scrolls horizontally instead, keeps the selected tab in view, and fades whichever edge
          still has tabs behind it. Fullscreen sits outside the scroller so it stays pinned. */}
      <div className="flex shrink-0 items-stretch gap-1 border-b border-border/60 pl-1.5 pr-1 pt-1.5">
        <div className="relative min-w-0 flex-1">
          <div ref={tabStripRef} role="tablist" className="flex items-center overflow-x-auto scroll-none">
            {visibleTabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                data-tab={t.key}
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
                      redBadge[t.key] ? "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {badge[t.key]}
                  </span>
                )}
                {tab === t.key && <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-primary" />}
              </button>
            ))}
          </div>
          {tabEdges.left && (
            <span className="pointer-events-none absolute inset-y-0 left-0 w-5 bg-gradient-to-r from-card to-transparent" />
          )}
          {tabEdges.right && (
            <span className="pointer-events-none absolute inset-y-0 right-0 w-5 bg-gradient-to-l from-card to-transparent" />
          )}
        </div>
        <button
          type="button"
          onClick={toggleFullscreen}
          className="my-auto grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          aria-label={fullscreen ? "Exit fullscreen" : "Expand inspector to fullscreen"}
          data-testid="inspector-fullscreen-btn"
        >
          {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </button>
      </div>
      {evidenceLoading && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-1.5 text-[11.5px] text-muted-foreground">
          <span className="size-3 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-transparent" />
          Fetching full evidence (network, console, state…) from storage…
        </div>
      )}
      {evidenceError && (
        <div className="shrink-0 border-b border-border/60 bg-red-50 px-3 py-1.5 text-[11.5px] font-medium text-red-700 dark:bg-red-500/10 dark:text-red-400">
          Couldn't fetch the offloaded evidence file: {evidenceError}. Tabs may look thinner than the capture really was.
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {tab === "activity" && <ActivityList bug={bug} clock={clock} />}
        {tab === "console" && <ConsoleList bug={bug} clock={clock} />}
        {tab === "network" && <NetworkList bug={bug} clock={clock} />}
        {tab === "shots" && <ShotList bug={bug} clock={clock} />}
        {tab === "elements" && (
          <ElementsList bug={bug} clock={clock} selectedPick={selectedPick} onSelectPick={onSelectPick} />
        )}
        {tab === "browserlog" && <BrowserLogPanel bug={bug} clock={clock} />}
        {tab === "state" && <StatePanel bug={bug} clock={clock} />}
        {tab === "cookies" && <CookiesPanel bug={bug} />}
        {tab === "storage" && <StoragePanel bug={bug} clock={clock} />}
        {tab === "layout" && <LayoutEvidence bug={bug} />}
        {tab === "info" && <InfoPanel bug={bug} />}
      </div>
    </div>
  );
}

/** The reporter's annotated screenshots. Each one is a moment they thought was worth drawing
 *  on, so clicking a shot seeks the replay to it rather than just enlarging a picture. */
function ShotList({ bug, clock }: { bug: Bug; clock: ReplayClock }) {
  const shots = bug.shots ?? [];
  if (!shots.length) {
    return (
      <div className="p-4 text-[12px] text-muted-foreground">
        No screenshots on this report. The extension's ⊙ Screenshot button captures the page and
        lets the reporter draw on it.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 p-3">
      {shots.map((shot) => (
        <figure key={shot.id} className="overflow-hidden rounded-lg border border-border bg-card">
          {shot.fileId ? (
            <button
              type="button"
              onClick={() => clock.seek(Math.max(0, shot.t))}
              className="block w-full"
              title={`Jump the replay to ${formatOffset(Math.max(0, shot.t))}`}
            >
              <img
                src={storageDownloadUrl(shot.fileId)}
                alt={shot.note ?? `Screenshot at ${formatOffset(Math.max(0, shot.t))}`}
                className="w-full"
                loading="lazy"
              />
            </button>
          ) : (
            <div className="grid h-24 place-items-center text-[11px] text-muted-foreground">
              Still uploading…
            </div>
          )}
          <figcaption className="flex items-center gap-2 border-t border-border px-2.5 py-1.5 text-[11px] text-muted-foreground">
            <span className="font-mono">{formatOffset(Math.max(0, shot.t))}</span>
            {shot.selector ? <span className="truncate font-mono">{shot.selector}</span> : null}
            {shot.note ? <span className="truncate">{shot.note}</span> : null}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
