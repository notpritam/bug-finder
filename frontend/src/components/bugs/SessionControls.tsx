// ABOUTME: The two things a triager does to a filed session that were read-only until now — move
// ABOUTME: it to an initiative, and correct its tags. Both write to the shared record, because a
// ABOUTME: session filed against the wrong effort is a session the right team never sees.
import { useEffect, useRef, useState } from "react";
import { Check, Plus, Rocket, X } from "lucide-react";
import type { Initiative } from "@/lib/initiatives";
import { cn } from "@/lib/utils";

/** Move a session between initiatives. The id and the display name travel together: the id is what
 *  grouping keys off, the name is what every list, summary and agent read already renders. */
export function InitiativePicker({
  initiativeId,
  initiatives,
  onChange,
}: {
  initiativeId: string | null;
  initiatives: Initiative[];
  onChange: (next: Initiative | null) => void;
}) {
  const current = initiatives.find((i) => i.id === initiativeId) ?? null;
  return (
    <label
      className={cn(
        "relative inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold transition-colors",
        current
          ? "bg-sky-50 text-sky-700 hover:bg-sky-100 dark:bg-sky-500/10 dark:text-sky-300 dark:hover:bg-sky-500/20"
          : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
      title={current ? `Part of ${current.name} — click to move it` : "Not part of an initiative — click to add it to one"}
    >
      <Rocket className="size-3" />
      {current ? current.name : "No initiative"}
      <select
        value={initiativeId ?? ""}
        aria-label="Move this session to an initiative"
        data-testid="session-initiative-picker"
        onChange={(e) => onChange(initiatives.find((i) => i.id === e.target.value) ?? null)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        <option value="">No initiative</option>
        {/* An initiative that was archived or deleted still needs to appear while it is the one
            selected, or the control reads as "No initiative" and the next save makes that true. */}
        {current && !initiatives.some((i) => i.id === current.id) && (
          <option value={current.id}>{current.name}</option>
        )}
        {initiatives.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Tags, editable in place. They are not decoration: a session joins an initiative by sharing its
 * tags, and the list filters on them, so a wrong tag is a session nobody finds.
 *
 * Clicking a tag still navigates to the filtered list — that was the only thing tags did before,
 * and taking it away to make room for editing would be a bad trade. The × removes.
 */
export function TagEditor({
  tags,
  suggestions,
  onChange,
  onOpenTag,
}: {
  tags: string[];
  suggestions: string[];
  onChange: (next: string[]) => void;
  onOpenTag: (tag: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const close = () => {
    setAdding(false);
    setDraft("");
  };

  const commit = (raw: string) => {
    // Same normalisation the backend and initiative matching use — a tag that differs only by case
    // or a stray space is a tag that silently fails to match its initiative.
    const clean = raw.trim().toLowerCase();
    if (!clean) return close();
    if (!tags.includes(clean)) onChange([...tags, clean]);
    setDraft("");
    // Stay open: tags arrive in threes more often than ones.
  };

  const remove = (tag: string) => onChange(tags.filter((t) => t !== tag));

  const unused = suggestions.filter((s) => !tags.includes(s) && s.startsWith(draft.trim().toLowerCase()));

  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-testid="session-tag-editor">
      {tags.map((tag) => (
        <span
          key={tag}
          className="group inline-flex items-center gap-0.5 rounded-full bg-secondary py-px pl-2 pr-0.5 text-[10.5px] font-medium text-secondary-foreground transition-colors hover:bg-accent"
        >
          <button
            type="button"
            onClick={() => onOpenTag(tag)}
            className="transition-colors hover:text-foreground"
            title={`Show all sessions tagged "${tag}"`}
          >
            {tag}
          </button>
          <button
            type="button"
            onClick={() => remove(tag)}
            aria-label={`Remove tag ${tag}`}
            className="grid size-3.5 place-items-center rounded-full text-muted-foreground/60 transition-colors hover:bg-destructive/15 hover:text-destructive"
          >
            <X className="size-2.5" />
          </button>
        </span>
      ))}

      {adding ? (
        <span className="relative inline-flex items-center">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit(draft);
              else if (e.key === "Escape") close();
              else if (e.key === "Backspace" && !draft && tags.length) remove(tags[tags.length - 1]);
            }}
            onBlur={() => setTimeout(close, 120)}
            placeholder="add tag"
            aria-label="Add a tag"
            className="w-24 rounded-full border border-border/60 bg-background px-2 py-px text-[10.5px] outline-none placeholder:text-muted-foreground/50 focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          {unused.length > 0 && (
            <span className="absolute left-0 top-full z-20 mt-1 flex max-h-40 min-w-[9rem] flex-col overflow-y-auto rounded-lg border border-border/60 bg-popover p-1 shadow-lg">
              {unused.slice(0, 8).map((s) => (
                <button
                  key={s}
                  type="button"
                  // onMouseDown, not onClick: the input's blur would close this first.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(s);
                  }}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] transition-colors hover:bg-accent"
                >
                  <Check className="size-3 opacity-0" />
                  {s}
                </button>
              ))}
            </span>
          )}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          data-testid="session-add-tag"
          aria-label="Add a tag"
          className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-border/70 px-1.5 py-px text-[10.5px] font-medium text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-2.5" /> tag
        </button>
      )}
    </span>
  );
}
