// ABOUTME: Dev scoreboard — who ships the cleanest work and who fixes fastest.
// ABOUTME: Ranks initiative owners by cleanliness (50%) + fix rate (50%); invalid reports never count.
import { useMemo } from "react";
import { Trophy } from "lucide-react";
import type { Bug } from "@/lib/types";
import { devScoreboard, type Initiative } from "@/lib/initiatives";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/common/bits";

export function InsightsPage({ bugs, initiatives }: { bugs: Bug[]; initiatives: Initiative[] }) {
  const rows = useMemo(() => devScoreboard(initiatives, bugs), [initiatives, bugs]);
  const qaBugs = bugs.filter((b) => b.initiativeId || b.category === "initiative").length;
  const prodBugs = bugs.length - qaBugs;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-thin bg-background">
      <div className="mx-auto max-w-5xl px-6 py-6" data-testid="insights-page">
        <h1 className="text-[19px] font-bold tracking-tight">Insights</h1>
        <p className="text-[12.5px] text-muted-foreground">
          How clean is each dev's work when it reaches QA — and how fast do they fix what's found.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Card label="Initiatives in QA" value={initiatives.filter((i) => i.status === "in_qa").length} />
          <Card label="Shipped" value={initiatives.filter((i) => i.status === "shipped").length} />
          <Card label="Initiative bugs" value={qaBugs} />
          <Card label="Production bugs" value={prodBugs} />
        </div>

        <div className="mt-6">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
            Developer scoreboard
          </p>
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 py-12 text-center text-[12.5px] text-muted-foreground">
              No initiatives yet — the scoreboard fills in once devs create initiatives and QA files bugs.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border/60 bg-card shadow-card">
              <table className="w-full text-[12px]" data-testid="dev-scoreboard-table">
                <thead>
                  <tr className="border-b border-border/60 text-left text-[10px] uppercase tracking-wide text-muted-foreground/70">
                    <th className="px-3 py-2 font-semibold">#</th>
                    <th className="px-3 py-2 font-semibold">Developer</th>
                    <th className="px-3 py-2 text-right font-semibold">Initiatives</th>
                    <th className="px-3 py-2 text-right font-semibold">Shipped</th>
                    <th className="px-3 py-2 text-right font-semibold" title="Valid bugs QA found in their work">
                      Bugs in work
                    </th>
                    <th className="px-3 py-2 text-right font-semibold">Fixed</th>
                    <th className="px-3 py-2 text-right font-semibold">Fix rate</th>
                    <th className="px-3 py-2 text-right font-semibold" title="Valid bugs per initiative — lower is cleaner">
                      Avg / initiative
                    </th>
                    <th className="px-3 py-2 text-right font-semibold">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={r.owner.id}
                      className="border-b border-border/40 last:border-b-0"
                      data-testid={`scoreboard-row-${r.owner.id}`}
                    >
                      <td className="px-3 py-2.5">
                        {i === 0 ? (
                          <Trophy className="size-4 text-amber-500" />
                        ) : (
                          <span className="font-mono text-muted-foreground">{i + 1}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-2">
                          <UserAvatar name={r.owner.name} seed={r.owner.id} size={22} />
                          <span className="font-medium">{r.owner.name}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{r.initiatives}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{r.shipped}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{r.validBugs}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{r.fixed}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {r.fixRate == null ? "—" : `${Math.round(r.fixRate * 100)}%`}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {r.avgBugs == null ? "—" : r.avgBugs.toFixed(1)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span
                          className={cn(
                            "inline-block min-w-[44px] rounded-full px-2 py-0.5 text-center font-mono text-[11px] font-bold tabular-nums",
                            r.score >= 75
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                              : r.score >= 50
                                ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                                : "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400",
                          )}
                        >
                          {r.score}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/70">
            Score = cleanliness (fewest valid bugs per initiative) 50% + fix rate 50%. Reports marked
            "not a bug" or "won't fix" never count against a developer.
          </p>
        </div>
      </div>
    </div>
  );
}

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5 shadow-card">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">{label}</p>
      <p className="mt-0.5 text-[18px] font-bold tabular-nums">{value}</p>
    </div>
  );
}
