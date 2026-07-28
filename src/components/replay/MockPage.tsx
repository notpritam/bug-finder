// ABOUTME: The simulated "captured page" rendered inside the replay stage — a wireframe of the
// ABOUTME: reported app whose state (route, typed input, errors) is derived from the replay clock.
import { useMemo } from "react";
import type { Bug, ReplayEvent } from "@/lib/types";
import { cn, pathOf } from "@/lib/utils";

/** Progressive typing: how much of `value` has been "typed" by time `t` (40ms per char). */
function typed(value: string, startedAt: number, t: number): string {
  if (t < startedAt) return "";
  return value.slice(0, Math.floor((t - startedAt) / 40));
}

interface Derived {
  url: string;
  inputs: Record<string, string>;
  errors: { t: number; message: string }[];
  clicksOn: Set<string>;
}

function derive(bug: Bug, t: number): Derived {
  let url = bug.visits[0]?.url ?? bug.pageUrl;
  const inputs: Record<string, string> = {};
  const errors: { t: number; message: string }[] = [];
  const clicksOn = new Set<string>();
  for (const ev of bug.replay) {
    if (ev.t > t) break;
    if (ev.kind === "nav") url = ev.url;
    else if (ev.kind === "input") inputs[ev.field] = typed(ev.value, ev.t, t);
    else if (ev.kind === "error") errors.push({ t: ev.t, message: ev.message });
    else if (ev.kind === "click" && ev.target) clicksOn.add(ev.target);
  }
  return { url, inputs, errors, clicksOn };
}

/* --- tiny wireframe atoms ------------------------------------------------ */

function Line({ w, className }: { w: string; className?: string }) {
  return <div className={cn("h-2 rounded-full bg-zinc-200", className)} style={{ width: w }} />;
}

function Field({ label, value, active }: { label: string; value?: string; active?: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400">{label}</p>
      <div
        className={cn(
          "flex h-7 items-center rounded-md border bg-white px-2 text-[11px] text-zinc-700",
          active ? "border-blue-400 ring-2 ring-blue-100" : "border-zinc-200",
        )}
      >
        {value || <span className="text-zinc-300">—</span>}
        {active && <span className="ml-px inline-block h-3.5 w-px animate-pulse bg-blue-500" />}
      </div>
    </div>
  );
}

function TopNav({ brand, links }: { brand: string; links: string[] }) {
  return (
    <div className="flex h-10 items-center gap-4 border-b border-zinc-200 bg-white px-4">
      <div className="flex items-center gap-1.5">
        <div className="size-4 rounded bg-zinc-800" />
        <span className="text-[11px] font-bold text-zinc-800">{brand}</span>
      </div>
      {links.map((l) => (
        <span key={l} className="text-[10px] font-medium text-zinc-400">
          {l}
        </span>
      ))}
      <div className="ml-auto size-5 rounded-full bg-zinc-300" />
    </div>
  );
}

/* --- scenario: checkout -------------------------------------------------- */

