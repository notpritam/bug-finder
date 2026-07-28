// ABOUTME: Dummy bug dataset — scripted replay scenarios (cursor paths, clicks, navs, errors)
// ABOUTME: with console/network/element data synced to the same clock, until the extension ships.
import type {
  Bug,
  BugEvent,
  ConsoleEntry,
  NetEntry,
  PickedElement,
  ReplayEvent,
  Reporter,
} from "./types";

const NOW = Date.now();
const MIN = 60_000;

export const USERS: Reporter[] = [
  { id: "u1", name: "Pritam Sharma", email: "pritam@emergent.sh" },
  { id: "u2", name: "Maya Chen", email: "maya@emergent.sh" },
  { id: "u3", name: "Dev Patel", email: "dev@emergent.sh" },
  { id: "u4", name: "Sara Kim", email: "sara@emergent.sh" },
];
export const ME = USERS[0];

/** Sample a smooth cursor path through waypoints into `move` events every ~90ms. */
function path(points: { t: number; x: number; y: number }[]): ReplayEvent[] {
  const out: ReplayEvent[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const steps = Math.max(1, Math.floor((b.t - a.t) / 90));
    for (let s = 0; s < steps; s++) {
      const f = s / steps;
      // slight ease so movement doesn't look robotic
      const e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
      out.push({
        t: Math.round(a.t + (b.t - a.t) * f),
        kind: "move",
        x: a.x + (b.x - a.x) * e,
        y: a.y + (b.y - a.y) * e,
      });
    }
  }
  const last = points[points.length - 1];
  out.push({ t: last.t, kind: "move", x: last.x, y: last.y });
  return out;
}

function sortEvents(events: ReplayEvent[]): ReplayEvent[] {
  return [...events].sort((a, b) => a.t - b.t);
}

const JSON_HEADERS = { "content-type": "application/json" };

function net(
  id: string,
  t: number,
  method: string,
  url: string,
  status: number,
  extra: Partial<NetEntry> = {},
): NetEntry {
  return {
    id,
    t,
    durationMs: extra.durationMs ?? 120,
    method,
    url,
    status,
    statusText: status === 200 ? "OK" : status === 201 ? "Created" : status === 500 ? "Internal Server Error" : status === 404 ? "Not Found" : status === 422 ? "Unprocessable Entity" : "",
    type: extra.type ?? "fetch",
    requestHeaders: { accept: "application/json", ...(extra.requestHeaders ?? {}) },
    responseHeaders: { ...JSON_HEADERS, ...(extra.responseHeaders ?? {}) },
    requestBody: extra.requestBody ?? null,
    responseBody: extra.responseBody ?? null,
    sizeBytes: extra.sizeBytes ?? 1840,
  };
}

/* ------------------------------------------------------------------ *
 * BF-101 — Checkout: "Place order" 500s and the button dies
 * ------------------------------------------------------------------ */
const checkoutReplay: ReplayEvent[] = sortEvents([
  { t: 0, kind: "nav", url: "https://shop.acme.dev/cart" },
  ...path([
    { t: 400, x: 0.5, y: 0.42 },
    { t: 1800, x: 0.78, y: 0.34 },
    { t: 3200, x: 0.79, y: 0.55 },
  ]),
  { t: 3400, kind: "click", x: 0.79, y: 0.55, target: "button.checkout" },
  { t: 3900, kind: "nav", url: "https://shop.acme.dev/checkout" },
  ...path([
    { t: 4200, x: 0.42, y: 0.3 },
    { t: 5400, x: 0.34, y: 0.36 },
  ]),
  { t: 5600, kind: "click", x: 0.34, y: 0.36, target: "input#email" },
  { t: 6000, kind: "input", field: "email", value: "maya@example.com" },
  ...path([
    { t: 7600, x: 0.34, y: 0.36 },
    { t: 8600, x: 0.34, y: 0.47 },
  ]),
  { t: 8800, kind: "click", x: 0.34, y: 0.47, target: "input#card" },
  { t: 9200, kind: "input", field: "card", value: "4242 4242 4242 4242" },
  ...path([
    { t: 11400, x: 0.34, y: 0.47 },
    { t: 12600, x: 0.35, y: 0.62 },
  ]),
  { t: 12900, kind: "click", x: 0.35, y: 0.62, target: "button#place-order" },
  { t: 14100, kind: "error", message: "POST /api/orders 500" },
  ...path([
    { t: 14400, x: 0.35, y: 0.62 },
    { t: 15600, x: 0.36, y: 0.62 },
  ]),
  { t: 15900, kind: "click", x: 0.36, y: 0.62, target: "button#place-order" },
  { t: 16400, kind: "click", x: 0.36, y: 0.62, target: "button#place-order" },
  { t: 17800, kind: "error", message: "TypeError: Cannot read properties of undefined (reading 'id')" },
  ...path([
    { t: 18200, x: 0.36, y: 0.62 },
    { t: 20500, x: 0.62, y: 0.4 },
    { t: 23000, x: 0.5, y: 0.52 },
  ]),
]);

