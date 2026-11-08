import type { Framing } from "./Stage";

/*
 * Where the ∞ sits on the overview. The sculpture keeps rhine-lock's own camera; what's placed here is
 * rhine-lock's whole 16:9 frame (centre and height, CSS px). Measured over ten minutes of its rocking,
 * the mirrored sculpture fills x 0.163–0.856 and y 0.129–0.877 of that frame: across, 1.233 times the
 * frame's height, or SPAN with a margin for the pointer's parallax.
 *
 * On the desktop layout it's drawn at rhine-lock's own size: the frame is as tall as the screen (as wide,
 * on screens narrower than 16:9), centred top to bottom like rhine-lock's. Across, it's centred at 62vw
 * where there's room; otherwise it moves left, leaving room on its right for the light callout, but never
 * over the text column on the left (the soil moisture window may cover part of the left loop, as
 * rhine-lock's login panel covers part of its sculpture). It's smaller only where even that doesn't fit,
 * or where the bottom row of callouts, which sits just under the left loop's lowest fin (0.298h below the
 * frame's middle), wouldn't fit above the scroll cue: below(vw) is the 24px gap, the row (69px plus its
 * values' font size) and the cue with 6px to spare.
 * pages.css repeats this in --ribbon-h / --ribbon-left / --ribbon-right: update both together.
 */
export const SPAN = 1.25;
const LIGHT = 154; // room for the light callout on the right: its width (about 130px) and a 24px gap
const padX = (vw: number) => Math.min(56, Math.max(20, 0.032 * vw)); // --pad-x in base.css
const columnEnd = (vw: number) => Math.min(0.21 * vw, padX(vw) + 280); // --column-end in pages.css
const below = (vw: number) => 170 + Math.min(30, Math.max(22, 0.019 * vw)); // .callout-value: clamp(22px, 1.9vw, 30px)

export function overviewFrame(vw: number, vh: number, compact: boolean): Framing {
  if (compact) {
    // centred in the space the stacked layout leaves at the top (.ov-ribbon-space)
    const r = Math.min(0.4 * vw, 0.21 * vh);
    const h = 1.97 * r;
    return { x: 0.5 * vw - 0.0096 * h * (16 / 9), y: 0.3 * vh, h };
  }
  const from = columnEnd(vw) + 24, to = vw - padX(vw) - LIGHT;
  const h = Math.min(vh, (9 / 16) * vw, (to - from) / SPAN, (0.5 * vh - below(vw)) / 0.298);
  const left = Math.min(Math.max(from, 0.62 * vw - (SPAN * h) / 2), to - SPAN * h);
  // the sculpture's left edge is 0.5995h left of the frame's centre, inside a margin of (SPAN - 1.233)h / 2
  return { x: left + 0.608 * h, y: 0.5 * vh, h };
}
