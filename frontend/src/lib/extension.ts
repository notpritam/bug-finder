// ABOUTME: Which recorder build the dashboard is currently serving. Two pages offer the download —
// ABOUTME: the landing page and /connect — and both used to write the version and filename by hand,
// ABOUTME: which is how /connect spent two releases handing out 0.2.3 while the API served 0.2.5.
// ABOUTME: The endpoint is unauthenticated on purpose, so a signed-out visitor can still read it.
import { useEffect, useState } from "react";

const BASE = import.meta.env.REACT_APP_BACKEND_URL as string | undefined;

export interface Release {
  version: string;
  /** Absolute or origin-relative; already resolved against the API origin. */
  downloadUrl: string;
}

/** Null until it resolves, and null forever if it cannot. Callers must render something that still
 *  works without it — never a download button pointing at a guessed filename.
 *
 *  The content-type check is load-bearing rather than defensive noise: this app is served behind a
 *  SPA fallback that answers ANY unknown path with index.html and a 200, so `res.ok` is true even
 *  when no API was reached at all. Checking only `res.ok` turns "there is no such route" into a
 *  JSON parse error, which is a much harder thing to read in a bug report.
 */
export function useRelease(): Release | null {
  const [release, setRelease] = useState<Release | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${BASE ?? ""}/api/extension/latest`)
      .then((r) => (r.ok && r.headers.get("content-type")?.includes("json") ? r.json() : null))
      .then((d) => {
        if (!live || !d?.version || !d?.downloadUrl) return;
        // Resolve against the API origin: in dev the zip is served by the backend, not by vite.
        setRelease({ version: d.version, downloadUrl: `${BASE ?? ""}${d.downloadUrl}` });
      })
      .catch(() => {
        /* offline, or the API is down — callers fall back to sending people to /connect */
      });
    return () => {
      live = false;
    };
  }, []);

  return release;
}
