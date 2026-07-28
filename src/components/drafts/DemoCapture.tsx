// ABOUTME: Live demo capture — records a real rrweb session of a scripted mini-app (typing, clicks,
// ABOUTME: a failing save), then files it as a draft. Proves the whole capture→review→replay pipeline.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { record } from "rrweb";
import type { Draft, ReplayEvent, ConsoleEntry, NetEntry, BugMarker } from "@/lib/types";
import { idb } from "@/lib/store";
import { uploadJson } from "@/lib/storage-api";
import { loadSession } from "@/lib/auth";
import { envFromUrl } from "@/lib/meta";

const DEMO_URL = "https://demo.bugfinder.dev/profile";

/** Center of an element, normalized to the viewport (matches the extension's coordinates). */
function center(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight };
}

export function DemoCapture() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState("Starting recorder…");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const saveRef = useRef<HTMLButtonElement | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const events: unknown[] = [];
    const stop = record({
      emit: (e) => events.push(e),
      maskInputOptions: {},
      inlineStylesheet: true,
    });

    const t0 = Date.now();
    const now = () => Date.now() - t0;
    const replay: ReplayEvent[] = [{ t: 0, kind: "nav", url: DEMO_URL }];
    const consoleLog: ConsoleEntry[] = [];
    const network: NetEntry[] = [];
    const markers: BugMarker[] = [];

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const clickEl = (el: Element | null, target: string) => {
      if (!el) return;
      const c = center(el);
      replay.push({ t: now(), kind: "click", x: c.x, y: c.y, target });
      (el as HTMLElement).click();
      (el as HTMLElement).focus?.();
    };
    const typeInto = async (
      setter: (v: string) => void,
      field: string,
      value: string,
    ) => {
      for (let i = 1; i <= value.length; i++) {
        setter(value.slice(0, i));
        await sleep(55);
      }
      replay.push({ t: now(), kind: "input", field, value });
    };

    void (async () => {
      setPhase("Recording — filling the form…");
      consoleLog.push({ t: now(), level: "info", text: "[demo] profile form mounted" });
      await sleep(700);

      clickEl(nameRef.current, "input#name");
      await typeInto(setName, "name", "Ada Lovelace");
      await sleep(300);

      clickEl(emailRef.current, "input#email");
      await typeInto(setEmail, "email", "ada@example.dev");
      await sleep(400);

      setPhase("Recording — saving (this will fail)…");
      clickEl(saveRef.current, "button#save-profile");
      setSaving(true);
      consoleLog.push({ t: now(), level: "log", text: "[demo] PUT /api/profile …" });
      const reqStart = now();
      await sleep(900);
      setSaving(false);
      setFailed(true);
      const tFail = now();
      network.push({
        id: "n1",
        t: reqStart,
        durationMs: tFail - reqStart,
        method: "PUT",
        url: "https://demo.bugfinder.dev/api/profile",
        status: 500,
        statusText: "Internal Server Error",
        type: "fetch",
        requestBody: JSON.stringify({ name: "Ada Lovelace", email: "ada@example.dev" }, null, 2),
        responseBody: JSON.stringify({ error: "profile service unavailable" }, null, 2),
      });
      consoleLog.push({ t: tFail, level: "error", text: "PUT https://demo.bugfinder.dev/api/profile 500 (Internal Server Error)" });
      replay.push({ t: tFail, kind: "error", message: "PUT /api/profile 500" });
      markers.push({ t: tFail, label: "Save failed with 500", kind: "error" });
      await sleep(900);

      clickEl(saveRef.current, "button#save-profile");
      consoleLog.push({ t: now(), level: "warn", text: "[demo] retry also failed — error state persists" });
      await sleep(1100);

      setPhase("Uploading recording to storage…");
      stop?.();
      const durationMs = now();
      // Prefer the storage service for the heavy recording; fall back to inline events.
      let rrwebFileId: string | undefined;
      let inlineEvents: unknown[] | undefined = events;
      try {
        rrwebFileId = await uploadJson(`demo-${Date.now().toString(36)}-rrweb.json`, events);
        inlineEvents = undefined;
      } catch {
        /* storage unreachable — keep events inline */
      }
      setPhase("Packaging the draft…");
      const pick = saveRef.current;
      const draft: Draft = {
        id: `d-demo-${Date.now().toString(36)}`,
        reporter: loadSession() ?? undefined,
        createdAt: t0,
        pageUrl: DEMO_URL,
        pageTitle: "Profile · Bug Finder demo",
        durationMs,
        scenario: "generic",
        replay,
        console: consoleLog,
        network,
        pickedElements: pick
          ? [
              {
                selector: "#save-profile",
                tag: "button",
                text: "Save profile",
                rect: (() => {
                  const r = pick.getBoundingClientRect();
                  return {
                    x: r.left / window.innerWidth,
                    y: r.top / window.innerHeight,
                    w: r.width / window.innerWidth,
                    h: r.height / window.innerHeight,
                  };
                })(),
                t: durationMs - 500,
                note: "Save keeps failing with a 500 — captured live by the demo recorder.",
              },
            ]
          : [],
        markers,
        visits: [{ t: 0, url: DEMO_URL, title: "Profile · Bug Finder demo" }],
        environment: {
          browser: /Chrome\/(\d+)/.exec(navigator.userAgent) ? `Chrome ${/Chrome\/(\d+)/.exec(navigator.userAgent)![1]}` : "Browser",
          os: /Mac/.test(navigator.userAgent) ? "macOS" : "OS",
          viewport: { w: window.innerWidth, h: window.innerHeight },
          dpr: window.devicePixelRatio,
          language: navigator.language,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          online: navigator.onLine,
          cores: navigator.hardwareConcurrency,
        },
        notes: "Recorded by the built-in demo capture — a real rrweb recording of this very flow.",
        env: envFromUrl(DEMO_URL),
        rrweb: inlineEvents,
        rrwebFileId,
      };
      // Await the write — reloading before the IDB transaction commits would lose the draft.
      await idb.put("drafts", draft);
      navigate(`/drafts/${draft.id}`, { replace: true });
      // A hard reload guarantees the drafts state re-hydrates from IDB with the new draft.
      window.location.reload();
    })();

    // No cleanup-stop: StrictMode's double-mount would kill the recorder instantly (the
    // run-once guard blocks the second body, so nothing would restart it). The script
    // stops the recorder itself; the page reload tears everything down regardless.
  }, [navigate]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-50">
      {/* status strip — ignored visually in the replay, tells the live user what's happening */}
      <div className="flex h-9 items-center justify-center gap-2 bg-zinc-900 text-[12px] font-semibold text-white">
        <span className="size-2 animate-pulse rounded-full bg-rose-500" />
        {phase}
      </div>

      {/* the demo mini-app being recorded */}
      <div className="flex flex-1 items-center justify-center">
        <div className="w-[420px] rounded-xl border border-zinc-200 bg-white p-6 shadow-lg">
          <div className="mb-4 flex items-center gap-2">
            <div className="size-6 rounded-md bg-zinc-900" />
            <p className="text-[15px] font-bold text-zinc-900">Edit profile</p>
          </div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Name</label>
          <input
            ref={nameRef}
            id="name"
            value={name}
            readOnly
            className="mb-3 h-9 w-full rounded-lg border border-zinc-300 px-3 text-[13px] text-zinc-800 outline-none focus:border-zinc-500"
          />
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Email</label>
          <input
            ref={emailRef}
            id="email"
            value={email}
            readOnly
            className="mb-4 h-9 w-full rounded-lg border border-zinc-300 px-3 text-[13px] text-zinc-800 outline-none focus:border-zinc-500"
          />
          <button
            ref={saveRef}
            id="save-profile"
            type="button"
            className={`h-10 w-full rounded-lg text-[13px] font-bold text-white ${failed ? "bg-red-500" : "bg-zinc-900"}`}
          >
            {saving ? "Saving…" : failed ? "Something went wrong" : "Save profile"}
          </button>
          {failed && (
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 font-mono text-[10.5px] text-red-600">
              PUT /api/profile → 500 profile service unavailable
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