function CheckoutScenario({ d }: { d: Derived }) {
  const onCheckout = pathOf(d.url).startsWith("/checkout");
  const failed = d.errors.length > 0;
  const crashed = d.errors.length > 1;
  const submitting = d.clicksOn.has("button#place-order");

  if (!onCheckout) {
    return (
      <div className="flex h-full flex-col bg-zinc-50">
        <TopNav brand="Acme Store" links={["Shop", "Deals", "Support"]} />
        <div className="flex flex-1 gap-4 p-5">
          <div className="flex-1 space-y-2.5">
            <p className="text-[13px] font-bold text-zinc-800">Your cart</p>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white p-3">
                <div className="size-9 rounded-md bg-zinc-100" />
                <div className="flex-1 space-y-1.5">
                  <Line w={`${52 - i * 8}%`} className="bg-zinc-300" />
                  <Line w="24%" />
                </div>
                <span className="text-[11px] font-semibold text-zinc-600">${(28 * (i + 1)).toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="w-[30%] space-y-2.5">
            <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3">
              <div className="flex justify-between text-[10px] text-zinc-500">
                <span>Subtotal</span>
                <span>$84.00</span>
              </div>
              <div className="flex justify-between text-[10px] text-zinc-500">
                <span>Shipping</span>
                <span>Free</span>
              </div>
              <div className="flex justify-between border-t border-zinc-100 pt-2 text-[11px] font-bold text-zinc-800">
                <span>Total</span>
                <span>$84.00</span>
              </div>
            </div>
            <div className="grid h-8 place-items-center rounded-md bg-zinc-900 text-[11px] font-semibold text-white">
              Checkout
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-zinc-50">
      <TopNav brand="Acme Store" links={["Shop", "Deals", "Support"]} />
      <div className="flex flex-1 justify-center gap-5 p-6">
        <div className="w-[42%] space-y-3">
          <p className="text-[13px] font-bold text-zinc-800">Payment</p>
          <Field label="Email" value={d.inputs.email} active={d.inputs.email != null && !d.inputs.card} />
          <Field label="Card number" value={d.inputs.card} active={d.inputs.card != null && d.inputs.card.length < 19} />
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Expiry" value={d.inputs.card ? "12 / 27" : undefined} />
            <Field label="CVC" value={d.inputs.card ? "•••" : undefined} />
          </div>
          <div
            className={cn(
              "mt-2 grid h-9 place-items-center rounded-md text-[11.5px] font-semibold text-white",
              crashed ? "bg-red-500" : "bg-zinc-900",
            )}
          >
            {crashed ? (
              "Something went wrong"
            ) : submitting && failed ? (
              <span className="flex items-center gap-1.5">
                <span className="size-3 animate-spin rounded-full border-[1.5px] border-white/40 border-t-white" />
                Placing order…
              </span>
            ) : (
              "Place order"
            )}
          </div>
          {crashed && (
            <div className="rounded-md border border-red-200 bg-red-50 p-2 font-mono text-[9px] leading-relaxed text-red-600">
              TypeError: Cannot read properties of undefined (reading 'id')
              <br />
              at OrderConfirmation (checkout.js:412)
            </div>
          )}
        </div>
        <div className="w-[26%] space-y-2">
          <p className="text-[11px] font-bold text-zinc-700">Order summary</p>
          <div className="order-summary space-y-2 rounded-lg border border-zinc-200 bg-white p-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center justify-between">
                <Line w={`${46 - i * 6}%`} />
                <span className="text-[10px] text-zinc-500">${(28 * (i + 1)).toFixed(2)}</span>
              </div>
            ))}
            <div className="total flex items-center justify-between border-t border-zinc-100 pt-2">
              <span className="text-[11px] font-bold text-zinc-800">Total</span>
              <span className="text-[11px] font-bold text-zinc-800">$84.00</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* --- scenario: dashboard ------------------------------------------------- */

function DashboardScenario({ d }: { d: Derived }) {
  const crashed = d.errors.length > 0;
  const range = d.clicksOn.has("option[value=last-90d]") ? "Last 90 days" : "Last 30 days";
  return (
    <div className="flex h-full bg-zinc-50">
      <div className="w-[15%] space-y-2 border-r border-zinc-200 bg-white p-3">
        <div className="mb-3 flex items-center gap-1.5">
          <div className="size-4 rounded bg-indigo-600" />
          <span className="text-[10px] font-bold text-zinc-800">Acme</span>
        </div>
        {["Home", "Analytics", "Funnels", "Users", "Settings"].map((l, i) => (
          <div
            key={l}
            className={cn(
              "rounded px-1.5 py-1 text-[10px] font-medium",
              i === 1 ? "bg-indigo-50 text-indigo-700" : "text-zinc-400",
            )}
          >
            {l}
          </div>
        ))}
      </div>
      <div className="flex-1 space-y-3 p-4">
        <div className="flex items-center gap-2">
          <p className="text-[13px] font-bold text-zinc-800">Analytics</p>
          <div className="ml-3 flex h-6 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 text-[10px] text-zinc-600">
            {range} <span className="text-zinc-300">▾</span>
          </div>
          <div className="grid h-6 place-items-center rounded-md border border-zinc-200 bg-white px-2 text-[10px] text-zinc-600">
            Refresh
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {["Active users", "Sessions", "Errors"].map((k, i) => (
            <div key={k} className="rounded-lg border border-zinc-200 bg-white p-3">
              <p className="text-[9px] font-medium uppercase tracking-wide text-zinc-400">{k}</p>
              <p className="mt-1 text-[16px] font-bold text-zinc-800">{crashed ? "—" : ["2,481", "9,102", "37"][i]}</p>
            </div>
          ))}
        </div>
        <div className="chart-panel rounded-lg border border-zinc-200 bg-white p-3" data-chart="trend">
          <p className="mb-2 text-[10px] font-semibold text-zinc-600">Weekly active users</p>
          {crashed ? (
            <div className="grid h-[46%] min-h-28 place-items-center rounded-md border border-red-200 bg-red-50">
              <div className="text-center">
                <p className="text-[11px] font-semibold text-red-600">Something went wrong rendering this chart</p>
                <p className="mt-1 font-mono text-[9px] text-red-500">RangeError: invalid array length</p>
              </div>
            </div>
          ) : (
            <div className="flex h-[46%] min-h-28 items-end gap-1.5">
              {[38, 52, 44, 66, 58, 74, 61, 80, 72, 88, 78, 92].map((h, i) => (
                <div key={i} className="flex-1 rounded-t bg-indigo-400/70" style={{ height: `${h}%` }} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* --- scenario: settings -------------------------------------------------- */

function SettingsScenario({ d }: { d: Derived }) {
  const picking = d.clicksOn.has("button#upload-avatar");
  const uploaded = d.clicksOn.has("input[type=file]");
  const failed = d.errors.length > 0;
  return (
    <div className="flex h-full bg-zinc-50">
      <div className="w-[15%] space-y-2 border-r border-zinc-200 bg-white p-3">
        <div className="mb-3 flex items-center gap-1.5">
          <div className="size-4 rounded bg-teal-600" />
          <span className="text-[10px] font-bold text-zinc-800">Acme</span>
        </div>
        {["Profile", "Appearance", "Notifications", "Billing", "Team"].map((l, i) => (
          <div
            key={l}
            className={cn(
              "rounded px-1.5 py-1 text-[10px] font-medium",
              i === 0 ? "bg-teal-50 text-teal-700" : "text-zinc-400",
            )}
          >
            {l}
          </div>
        ))}
      </div>
      <div className="flex-1 p-5">
        <p className="text-[13px] font-bold text-zinc-800">Profile</p>
        <div className="mt-3 w-[60%] space-y-3 rounded-lg border border-zinc-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-full bg-zinc-200 text-[12px] font-bold text-zinc-500">
              MC
            </div>
            <div className="grid h-7 place-items-center rounded-md border border-zinc-300 px-2.5 text-[10.5px] font-medium text-zinc-700">
              Upload photo
            </div>
          </div>
          {(picking || uploaded) && (
            <div className="upload-progress space-y-1 rounded-md border border-zinc-200 bg-zinc-50 p-2">
              <div className="flex justify-between text-[9.5px] text-zinc-500">
                <span>{uploaded ? "IMG_4821.heic" : "Choose a file…"}</span>
                {uploaded && <span>{failed ? "stuck at 62%" : "62%"}</span>}
              </div>
              {uploaded && (
                <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200">
                  <div className={cn("h-full rounded-full", failed ? "bg-amber-400" : "bg-teal-500")} style={{ width: "62%" }} />
                </div>
              )}
            </div>
          )}
          <Field label="Display name" value="Maya Chen" />
          <Field label="Email" value="maya@emergent.sh" />
          <div className="grid h-8 w-24 place-items-center rounded-md bg-zinc-900 text-[11px] font-semibold text-white">
            Save
          </div>
        </div>
      </div>
    </div>
  );
}

/* --- stage overlays (cursor, ripples, element highlight) ------------------ */

function cursorAt(replay: ReplayEvent[], t: number): { x: number; y: number } {
  let prev: { t: number; x: number; y: number } | null = null;
  let next: { t: number; x: number; y: number } | null = null;
  for (const ev of replay) {
    if (ev.kind !== "move" && ev.kind !== "click") continue;
    if (ev.t <= t) prev = ev;
    else {
      next = ev;
      break;
    }
  }
  if (!prev) return next ?? { x: 0.5, y: 0.5 };
  if (!next || next.t === prev.t) return prev;
  const f = (t - prev.t) / (next.t - prev.t);
  return { x: prev.x + (next.x - prev.x) * f, y: prev.y + (next.y - prev.y) * f };
}

export function MockPage({
  bug,
  t,
  highlightRect,
}: {
  bug: Bug;
  t: number;
  /** A picked element's normalized rect to spotlight over the page, or null. */
  highlightRect: { x: number; y: number; w: number; h: number } | null;
}) {
  const d = useMemo(() => derive(bug, t), [bug, t]);
  const cursor = cursorAt(bug.replay, t);
  const ripples = bug.replay.filter((ev) => ev.kind === "click" && t - ev.t >= 0 && t - ev.t < 550);

  return (
    <div className="relative h-full w-full select-none overflow-hidden">
      {bug.scenario === "checkout" && <CheckoutScenario d={d} />}
      {bug.scenario === "dashboard" && <DashboardScenario d={d} />}
      {bug.scenario === "settings" && <SettingsScenario d={d} />}

      {/* picked-element spotlight */}
      {highlightRect && (
        <div
          className="pointer-events-none absolute z-20 rounded-sm border-2 border-amber-500 bg-amber-400/10 shadow-[0_0_0_4000px_rgba(17,18,23,0.28)] transition-all duration-200"
          style={{
            left: `${highlightRect.x * 100}%`,
            top: `${highlightRect.y * 100}%`,
            width: `${highlightRect.w * 100}%`,
            height: `${highlightRect.h * 100}%`,
          }}
        />
      )}

      {/* click ripples */}
      {ripples.map((ev) =>
        ev.kind === "click" ? (
          <span
            key={ev.t}
            className="click-ripple pointer-events-none absolute z-30 size-8 rounded-full border-2 border-blue-500 bg-blue-400/30"
            style={{ left: `${ev.x * 100}%`, top: `${ev.y * 100}%` }}
          />
        ) : null,
      )}

      {/* cursor */}
      <svg
        className="pointer-events-none absolute z-30 drop-shadow-sm transition-transform duration-75"
        style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%`, width: 15, height: 15 }}
        viewBox="0 0 16 16"
      >
        <path d="M1 1l5.5 13 1.8-5.7L14 6.5z" fill="#18181b" stroke="#fff" strokeWidth="1.2" />
      </svg>
    </div>
  );
}
