import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+/<>=";

interface Props {
  text: string;
  play: boolean; // (re)decode whenever this turns true, or the text changes while it is true
  delay?: number; // ms before decoding starts
  duration?: number; // ms to reveal the whole text
  className?: string;
}

/** Text that "decodes" from random glyphs, left to right, like a HUD readout. */
export function ScrambleText({ text, play, delay = 0, duration = 650, className }: Props) {
  const [shown, setShown] = useState(text);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!play || reduceMotion) {
      setShown(text);
      return;
    }
    let raf = 0;
    const start = performance.now() + delay;
    const tick = (now: number) => {
      const k = Math.max(0, Math.min(1, (now - start) / duration));
      const fixed = Math.floor(k * text.length);
      let out = "";
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        out += i < fixed || ch === " " || ch === "·" ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      setShown(out);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // Background tabs pause animation frames; make sure the real text always lands.
    const done = window.setTimeout(() => {
      cancelAnimationFrame(raf);
      setShown(text);
    }, delay + duration + 100);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(done);
    };
  }, [text, play, delay, duration, reduceMotion]);

  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">{shown}</span>
    </span>
  );
}
