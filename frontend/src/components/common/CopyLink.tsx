// ABOUTME: Copy-the-link button used on session rows. Confirms in place, because a clipboard
// ABOUTME: write changes nothing on screen and silence reads as failure.
import { useState, type MouseEvent } from "react";
import { Check, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function CopyLink({ path, label, className }: { path: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = (e: MouseEvent) => {
    // Rows are clickable; copying must not also open the thing being copied.
    e.stopPropagation();
    e.preventDefault();
    void navigator.clipboard
      .writeText(`${window.location.origin}${path}`)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        /* clipboard denied — the row is still a link that can be copied by hand */
      });
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={`Copy link to ${label}`}
      aria-label={`Copy link to ${label}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border border-border/60 px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground",
        copied && "border-primary/50 text-foreground",
        className,
      )}
    >
      {copied ? <Check className="size-3" /> : <Link2 className="size-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}