import { motion, useMotionValueEvent, useTransform, type MotionValue } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { presence, type Zoom } from "../hooks/usePager";
import { smooth } from "../lib/zoom";
import { ANCHORS, anchorBus } from "./anchors";
import { overviewFrame } from "./framing";
import { Stage, type Quality } from "./Stage";
import environmentUrl from "./studio.hdr?url";

export interface SceneProps {
  offset: MotionValue<number>; // how far the overview is from the view, in pages (see usePager)
  zoom: Zoom | null; // a window zoom in progress (see lib/zoom.ts)
  zt: MotionValue<number>; // ms into that zoom
  compact: boolean;
  reduceMotion: boolean;
  still: boolean; // screenshots (?still): the ∞ is there from the start
}

const GONE_AT = 0.82; // like the overview's own content (see usePager's `presence`), gone 0.82 pages away
const PAGE_SLIDE = 0.12; // pages slide 12vh per page as you move between them (see PageFrame)

const follow = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-dt * rate));

/** rhine-lock's `[frontend] quality`: ultra on the desktop layout, high on phones; ?q=low|high|ultra overrides. */
function qualityFor(compact: boolean): Quality {
  const q = new URLSearchParams(window.location.search).get("q");
  if (q === "ultra" || q === "high" || q === "low") return q;
  return compact ? "high" : "ultra";
}

/**
 * The WebGL layer behind the pages: rhine-lock's ∞ sculpture (see Stage.ts), mirrored, on the overview.
 * It's loaded lazily (see App.tsx), so the dashboard's text and numbers appear first; the ∞ then draws
 * itself in. While pages slide (overview ⇄ log) it moves and fades with the overview. When a window
 * opens its page, the ∞ "unlocks": its fins peel off and fly apart; coming back, it draws itself again.
 * The canvas stops rendering while the overview is away.
 *
 * Every click or tap sends a pulse along the band, as every key typed into rhine-lock's password field
 * does (Stage.pulse, with rhine-lock's origin): a swell runs out from the crossing, the fins turning,
 * growing and glowing lime as it passes. Pressing a window sends one as it starts to open its page;
 * the press comes before the click, so the pulse leads the zoom. Only while the overview is on screen,
 * and not with reduced motion.
 */
