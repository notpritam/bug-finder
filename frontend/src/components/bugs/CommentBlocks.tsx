// ABOUTME: Renders a structured agent finding — the diagram, the marked-up code, the observed-vs-
// ABOUTME: expected table, the link back into the capture. Only three block kinds are HTML, and
// ABOUTME: their markup was sanitised by the server at write time; the rest are rendered as text
// ABOUTME: nodes, which is why most of this file cannot introduce an injection even if it is wrong.
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleAlert, Info, Link2 } from "lucide-react";

import type { CommentBlock } from "@/lib/bugs-api";
import { cn } from "@/lib/utils";

/** Where an evidence block should take the reader. BugDetail owns the actual navigation. */
export type EvidenceTarget = { kind: string; index?: number; t?: number; selector?: string };

export function CommentBlocks({
  blocks,
  onEvidence,
}: {
  blocks: CommentBlock[];
  onEvidence?: (target: EvidenceTarget) => void;
}) {
  if (!blocks?.length) return null;
  return (
    <div className="mt-1 space-y-2">
      {blocks.map((block, i) => (
        <Block key={i} block={block} onEvidence={onEvidence} />
      ))}
    </div>
  );
}

function Block({ block, onEvidence }: { block: CommentBlock; onEvidence?: (t: EvidenceTarget) => void }) {
  switch (block.type) {
    // The three HTML kinds. `prose-block` scopes typography so an agent's <h3> cannot compete with
    // the dashboard's own headings.
    case "markdown":
    case "html":
      return <div className="prose-block text-[12px] leading-relaxed" dangerouslySetInnerHTML={{ __html: block.html }} />;

    case "callout":
      return <Callout level={block.level} title={block.title} html={block.html} />;

    case "code":
      return <Code {...block} />;

    case "diagram":
      return <Diagram src={block.src} caption={block.caption} />;

    case "table":
      return (
        <Figure caption={block.caption}>
          {/* Wide tables scroll inside their own box — the comment thread must never scroll sideways. */}
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full border-collapse text-[11.5px]">
              <thead>
                <tr className="bg-muted/50">
                  {block.columns.map((c, i) => (
                    <th key={i} className="border-b border-border/60 px-2.5 py-1.5 text-left font-semibold">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r} className="odd:bg-muted/20">
                    {block.columns.map((_, c) => (
                      <td key={c} className="border-b border-border/40 px-2.5 py-1.5 tabular-nums">
                        {row[c] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Figure>
      );

    case "keyvalue":
      return (
        <Figure caption={block.caption}>
          <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2 text-[11.5px]">
            {block.items.map((item, i) => (
              <div key={i} className="contents">
                <dt className="text-muted-foreground">{item.k}</dt>
                <dd className={cn("min-w-0 break-words", item.mono && "font-mono tabular-nums")}>{item.v}</dd>
              </div>
            ))}
          </dl>
        </Figure>
      );

    case "evidence":
      return <Evidence refr={block.ref} note={block.note} onEvidence={onEvidence} />;

    default:
      return null;
  }
}

/* ------------------------------------------------------------------ pieces */

function Figure({ caption, children }: { caption?: string; children: React.ReactNode }) {
  return (
    <figure className="m-0">
      {children}
      {caption && <figcaption className="mt-1 text-[10.5px] text-muted-foreground">{caption}</figcaption>}
    </figure>
  );
}

const CALLOUT = {
  info: { Icon: Info, cls: "border-sky-500/30 bg-sky-500/10 text-sky-900 dark:text-sky-200" },
  warn: { Icon: AlertTriangle, cls: "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200" },
  error: { Icon: CircleAlert, cls: "border-rose-500/30 bg-rose-500/10 text-rose-900 dark:text-rose-200" },
  success: { Icon: CheckCircle2, cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200" },
} as const;

function Callout({ level, title, html }: { level: keyof typeof CALLOUT; title?: string; html: string }) {
  const { Icon, cls } = CALLOUT[level] ?? CALLOUT.info;
  return (
    <div className={cn("flex gap-2 rounded-lg border px-2.5 py-2 text-[11.5px] leading-relaxed", cls)}>
      <Icon className="mt-px size-3.5 shrink-0" />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        <div className="prose-block" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}

function Code({ lang, src, highlight, caption }: { lang?: string; src: string; highlight?: number[]; caption?: string }) {
  const marked = new Set(highlight ?? []);
  const lines = src.split("\n");
  return (
    <Figure caption={caption}>
      <div className="overflow-x-auto rounded-lg border border-border/60 bg-muted/30">
        {lang && (
          <div className="border-b border-border/50 px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            {lang}
          </div>
        )}
        <pre className="m-0 p-0 text-[11px] leading-[1.55]">
          <code className="block font-mono">
            {lines.map((line, i) => (
              <span
                key={i}
                className={cn(
                  "flex px-2.5",
                  marked.has(i + 1) && "bg-amber-500/15 shadow-[inset_2px_0_0_0] shadow-amber-500",
                )}
              >
                <span className="mr-2.5 w-6 shrink-0 select-none text-right text-muted-foreground/50 tabular-nums">
                  {i + 1}
                </span>
                <span className="whitespace-pre">{line || " "}</span>
              </span>
            ))}
          </code>
        </pre>
      </div>
    </Figure>
  );
}

/**
 * Mermaid is the one dependency this feature adds, and it is the heaviest thing on the page — so it
 * is imported only when a comment actually carries a diagram. securityLevel "strict" is what keeps
 * agent-authored diagram source from becoming markup: mermaid escapes node labels and refuses
 * click handlers, which matters because this string never went through the HTML sanitizer.
 */
function Diagram({ src, caption }: { src: string; caption?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        const dark = document.documentElement.classList.contains("dark");
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: dark ? "dark" : "neutral",
          fontFamily: "inherit",
        });
        const id = `bf-mermaid-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, src);
        if (!cancelled && host.current) host.current.innerHTML = svg;
      } catch (err) {
        // A diagram that will not parse is the agent's mistake to see, not a blank space that
        // makes the comment look truncated.
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (error) {
    return (
      <Figure caption={caption}>
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-900 dark:text-rose-200">
          <p className="font-semibold">This diagram could not be drawn</p>
          <p className="mt-0.5 opacity-80">{error}</p>
          <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap font-mono text-[10.5px] opacity-70">{src}</pre>
        </div>
      </Figure>
    );
  }
  return (
    <Figure caption={caption}>
      <div ref={host} className="overflow-x-auto rounded-lg border border-border/60 bg-card px-2 py-2 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full" />
    </Figure>
  );
}

const EVIDENCE_LABEL: Record<string, string> = {
  network: "Network request",
  console: "Console line",
  dom: "DOM element",
  state: "App state",
  cookie: "Cookie",
  storage: "Storage write",
  marker: "Marker",
};

function Evidence({
  refr,
  note,
  onEvidence,
}: {
  refr: EvidenceTarget;
  note?: string;
  onEvidence?: (t: EvidenceTarget) => void;
}) {
  const bits = [
    EVIDENCE_LABEL[refr.kind] ?? refr.kind,
    refr.index !== undefined ? `#${refr.index}` : "",
    refr.t !== undefined ? `at ${(refr.t / 1000).toFixed(1)}s` : "",
    refr.selector ?? "",
  ].filter(Boolean);

  const label = (
    <>
      <Link2 className="size-3 shrink-0" />
      <span className="font-medium">{bits.join(" · ")}</span>
      {note && <span className="text-muted-foreground">— {note}</span>}
    </>
  );

  // Static when nothing can resolve it: a link that goes nowhere is worse than a label.
  if (!onEvidence) {
    return (
      <p className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/20 px-2.5 py-1.5 text-[11.5px]">
        {label}
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onEvidence(refr)}
      className="flex w-full items-center gap-1.5 rounded-lg border border-border/60 bg-muted/20 px-2.5 py-1.5 text-left text-[11.5px] transition-colors hover:border-violet-500/40 hover:bg-violet-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500"
    >
      {label}
    </button>
  );
}