const checkoutConsole: ConsoleEntry[] = [
  { t: 900, level: "info", text: "[cart] hydrated 3 items from localStorage" },
  { t: 4100, level: "log", text: "[checkout] step=payment session=cs_9f2ab" },
  { t: 9400, level: "debug", text: "[stripe] tokenizing card ****4242" },
  { t: 13400, level: "warn", text: "[checkout] slow response from /api/orders (>1200ms)" },
  { t: 14100, level: "error", text: "POST https://shop.acme.dev/api/orders 500 (Internal Server Error)" },
  { t: 14150, level: "error", text: "Uncaught (in promise) OrderError: order creation failed" },
  { t: 17800, level: "error", text: "TypeError: Cannot read properties of undefined (reading 'id')\n    at OrderConfirmation (checkout.js:412)\n    at renderWithHooks (react-dom.js:15486)" },
  { t: 18300, level: "warn", text: "[ui] place-order button stuck in loading state" },
];

const checkoutNetwork: NetEntry[] = [
  net("n1", 350, "GET", "https://shop.acme.dev/api/cart", 200, {
    responseBody: JSON.stringify({ items: 3, subtotal: 8400, currency: "usd" }, null, 2),
    durationMs: 95,
  }),
  net("n2", 3950, "GET", "https://shop.acme.dev/api/checkout/session", 200, {
    responseBody: JSON.stringify({ id: "cs_9f2ab", step: "payment" }, null, 2),
    durationMs: 140,
  }),
  net("n3", 9300, "POST", "https://api.stripe.com/v1/tokens", 200, {
    requestBody: JSON.stringify({ card: "****4242", exp: "12/27" }, null, 2),
    responseBody: JSON.stringify({ id: "tok_1PZk2x", livemode: false }, null, 2),
    durationMs: 310,
  }),
  net("n4", 13000, "POST", "https://shop.acme.dev/api/orders", 500, {
    requestBody: JSON.stringify({ sessionId: "cs_9f2ab", token: "tok_1PZk2x", total: 8400 }, null, 2),
    responseBody: JSON.stringify({ error: "insert into orders violates not-null constraint \"orders_user_id\"" }, null, 2),
    durationMs: 1240,
  }),
  net("n5", 15950, "POST", "https://shop.acme.dev/api/orders", 500, {
    requestBody: JSON.stringify({ sessionId: "cs_9f2ab", token: "tok_1PZk2x", total: 8400 }, null, 2),
    responseBody: JSON.stringify({ error: "insert into orders violates not-null constraint \"orders_user_id\"" }, null, 2),
    durationMs: 980,
  }),
  net("n6", 20100, "POST", "https://o450.ingest.sentry.io/api/envelope", 200, { durationMs: 88, sizeBytes: 4210 }),
];