export default function Scene(props: SceneProps) {
  const { offset, zoom } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const live = useRef(props);
  live.current = props;
  const quality = qualityFor(props.compact);
  const [ready, setReady] = useState(false);

  const awakeNow = () => live.current.zoom != null || Math.abs(live.current.offset.get()) < GONE_AT;
  const awakeRef = useRef<boolean | null>(null);
  awakeRef.current ??= awakeNow();
  const [awake, setAwake] = useState(awakeRef.current);
  const sync = useCallback(() => {
    const on = awakeNow();
    stageRef.current?.setRunning(on);
    if (!on) anchorBus.visible = false; // the scene stops updating it once its frame loop stops
    if (on === awakeRef.current) return;
    awakeRef.current = on;
    // the offset can change while App renders: never set state in the middle of that
    queueMicrotask(() => setAwake(on));
  }, []);
  useMotionValueEvent(offset, "change", sync);
  useEffect(sync, [zoom, sync]);

  // While pages slide, the canvas fades with the overview; during a window zoom it stays put (the ∞
  // peels apart or draws itself in instead).
  const opacity = useTransform(() => {
    const o = offset.get();
    return zoom ? 1 : presence(o);
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement("canvas");
    host.appendChild(canvas);
    let stage: Stage;
    try {
      stage = new Stage(canvas, quality, environmentUrl);
    } catch (err) {
      console.error("The 3D scene needs WebGL 2:", err);
      canvas.remove();
      return;
    }
    stageRef.current = stage;
    if (import.meta.env.DEV) (window as unknown as { __stage: Stage }).__stage = stage; // for inspection
    const { still, reduceMotion } = live.current;
    stage.timeScale = reduceMotion ? 0.25 : 1;

    const S = {
      zoomId: -1,
      fired: new Set<string>(),
      // the first time the overview shows, the band draws itself in (once the light probe is there)
      intro: !still && !reduceMotion && Math.abs(live.current.offset.get()) < 0.05,
      env: false,
      shown: false,
      verify: 0,
      pointer: { x: 0.5, y: 0.5 },
    };
    if (S.intro) stage.hideBand();
    else stage.setAssembled();
    stage.ready.then(() => (S.env = true));

    stage.onFrame = (dt) => {
      const { offset, zoom: z, zt, compact } = live.current;
      const o = offset.get();
      const t = zt.get();
      const once = (name: string, fn: () => void) => {
        if (!S.fired.has(name)) {
          S.fired.add(name);
          fn();
        }
      };

      // The window zoom: unlock (the fins peel off) or lock again (the band draws itself in)
      if (z && z.id !== S.zoomId) {
        S.zoomId = z.id;
        S.fired.clear();
        S.intro = false;
        if (z.dir === "close") stage.hideBand();
      }
      if (z?.dir === "open" && t >= 220) once("dissolve", () => stage.playDissolve(800));
      if (z?.dir === "close" && t >= 120) once("assemble", () => stage.playAssemble(1900));

      if (S.intro) {
        if (z || Math.abs(o) > 0.05) S.intro = false;
        else if (S.env && stage.stats.frames >= 4) {
          stage.playAssemble(1700);
          S.intro = false;
        }
      } else if (!z && !stage.settled && !stage.busy) {
        stage.setAssembled(); // back by scrolling (the log): it's simply there, as before
      }

      // rhine-lock's "granted" moment: the rims flash orange as the page opens, then the fins let go
      const exit = z?.dir === "open" ? smooth(180, 600, t) : 0;
      S.verify = follow(S.verify, z?.dir === "open" ? 1 : 0, 6, dt) * (1 - exit);
      stage.targets.verify = S.verify;
      // damped parallax; the picture is mirrored, so is the pointer
      stage.targets.parallaxX = follow(stage.targets.parallaxX, -(S.pointer.x - 0.5) * 2, 3, dt);
      stage.targets.parallaxY = follow(stage.targets.parallaxY, (S.pointer.y - 0.5) * 2, 3, dt);

      // Where it sits; while pages slide it moves with the overview (up when the overview is above)
      const vw = window.innerWidth, vh = window.innerHeight;
      const frame = overviewFrame(vw, vh, compact);
      if (!z) frame.y += Math.max(-1, Math.min(1, o)) * PAGE_SLIDE * vh;
      stage.frame = frame;

      // Screen positions of the band points the overview's leader lines run to
      anchorBus.visible = z != null || Math.abs(o) < 0.98;
      if (anchorBus.visible) {
        ANCHORS.forEach(({ u }, j) => {
          const p = stage.project(u);
          anchorBus.xy[2 * j] = p.x;
          anchorBus.xy[2 * j + 1] = p.y;
          anchorBus.drawn[j] = stage.drawn(u);
        });
      }

      if (!S.shown && stage.stats.frames >= 2) {
        S.shown = true;
        setReady(true);
      }
    };

    const onPointer = (e: PointerEvent) => {
      S.pointer.x = e.clientX / window.innerWidth;
      S.pointer.y = e.clientY / window.innerHeight;
    };
    // rhine-lock's keystroke pulse, on every click or tap (see the comment above Scene)
    const pulse = () => {
      if (awakeRef.current && !live.current.reduceMotion) stage.pulse(0.25 + Math.random() * 0.1);
    };
    const onPress = (e: PointerEvent) => {
      if (e.isPrimary && e.button === 0) pulse(); // not a second finger, a right or a middle click
    };
    // Enter or Space on a focused window or button clicks it without a press (detail 0). So does a label
    // passing a click on to its checkbox, straight after its own click: that one is skipped.
    let clickedAt = -1e9;
    const onClick = (e: MouseEvent) => {
      if (e.detail > 0) clickedAt = e.timeStamp;
      else if (e.timeStamp - clickedAt > 100) pulse();
    };
    window.addEventListener("pointermove", onPointer);
    window.addEventListener("pointerdown", onPress, { capture: true, passive: true });
    window.addEventListener("click", onClick, { capture: true, passive: true });
    stage.setRunning(awakeNow());
    return () => {
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPress, { capture: true });
      window.removeEventListener("click", onClick, { capture: true });
      stage.dispose();
      canvas.remove();
      stageRef.current = null;
      anchorBus.visible = false;
    };
  }, [quality]);

  return (
    <div className={`scene${ready ? " is-ready" : ""}`} aria-hidden="true">
      <motion.div ref={hostRef} className="scene-fade" style={{ opacity, visibility: awake ? "visible" : "hidden" }} />
    </div>
  );
}
