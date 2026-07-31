// ABOUTME: A tiny, self-contained syntax-highlighted JSON viewer with an optional search
// ABOUTME: term that highlights matches. Falls back to plain <pre> if the input isn't JSON.
import type { ReactNode } from "react";
import { useMemo } from "react";
import { cn } from "@/lib/utils";

/** Try to parse `text` as JSON; return null when it isn't. */
export function tryParseJson(text: string | null | undefined): unknown | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!/^[{[]/.test(trimmed) && !/^"/.test(trimmed)) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

interface Token {
  kind: "key" | "string" | "number" | "boolean" | "null" | "punct" | "space";
  text: string;
}

/** Cheap JSON tokenizer over a pretty-printed string. */
function tokenize(pretty: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = pretty.length;
  while (i < n) {
    const c = pretty[i];
    if (c === '"') {
      // Read a string; if the next non-space char after the closing quote is ':', it's a key.
      let j = i + 1;
      while (j < n) {
        if (pretty[j] === "\\") {
          j += 2;
          continue;
        }
        if (pretty[j] === '"') break;
        j++;
      }
      const raw = pretty.slice(i, Math.min(j + 1, n));
      let k = j + 1;
      while (k < n && (pretty[k] === " " || pretty[k] === "\t")) k++;
      const isKey = pretty[k] === ":";
      out.push({ kind: isKey ? "key" : "string", text: raw });
      i = j + 1;
      continue;
    }
    if (/[-\d]/.test(c)) {
      const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(pretty.slice(i));
      if (m) {
        out.push({ kind: "number", text: m[0] });
        i += m[0].length;
        continue;
      }
    }
    if (pretty.startsWith("true", i) || pretty.startsWith("false", i)) {
      const w = pretty.startsWith("true", i) ? "true" : "false";
      out.push({ kind: "boolean", text: w });
      i += w.length;
      continue;
    }
    if (pretty.startsWith("null", i)) {
      out.push({ kind: "null", text: "null" });
      i += 4;
      continue;
    }
    if (/\s/.test(c)) {
      let j = i;
      while (j < n && /\s/.test(pretty[j])) j++;
      out.push({ kind: "space", text: pretty.slice(i, j) });
      i = j;
      continue;
    }
    out.push({ kind: "punct", text: c });
    i++;
  }
  return out;
}

const KIND_CLASS: Record<Token["kind"], string> = {
  key: "text-[color:var(--json-key)]",
  string: "text-[color:var(--json-string)]",
  number: "text-[color:var(--json-number)]",
  boolean: "text-[color:var(--json-boolean)]",
  null: "text-[color:var(--json-null)]",
  punct: "text-[color:var(--json-punct)]",
  space: "",
};

/** Wrap every case-insensitive occurrence of `needle` in `text` with <mark>. */
function withHighlights(text: string, needle: string): ReactNode {
  if (!needle) return text;
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  const nlow = needle.toLowerCase();
  let i = 0;
  let key = 0;
  while (i < text.length) {
    const at = lower.indexOf(nlow, i);
    if (at === -1) {
      parts.push(text.slice(i));
      break;
    }
    if (at > i) parts.push(text.slice(i, at));
    parts.push(
      <mark key={key++} className="rounded-sm bg-amber-200/70 px-px text-inherit dark:bg-amber-400/40">
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    i = at + needle.length;
  }
  return <>{parts}</>;
}

export function JsonView({
  data,
  search = "",
  className,
}: {
  data: unknown;
  search?: string;
  className?: string;
}) {
  const tokens = useMemo(() => tokenize(JSON.stringify(data, null, 2) + "\n"), [data]);
  return (
    <pre
      className={cn(
        "max-h-64 overflow-auto scroll-thin rounded bg-[color:var(--json-bg)] p-2 font-mono text-[10.5px] leading-relaxed",
        className,
      )}
    >
      <code>
        {tokens.map((tok, i) => (
          <span key={i} className={KIND_CLASS[tok.kind]}>
            {search ? withHighlights(tok.text, search) : tok.text}
          </span>
        ))}
      </code>
    </pre>
  );
}

/** Plain-text fallback with search highlighting. */
export function TextView({
  text,
  search = "",
  className,
}: {
  text: string;
  search?: string;
  className?: string;
}) {
  return (
    <pre
      className={cn(
        "max-h-64 overflow-auto scroll-thin whitespace-pre-wrap break-words rounded bg-[color:var(--json-bg)] p-2 font-mono text-[10.5px] leading-relaxed text-foreground/85",
        className,
      )}
    >
      {search ? withHighlights(text, search) : text}
    </pre>
  );
}