const checkoutPicked: PickedElement[] = [
  {
    selector: "#place-order",
    tag: "button",
    text: "Place order",
    rect: { x: 0.165, y: 0.367, w: 0.403, h: 0.049 },
    t: 21000,
    note: "Button never leaves the spinner state after the request fails — no error shown to the user.",
    component: "<CheckoutSubmit>",
  },
  {
    selector: ".order-summary .total",
    tag: "div",
    text: "$84.00",
    rect: { x: 0.596, y: 0.233, w: 0.227, h: 0.035 },
    t: 22400,
    note: "Total is right, so the payload issue is server-side (user_id missing).",
    component: "<OrderSummary>",
  },
];

/* ------------------------------------------------------------------ *
 * BF-102 — Dashboard: chart crashes on empty dataset
 * ------------------------------------------------------------------ */
const dashboardReplay: ReplayEvent[] = sortEvents([
  { t: 0, kind: "nav", url: "https://app.acme.dev/analytics" },
  ...path([
    { t: 500, x: 0.5, y: 0.35 },
    { t: 2000, x: 0.22, y: 0.24 },
  ]),
  { t: 2200, kind: "click", x: 0.22, y: 0.24, target: "select#date-range" },
  ...path([
    { t: 2500, x: 0.22, y: 0.24 },
    { t: 3400, x: 0.23, y: 0.33 },
  ]),
  { t: 3600, kind: "click", x: 0.23, y: 0.33, target: "option[value=last-90d]" },
  { t: 5200, kind: "error", message: "RangeError: invalid array length" },
  ...path([
    { t: 5500, x: 0.23, y: 0.33 },
    { t: 7000, x: 0.55, y: 0.55 },
    { t: 9500, x: 0.55, y: 0.56 },
    { t: 11500, x: 0.3, y: 0.24 },
  ]),
  { t: 11800, kind: "click", x: 0.3, y: 0.24, target: "button#refresh" },
  { t: 13100, kind: "error", message: "RangeError: invalid array length" },
  ...path([
    { t: 13400, x: 0.3, y: 0.24 },
    { t: 15600, x: 0.52, y: 0.5 },
  ]),
  { t: 16800, kind: "scroll", y: 0.2 },
  ...path([
    { t: 17000, x: 0.52, y: 0.5 },
    { t: 19500, x: 0.5, y: 0.62 },
  ]),
]);

const dashboardConsole: ConsoleEntry[] = [
  { t: 700, level: "info", text: "[analytics] loaded 30d window, 1,204 events" },
  { t: 4300, level: "log", text: "[analytics] fetching window=90d" },
  { t: 5100, level: "warn", text: "[charts] series is empty — falling back to []" },
  { t: 5200, level: "error", text: "RangeError: invalid array length\n    at buildBuckets (timeseries.ts:88)\n    at TrendChart (TrendChart.tsx:41)" },
  { t: 5250, level: "error", text: "React will try to recreate this component tree from scratch using the error boundary you provided, ChartBoundary." },
  { t: 13100, level: "error", text: "RangeError: invalid array length\n    at buildBuckets (timeseries.ts:88)" },
];

const dashboardNetwork: NetEntry[] = [
  net("n1", 300, "GET", "https://app.acme.dev/api/metrics?window=30d", 200, {
    responseBody: JSON.stringify({ points: 30, total: 1204 }, null, 2),
    durationMs: 220,
  }),
  net("n2", 4300, "GET", "https://app.acme.dev/api/metrics?window=90d", 200, {
    responseBody: JSON.stringify({ points: 0, total: 0, note: "no data before 2026-05-01" }, null, 2),
    durationMs: 640,
  }),
  net("n3", 11900, "GET", "https://app.acme.dev/api/metrics?window=90d", 200, {
    responseBody: JSON.stringify({ points: 0, total: 0 }, null, 2),
    durationMs: 410,
  }),
];

const dashboardPicked: PickedElement[] = [
  {
    selector: ".chart-panel[data-chart=trend]",
    tag: "section",
    text: "Weekly active users",
    rect: { x: 0.163, y: 0.187, w: 0.824, h: 0.229 },
    t: 9000,
    note: "Whole panel white-screens; boundary fallback flashes then crashes again on refresh.",
    component: "<TrendChart>",
  },
];

