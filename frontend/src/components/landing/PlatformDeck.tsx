// ABOUTME: The five-card platform deck, built on the pattern the owner pointed at: a mono counter
// ABOUTME: ("1" + a dimmed "of 5") above a horizontal track of tall cards, each numbered, the
// ABOUTME: active one lifting from a tint wash to a solid surface. Scroll-driven rather than
// ABOUTME: JS-animated, so it works with a trackpad, a keyboard, and a touch swipe for free.
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

export interface DeckCard {
  n: string;
  title: string;
  body: string;
  /** The concrete artefact this card is about — rendered as the card's own illustration. */
  figure: React.ReactNode;
  /** A measured number closing the card, in the reference's `8,932,104 AUTO-HEALS` register. */
  stat: { value: string; label: string };
}

/** `aside` is the section's heading block. The deck owns it because it also owns the controls that
 *  sit beneath it — splitting them across two components meant the layout lived in neither. */
export function PlatformDeck({ cards, aside }: { cards: DeckCard[]; aside?: React.ReactNode }) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);

  // Read the cards' real offsets rather than dividing scrollWidth by the count. The average is only
  // right when every column is equal and nothing else occupies the track; the track now carries
  // trailing padding so the last card clears the screen edge, which skews that average enough to
  // leave the arrows landing a little short of each card by the end.
  const offsets = useCallback(() => {
    const el = trackRef.current;
    if (!el) return [];
    return [...el.children].map((c) => (c as HTMLElement).offsetLeft - el.offsetLeft);
  }, []);

  // Derived from scroll position rather than tracked by a click handler, so a swipe, a shift-wheel
  // and the buttons below all report the same index without three code paths agreeing to.
  const onScroll = useCallback(() => {
    const el = trackRef.current;
    const xs = offsets();
    if (!el || !xs.length) return;
    let best = 0;
    for (let i = 1; i < xs.length; i++) {
      if (Math.abs(xs[i] - el.scrollLeft) < Math.abs(xs[best] - el.scrollLeft)) best = i;
    }
    setActive(best);
  }, [offsets]);

  const go = useCallback(
    (i: number) => {
      const el = trackRef.current;
      const xs = offsets();
      if (!el || !xs.length) return;
      const next = Math.min(xs.length - 1, Math.max(0, i));
      el.scrollTo({ left: xs[next], behavior: "smooth" });
    },
    [offsets],
  );

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [onScroll]);

  return (
    <div className="lp-deck">
      {/* Pinned to the container; the track beside it is what runs off the screen. */}
      <div className="lp-deck-aside">
        {aside}
        <div className="lp-deck-controls">
          {/* The counter: current at full weight, the total dimmed — it is context, not a number
              anyone reads. */}
          <p className="lp-counter" aria-live="polite">
            <span>{String(active + 1).padStart(2, "0")}</span>
            <span className="lp-counter-total"> of {String(cards.length).padStart(2, "0")}</span>
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => go(active - 1)}
              disabled={active === 0}
              className="lp-deck-nav"
              aria-label="Previous card"
            >
              <ArrowLeft className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => go(active + 1)}
              disabled={active === cards.length - 1}
              className="lp-deck-nav"
              aria-label="Next card"
            >
              <ArrowRight className="size-3.5" />
            </button>
          </div>
        </div>

        <div className="lp-dots" role="tablist" aria-label="Jump to card">
          {cards.map((c, i) => (
            <button
              key={c.n}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={`Card ${i + 1}: ${c.title}`}
              onClick={() => go(i)}
              className={`lp-dot${i === active ? " is-active" : ""}`}
            />
          ))}
        </div>
      </div>

      <div className="lp-deck-main">
      <div ref={trackRef} className="lp-deck-track" tabIndex={0} aria-label="Platform capabilities">
        {cards.map((c, i) => (
          <article key={c.n} className={`lp-card-tall${i === active ? " is-active" : ""}`} aria-current={i === active}>
            <span className="lp-card-n">{c.n}</span>
            <h3 className="lp-card-title">{c.title}</h3>
            <div className="lp-card-figure">{c.figure}</div>
            <p className="lp-card-body">{c.body}</p>
            {/* Closes the card on a number rather than trailing off — the reference's move, and it
                keeps every card the same height regardless of how long the body runs. */}
            <p className="lp-card-stat">
              <b>{c.stat.value}</b>
              <span>{c.stat.label}</span>
            </p>
          </article>
        ))}
      </div>
      </div>
    </div>
  );
}
