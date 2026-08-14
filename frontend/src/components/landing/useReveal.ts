// ABOUTME: Scroll-triggered reveal. One shared IntersectionObserver for the whole page rather than
// ABOUTME: one per element, and it unobserves after firing — a landing page has enough of these that
// ABOUTME: the difference is real. Honours prefers-reduced-motion by revealing everything up front,
// ABOUTME: which matters more here than usual: the reveal hides content until it fires, so a broken
// ABOUTME: observer or a motion-averse reader must still end up with a readable page.
import { useEffect } from "react";

export function useReveal() {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (!nodes.length) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver === "undefined") {
      nodes.forEach((n) => n.setAttribute("data-revealed", ""));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.setAttribute("data-revealed", "");
          io.unobserve(e.target);
        }
      },
      // Fires a little before the element reaches the fold, so the motion reads as the page
      // settling rather than as content arriving late.
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
    );

    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, []);
}
