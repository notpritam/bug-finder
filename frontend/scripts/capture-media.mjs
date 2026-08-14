// ABOUTME: Screencasts the real Bug Finder session replay to a frame sequence, for the landing page.
// ABOUTME: Uses CDP Page.startScreencast rather than a screenshot loop, so the frame rate is the
// ABOUTME: browser's own and the motion is the product actually running, not a slideshow of stills.
// ABOUTME: Run this whenever the session UI changes, or public/media/ becomes a picture of an
// ABOUTME: older product. Frames come out at CSS-pixel size — screencast ignores deviceScaleFactor.
//
//   TOKEN_FILE=… USER_FILE=… OUT_DIR=…/frames SECONDS=9 node scripts/capture-media.mjs
//
// TOKEN_FILE / USER_FILE hold a signed-in session's `bf.session-token` and `bf.session-user`.
// They are credentials: keep them outside the repo, chmod 600, and delete them afterwards.
// Then, from OUT_DIR:
//   ffmpeg -framerate $(ls f*.png|wc -l)/9 -i f%04d.png -vf crop=1488:700:88:169 \
//     -c:v libx264 -pix_fmt yuv420p -crf 26 -movflags +faststart -r 30 replay.mp4
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";

const BASE = "https://auto-fill-dashboard.internal.emergent.host";
const TOKEN = readFileSync(process.env.TOKEN_FILE, "utf8").trim();
const SESSION = process.env.SESSION_ID || "BF-147";
const OUT = process.env.OUT_DIR;
const SECONDS = Number(process.env.SECONDS || 9);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--force-color-profile=srgb", "--font-render-hinting=none"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

// Seed the session before any app code runs, so the first paint is already authenticated.
// The app gates on the user record as well as the token — with only the token it bounced to the list.
await page.addInitScript(
  ([tok, user]) => {
    localStorage.setItem("bf.session-token", tok);
    localStorage.setItem("bf.session-user", user);
  },
  [TOKEN, readFileSync(process.env.USER_FILE, "utf8").trim()],
);

// Land on the list and click through, rather than deep-linking. A cold load of /session/:id renders
// once before the user resolves and falls through the catch-all route back to /sessions.
await page.goto(`${BASE}/sessions`, { waitUntil: "networkidle" });
await page.getByText(process.env.SESSION_TITLE || "Save profile fails with 500").first().click();
await page.waitForTimeout(2000);

try {
  await page.getByText("demo.bugfinder.dev/profile", { exact: true }).first().waitFor({ timeout: 15000 });
} catch {
  await page.screenshot({ path: `${OUT}/debug.png` });
  console.error("REPLAY NOT FOUND. url=%s", page.url());
  console.error("body:", (await page.evaluate(() => document.body.innerText)).slice(0, 400));
  await browser.close();
  process.exit(2);
}

// Collapse the rail: the capture is of the product, not of whoever is signed in.
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find(
    (x) => /collapse sidebar/i.test(x.getAttribute("aria-label") || ""),
  );
  b?.click();
});
await page.waitForTimeout(600);

// The replay pulls its evidence from storage after mount. Pressing play before that lands leaves
// every frame on "Fetching full evidence…", so wait for a real activity row to exist.
await page.getByText("Typed in name").first().waitFor({ timeout: 30000 });
await page.waitForTimeout(1200);

// The region that holds the replay stage and the evidence rail.
const clip = await page.evaluate(() => {
  const grid = document.querySelector(".soft-fade.grid");
  const r = grid.getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
});
console.log("clip", JSON.stringify(clip));

const cdp = await ctx.newCDPSession(page);
let n = 0;
cdp.on("Page.screencastFrame", async ({ data, sessionId }) => {
  writeFileSync(`${OUT}/f${String(n++).padStart(4, "0")}.png`, Buffer.from(data, "base64"));
  try { await cdp.send("Page.screencastFrameAck", { sessionId }); } catch {}
});

// Rewind, then start the replay and record it running.
await page.evaluate(() => {
  const restart = [...document.querySelectorAll("button")].find(
    (b) => /restart|replay from start/i.test(b.getAttribute("aria-label") || ""),
  );
  restart?.click();
});
await page.waitForTimeout(400);

// Screencast defaults to the CSS viewport; raising the caps to the backing-store size gives
// 2x frames, which the landing page needs on a retina display.
await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1, maxWidth: 3200, maxHeight: 2000 });
const played = await page.evaluate(() => {
  const play = [...document.querySelectorAll("button")].find((b) =>
    /^play recording$/i.test((b.getAttribute("aria-label") || b.title || "").trim()),
  );
  if (!play) {
    return { ok: false, labels: [...document.querySelectorAll("button")].map((b) => b.getAttribute("aria-label")).filter(Boolean).slice(0, 20) };
  }
  play.click();
  return { ok: true };
});
console.log("play", JSON.stringify(played));
await page.waitForTimeout(SECONDS * 1000);
const endClock = await page.evaluate(() => document.body.innerText.match(/0:\d\d\s*\/\s*0:\d\d/)?.[0]);
console.log("clock after play:", endClock);
await cdp.send("Page.stopScreencast");

console.log(JSON.stringify({ frames: n, clip }));
writeFileSync(`${OUT}/clip.json`, JSON.stringify(clip));
await browser.close();
