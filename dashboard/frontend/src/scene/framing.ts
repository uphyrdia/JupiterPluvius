import type { Framing } from "./Stage";

/*
 * Where the ∞ sits on the overview. The sculpture keeps rhine-lock's own camera; what's placed here is
 * rhine-lock's whole 16:9 frame (centre and height, CSS px). Measured over ten minutes of its rocking,
 * the mirrored sculpture fills x 0.163–0.856 and y 0.129–0.877 of that frame, and its strands cross at
 * x 0.476, y 0.514.
 *
 * On the desktop layout it takes the old ribbon's place: from 62vw − 1.25r to 62vw + 1.18r across,
 * r = min(23.5vw, 43vh), centred 53% down (just under the AI check-up window in the top right corner).
 * pages.css repeats that span in --ribbon-left / --ribbon-right (the soil moisture window and the light
 * callout keep clear of it): update both together.
 */
export function overviewFrame(vw: number, vh: number, compact: boolean): Framing {
  if (compact) {
    // centred in the space the stacked layout leaves at the top (.ov-ribbon-space)
    const r = Math.min(0.4 * vw, 0.21 * vh);
    const h = 1.97 * r;
    return { x: 0.5 * vw - 0.0096 * h * (16 / 9), y: 0.3 * vh, h };
  }
  const r = Math.min(0.235 * vw, 0.43 * vh);
  return { x: 0.62 * vw - 0.069 * r, y: 0.53 * vh, h: 1.97 * r };
}