/* ------------------------------------------------------------------ *
 * BF-103 — Settings: avatar upload hangs forever
 * ------------------------------------------------------------------ */
const settingsReplay: ReplayEvent[] = sortEvents([
  { t: 0, kind: "nav", url: "https://app.acme.dev/settings/profile" },
  ...path([
    { t: 500, x: 0.5, y: 0.3 },
    { t: 2200, x: 0.33, y: 0.35 },
  ]),
  { t: 2500, kind: "click", x: 0.33, y: 0.35, target: "button#upload-avatar" },
  ...path([
    { t: 2800, x: 0.33, y: 0.35 },
    { t: 6500, x: 0.4, y: 0.45 },
  ]),
  { t: 7000, kind: "click", x: 0.4, y: 0.45, target: "input[type=file]" },
  { t: 10500, kind: "error", message: "413 Payload Too Large" },
  ...path([
    { t: 10800, x: 0.4, y: 0.45 },
    { t: 12500, x: 0.33, y: 0.55 },
    { t: 15000, x: 0.62, y: 0.68 },
  ]),
  { t: 15400, kind: "click", x: 0.62, y: 0.68, target: "button#save" },
]);

const settingsConsole: ConsoleEntry[] = [
  { t: 800, level: "info", text: "[settings] profile form mounted" },
  { t: 7600, level: "log", text: "[upload] selected IMG_4821.heic (11.2 MB)" },
  { t: 10500, level: "error", text: "PUT https://app.acme.dev/api/avatar 413 (Payload Too Large)" },
  { t: 10600, level: "warn", text: "[upload] no onError handler — progress bar left at 62%" },
];

const settingsNetwork: NetEntry[] = [
  net("n1", 400, "GET", "https://app.acme.dev/api/me", 200, {
    responseBody: JSON.stringify({ id: "u_88", name: "Maya Chen", plan: "team" }, null, 2),
    durationMs: 130,
  }),
  net("n2", 7800, "PUT", "https://app.acme.dev/api/avatar", 413, {
    requestBody: "<binary 11.2 MB image/heic>",
    responseBody: JSON.stringify({ error: "max upload size is 5 MB" }, null, 2),
    durationMs: 2700,
    type: "xhr",
    sizeBytes: 11700000,
  }),
];

const settingsPicked: PickedElement[] = [
  {
    selector: ".upload-progress",
    tag: "div",
    text: "Uploading… 62%",
    rect: { x: 0.183, y: 0.17, w: 0.458, h: 0.058 },
    t: 12000,
    note: "Progress bar never resolves and there is no way to cancel or retry.",
    component: "<AvatarUploader>",
  },
];

/* ------------------------------------------------------------------ *
 * BF-105 — Appearance settings: theme flash (generic wireframe stage)
 * ------------------------------------------------------------------ */
const themeReplay: ReplayEvent[] = sortEvents([
  { t: 0, kind: "nav", url: "https://app.acme.dev/settings/appearance" },
  ...path([
    { t: 400, x: 0.5, y: 0.3 },
    { t: 1800, x: 0.34, y: 0.42 },
  ]),
  { t: 2000, kind: "click", x: 0.34, y: 0.42, target: "button#theme-dark" },
  ...path([
    { t: 2300, x: 0.34, y: 0.42 },
    { t: 4200, x: 0.52, y: 0.2 },
  ]),
  { t: 4500, kind: "click", x: 0.52, y: 0.2, target: "a[href='/analytics']" },
  { t: 5100, kind: "nav", url: "https://app.acme.dev/analytics" },
  ...path([
    { t: 5400, x: 0.52, y: 0.2 },
    { t: 7600, x: 0.3, y: 0.2 },
  ]),
  { t: 7900, kind: "click", x: 0.3, y: 0.2, target: "a[href='/settings/appearance']" },
  { t: 8500, kind: "nav", url: "https://app.acme.dev/settings/appearance" },
  ...path([
    { t: 8800, x: 0.3, y: 0.2 },
    { t: 11500, x: 0.5, y: 0.5 },
  ]),
]);

