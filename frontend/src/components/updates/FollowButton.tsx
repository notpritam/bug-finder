// ABOUTME: Follow a session or an initiative. The same row the MCP `watch` tool writes, so a person
// ABOUTME: following an initiative here and an agent following it over MCP are the same
// ABOUTME: subscription — one concept, not a UI one and an API one that drift apart.
import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";

import { fetchFollowing, setWatching } from "@/lib/updates-api";
import { cn } from "@/lib/utils";

export function FollowButton({
  humanId,
  initiativeId,
  className,
}: {
  humanId?: string;
  initiativeId?: string;
  className?: string;
}) {
  const [following, setFollowing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let dead = false;
    void fetchFollowing().then((f) => {
      if (dead) return;
      setFollowing(humanId ? f.sessions.includes(humanId) : !!initiativeId && f.initiatives.includes(initiativeId));
    });
    return () => {
      dead = true;
    };
  }, [humanId, initiativeId]);

  const toggle = async () => {
    if (following === null || busy) return;
    setBusy(true);
    const next = !following;
    // Optimistic: the button is the feedback, and a spinner that resolves to the same label reads
    // as nothing having happened.
    setFollowing(next);
    const f = await setWatching({ humanId, initiativeId }, next);
    setFollowing(humanId ? f.sessions.includes(humanId) : !!initiativeId && f.initiatives.includes(initiativeId));
    setBusy(false);
  };

  const what = humanId ? "this session" : "this initiative";
  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={following === null}
      title={following ? `Stop following ${what}` : `Get told when ${what} changes`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50",
        following
          ? "border-amber-500/50 bg-amber-500/10 text-foreground"
          : "border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground",
        className,
      )}
    >
      {following === null || busy ? (
        <Loader2 className="size-3 animate-spin" />
      ) : following ? (
        <Bell className="size-3" />
      ) : (
        <BellOff className="size-3" />
      )}
      {following ? "Following" : "Follow"}
    </button>
  );
}
