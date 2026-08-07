// ABOUTME: Click-to-edit text used for a filed bug's title and description. Reads as plain
// ABOUTME: text until clicked, so the page still looks like a report rather than a form.
import { useEffect, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export function EditableText({
  value,
  onSave,
  label,
  className,
  multiline = false,
  placeholder,
}: {
  value: string;
  onSave: (next: string) => void;
  label: string;
  className?: string;
  multiline?: boolean;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  // Someone else's edit must not be clobbered by a stale buffer sitting in this component.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next !== value.trim()) onSave(next);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      // Esc here abandons the edit; without stopPropagation it would also leave the bug.
      e.stopPropagation();
      setDraft(value);
      setEditing(false);
    } else if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commit();
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title={`Edit ${label.toLowerCase()}`}
        className={cn(
          "-mx-1 block w-full rounded px-1 text-left transition-colors hover:bg-accent/60",
          !value && "italic text-muted-foreground",
          className,
        )}
      >
        {value || placeholder || `Add ${label.toLowerCase()}`}
      </button>
    );
  }

  const shared = {
    value: draft,
    onBlur: commit,
    onKeyDown,
    "aria-label": label,
    className: cn(
      "-mx-1 w-full rounded border border-ring/50 bg-background px-1 outline-none",
      className,
    ),
  };

  return multiline ? (
    // biome-ignore lint/a11y/noAutofocus: the field only exists because it was just clicked
    <textarea
      {...shared}
      autoFocus
      rows={Math.min(14, Math.max(3, draft.split("\n").length + 1))}
      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDraft(e.target.value)}
    />
  ) : (
    // biome-ignore lint/a11y/noAutofocus: same
    <input {...shared} autoFocus onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)} />
  );
}