/* ------------------------------------------------------------------ *
 * BF-106 — "/" shortcut leaks behind the invite modal (generic stage)
 * ------------------------------------------------------------------ */
const shortcutReplay: ReplayEvent[] = sortEvents([
  { t: 0, kind: "nav", url: "https://app.acme.dev/analytics" },
  ...path([
    { t: 500, x: 0.5, y: 0.3 },
    { t: 2200, x: 0.78, y: 0.18 },
  ]),
  { t: 2400, kind: "click", x: 0.78, y: 0.18, target: "button#invite-member" },
  ...path([
    { t: 2700, x: 0.78, y: 0.18 },
    { t: 4600, x: 0.5, y: 0.45 },
  ]),
  { t: 5200, kind: "input", field: "search", value: "/dev@acme" },
  ...path([
    { t: 7000, x: 0.5, y: 0.45 },
    { t: 9200, x: 0.42, y: 0.36 },
  ]),
  { t: 9500, kind: "click", x: 0.42, y: 0.36, target: "input#invite-email" },
  { t: 10200, kind: "input", field: "invite-email", value: "dev@acme.dev" },
  ...path([
    { t: 12500, x: 0.42, y: 0.36 },
    { t: 14200, x: 0.5, y: 0.55 },
  ]),
]);

/* ------------------------------------------------------------------ *
 * Bug history helper
 * ------------------------------------------------------------------ */
function history(created: number, actor: string, extra: BugEvent[] = []): BugEvent[] {
  return [
    { id: "e0", actor, kind: "created", detail: "reported this bug via the extension", at: created },
    ...extra,
  ];
}

const ENV_CHROME = {
  browser: "Chrome 138",
  os: "macOS 15.5",
  viewport: { w: 1440, h: 900 },
  dpr: 2,
  language: "en-US",
  timezone: "Asia/Kolkata",
  online: true,
  connection: "4g · 42 Mbps",
  memoryGb: 16,
  cores: 10,
};

export const BUGS: Bug[] = [
  {
    id: "b1",
    humanId: "BF-101",
    title: "Place order fails with 500 and button stays stuck loading",
    description:
      "On checkout, clicking Place order returns a 500 from /api/orders. The button stays in its spinner state forever, and retrying throws a TypeError in OrderConfirmation. No error is surfaced to the customer — they just see an infinite spinner after entering payment details.",
    status: "open",
    severity: "critical",
    tags: ["checkout", "payments"],
    pageUrl: "https://shop.acme.dev/checkout",
    reporter: USERS[1],
    assignee: USERS[0],
    createdAt: NOW - 42 * MIN,
    updatedAt: NOW - 8 * MIN,
    durationMs: 24000,
    scenario: "checkout",
    replay: checkoutReplay,
    markers: [
      { t: 14100, label: "Order request 500s", kind: "error" },
      { t: 17800, label: "Retry crashes the page", kind: "error" },
      { t: 12900, label: "First Place order click", kind: "user" },
    ],
    visits: [
      { t: 0, url: "https://shop.acme.dev/cart", title: "Cart · Acme Store" },
      { t: 3900, url: "https://shop.acme.dev/checkout", title: "Checkout · Acme Store" },
    ],
    console: checkoutConsole,
    network: checkoutNetwork,
    pickedElements: checkoutPicked,
    environment: ENV_CHROME,
    notes:
      "Reproduces every time with a saved card. The orders insert seems to be missing user_id — see the 500 response body. The stuck spinner is a separate frontend bug: the catch branch never resets `submitting`.",
    events: history(NOW - 42 * MIN, "Maya Chen", [
      { id: "e1", actor: "Pritam Sharma", kind: "assigned", detail: "self-assigned", at: NOW - 30 * MIN },
      { id: "e2", actor: "Pritam Sharma", kind: "comment", detail: "Confirmed on staging — orders.user_id is null when the checkout session is created before login. Fix going into the session middleware.", at: NOW - 8 * MIN },
    ]),
  },
  {
    id: "b2",
    humanId: "BF-102",
    title: "Analytics trend chart crashes on 90-day range with no data",
    description:
      "Selecting 'Last 90 days' on a workspace younger than 90 days white-screens the trend chart panel. buildBuckets throws RangeError: invalid array length when the series is empty. The error boundary catches it but re-crashes on every refresh.",
    status: "in_progress",
    severity: "high",
    tags: ["analytics", "charts"],
    pageUrl: "https://app.acme.dev/analytics",
    reporter: USERS[2],
    assignee: USERS[3],
    createdAt: NOW - 5 * 60 * MIN,
    updatedAt: NOW - 55 * MIN,
    durationMs: 20500,
    scenario: "dashboard",
    replay: dashboardReplay,
    markers: [
      { t: 5200, label: "Chart crashes", kind: "error" },
      { t: 3600, label: "Switched to 90d", kind: "user" },
    ],
    visits: [{ t: 0, url: "https://app.acme.dev/analytics", title: "Analytics · Acme" }],
    console: dashboardConsole,
    network: dashboardNetwork,
    pickedElements: dashboardPicked,
    environment: { ...ENV_CHROME, browser: "Firefox 141", os: "Windows 11", viewport: { w: 1536, h: 864 }, dpr: 1.25, timezone: "America/New_York" },
    notes: "Only happens on workspaces created < 90 days ago. 30d and 7d ranges are fine.",
    events: history(NOW - 5 * 60 * MIN, "Dev Patel", [
      { id: "e1", actor: "Sara Kim", kind: "status", detail: "moved to In progress", at: NOW - 2 * 60 * MIN },
      { id: "e2", actor: "Sara Kim", kind: "comment", detail: "buildBuckets divides by series.length — guard for 0 and render the empty state instead.", at: NOW - 55 * MIN },
    ]),
  },
  {
    id: "b3",
    humanId: "BF-103",
    title: "Avatar upload over 5 MB hangs at 62% with no error",
    description:
      "Uploading a large HEIC photo as an avatar gets a 413 from the API, but the UI never handles the failure — the progress bar freezes at 62% with no error message, cancel, or retry.",
    status: "open",
    severity: "medium",
    tags: ["settings", "uploads"],
    pageUrl: "https://app.acme.dev/settings/profile",
    reporter: USERS[3],
    assignee: null,
    createdAt: NOW - 26 * 60 * MIN,
    updatedAt: NOW - 26 * 60 * MIN,
    durationMs: 17000,
    scenario: "settings",
    replay: settingsReplay,
    markers: [{ t: 10500, label: "Upload rejected 413", kind: "error" }],
    visits: [{ t: 0, url: "https://app.acme.dev/settings/profile", title: "Profile settings · Acme" }],
    console: settingsConsole,
    network: settingsNetwork,
    pickedElements: settingsPicked,
    environment: { ...ENV_CHROME, browser: "Safari 18", viewport: { w: 1512, h: 982 } },
    notes: "The API limit is fine — we just need client-side validation and an error state on the uploader.",
    events: history(NOW - 26 * 60 * MIN, "Sara Kim"),
  },
  {
    id: "b4",
    humanId: "BF-104",
    title: "Coupon field accepts expired codes then silently drops discount",
    description:
      "Applying an expired coupon shows the discount in the cart, but the checkout total charges full price. The /api/coupons endpoint returns 200 with valid:false and the UI ignores the flag.",
    status: "in_progress",
    severity: "high",
    tags: ["checkout", "pricing"],
    pageUrl: "https://shop.acme.dev/cart",
    reporter: USERS[0],
    assignee: USERS[2],
    createdAt: NOW - 2 * 24 * 60 * MIN,
    updatedAt: NOW - 6 * 60 * MIN,
    durationMs: 24000,
    scenario: "checkout",
    replay: checkoutReplay,
    markers: [{ t: 12900, label: "Total ignores coupon state", kind: "user" }],
    visits: [
      { t: 0, url: "https://shop.acme.dev/cart", title: "Cart · Acme Store" },
      { t: 3900, url: "https://shop.acme.dev/checkout", title: "Checkout · Acme Store" },
    ],
    console: [
      { t: 2000, level: "log", text: "[cart] applying coupon SUMMER24" },
      { t: 2400, level: "warn", text: "[cart] coupon response valid:false ignored by reducer" },
    ],
    network: [
      net("n1", 2100, "POST", "https://shop.acme.dev/api/coupons/apply", 200, {
        requestBody: JSON.stringify({ code: "SUMMER24" }, null, 2),
        responseBody: JSON.stringify({ valid: false, reason: "expired 2026-06-30" }, null, 2),
      }),
    ],
    pickedElements: [],
    environment: ENV_CHROME,
    events: history(NOW - 2 * 24 * 60 * MIN, "Pritam Sharma", [
      { id: "e1", actor: "Dev Patel", kind: "status", detail: "moved to In progress", at: NOW - 6 * 60 * MIN },
    ]),
  },
  {
    id: "b5",
    humanId: "BF-105",
    title: "Dark-mode toggle flashes light theme on every page load",
    description:
      "With dark mode saved, every navigation flashes the light theme for ~300ms before the preference applies. The theme is read in a useEffect instead of before first paint.",
    status: "resolved",
    severity: "low",
    tags: ["ui", "theme"],
    pageUrl: "https://app.acme.dev/settings/appearance",
    reporter: USERS[2],
    assignee: USERS[0],
    createdAt: NOW - 6 * 24 * 60 * MIN,
    updatedAt: NOW - 20 * 60 * MIN,
    durationMs: 12000,
    scenario: "generic",
    replay: themeReplay,
    markers: [{ t: 5100, label: "Light flash on navigation", kind: "user" }],
    visits: [
      { t: 0, url: "https://app.acme.dev/settings/appearance", title: "Appearance · Acme" },
      { t: 5100, url: "https://app.acme.dev/analytics", title: "Analytics · Acme" },
      { t: 8500, url: "https://app.acme.dev/settings/appearance", title: "Appearance · Acme" },
    ],
    console: [{ t: 5600, level: "info", text: "[theme] applied dark (from localStorage) after hydration — 280ms after first paint" }],
    network: [],
    pickedElements: [],
    environment: { ...ENV_CHROME, browser: "Edge 138", os: "Windows 11" },
    events: history(NOW - 6 * 24 * 60 * MIN, "Dev Patel", [
      { id: "e1", actor: "Pritam Sharma", kind: "status", detail: "resolved — theme now applied in a blocking head script", at: NOW - 20 * 60 * MIN },
    ]),
  },
  {
    id: "b6",
    humanId: "BF-106",
    title: "Search shortcut '/' types into the page behind the modal",
    description:
      "When the invite modal is open, pressing '/' focuses the background search input and typing leaks into it. Focus isn't trapped in the modal.",
    status: "not_a_bug",
    severity: "low",
    tags: ["a11y", "ui"],
    pageUrl: "https://app.acme.dev/analytics",
    reporter: USERS[3],
    assignee: null,
    createdAt: NOW - 9 * 24 * 60 * MIN,
    updatedAt: NOW - 3 * 24 * 60 * MIN,
    durationMs: 15000,
    scenario: "generic",
    replay: shortcutReplay,
    markers: [{ t: 5200, label: "'/' typed into background search", kind: "user" }],
    visits: [{ t: 0, url: "https://app.acme.dev/analytics", title: "Analytics · Acme" }],
    console: [],
    network: [],
    pickedElements: [],
    environment: ENV_CHROME,
    events: history(NOW - 9 * 24 * 60 * MIN, "Sara Kim", [
      { id: "e1", actor: "Maya Chen", kind: "status", detail: "closed — modal was replaced by the new invite flow last sprint", at: NOW - 3 * 24 * 60 * MIN },
    ]),
  },
];
