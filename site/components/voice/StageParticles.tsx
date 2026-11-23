"use client";

/**
 * The orb's canvas: one presence drawn as grey light, coloured by the theme's ramp. It is the orb of both the stage and
 * the corner, and of every Settings preview.
 *
 * **The presence and the theme are apart**: the presence choice sticks and the theme supplies
 * its colours. The nearest `data-presence` names what fills the orb (`site/lib/orbPresence.ts`); its painter
 * (`presencePainters.ts`) draws only grey light, additively, never a hue. The theme's two ramp colours arrive as the
 * inherited custom properties `--sw-orb-ramp-dark` and `--sw-orb-ramp-light` (`site/lib/orbRamp.ts`), read off this
 * canvas's own computed style, so a theme worn on the page, or a preview tile's own, recolours whatever presence is
 * drawn. A change of presence drops the old painter's state whole and starts a fresh one.
 *
 * **Its colour is a gradient map**: the canvas wears an SVG filter that lays the frame on black, reads each pixel's
 * brightness, scaled by who is talking (`rampGainOf`), and maps it through black → the ramp's dark colour → its light
 * colour → white — or, over a light ground (`orbGroundOf`), from its light colour deepening to its dark one, with no
 * black or white in it; the same brightness, before the ramp, becomes the opacity, so the empty space around the light
 * is clear and the presence sits on its disc and spills a little past it. The loop eases the gain, the pair and the
 * ground, and writes them onto the filter only when they move.
 *
 * **It reads the same three numbers every presence reads** (`orbTuning`, `site/lib/voiceStage.ts`): `--pace` runs the
 * presence's clock, `--move-lvl` swells it and `--lvl` lights it, both eased here at the ElevenLabs follower's pace. The
 * mood comes off the nearest `data-mood`, and who is talking is read back off it (`presenceVoiceInputOf`). The nearest
 * `data-detail` says how much work a presence may do — `refined` on the stage and the previews, `plain` in the corner
 * (`site/lib/swarmDetail.ts`); absent, it draws plain. The session re-renders about twelve times a second; this loop is
 * outside React, so nothing remounts.
 *
 * Under reduce-motion the clock stops and nothing travels: a presence takes the shape its mood asks for at once rather
 * than moving into it, and while the mood holds only the level's brightness and swell move.
 */
import { type ReactElement, useEffect, useId, useRef } from "react";

import {
  lightnessOf,
  lightnessToward,
  type RampChannels,
  rampChannels,
  rampGainOf,
  rampMatrix,
  rampOpacityMatrix,
  rampTable,
  rampToward,
} from "../../lib/orbRamp";
import { easeToward } from "../../lib/particleMotion";
import { PRESENCE_MAX_STEP_MS, shouldPaintPresenceFrame } from "../../lib/presenceFrame";
import { presencePixelRatio, presenceVoiceInputOf } from "../../lib/presenceInput";
import type { PresencePainter } from "./presencePainter";
import { makePresencePainter } from "./presencePainters";
import { type FrameInputs, inputsOf, moodOf } from "./stageParticleInputs";

/** How far past the orb's own box the canvas reaches, each side, as a share of the box: room for a presence to flow. */
const BLEED = 0.18;

/** The longest frame the loop steps, in seconds (`presenceFrame.ts` holds the cap the resting gate is bounded by). */
const MAX_FRAME_S = PRESENCE_MAX_STEP_MS / 1000;

/** How quickly the drawn level follows the measured one, per second: the ElevenLabs follower's pace. */
const LEVEL_RATE = 14;

/** How quickly the ramp's gain and colours ease toward their target, seconds: about the 0.7s a mood's colour took. */
const RAMP_EASE_S = 0.25;

/** What the loop carries from one frame to the next, apart from the painter's own state. */
interface CanvasState {
  /** The presence's clock, seconds, run at the mood's pace. */
  readonly clockS: number;
  readonly lvl: number;
  readonly moveLvl: number;
  /** The brightness gain its colour ramp is read at, eased toward who is talking (`rampGainOf`). */
  readonly gain: number;
  /** The ramp's two colours as drawn, eased toward the theme's. */
  readonly ramp: RampChannels;
  /** How far its table is toward the light ground's, eased toward the ground it is over (`lightnessOf`). */
  readonly lightness: number;
}

/** The colour-ramp filter's nodes the loop writes to: the brightness matrix and the three channels' tables. */
interface RampNodes {
  readonly matrix: SVGFEColorMatrixElement;
  readonly tables: readonly [SVGElement, SVGElement, SVGElement];
}

/**
 * The orb's presence, filling the square it is placed in and flowing a little past it, coloured through the theme's
 * ramp.
 *
 * @returns the canvas and the filter that colours it
 */
export function StageParticles(): ReactElement {
  // `useId` answers with characters a CSS `url(#…)` would have to escape; the filter's id needs none of them.
  const filterId = `orb-ramp-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const matrixRef = useRef<SVGFEColorMatrixElement>(null);
  const redRef = useRef<SVGFEFuncRElement>(null);
  const greenRef = useRef<SVGFEFuncGElement>(null);
  const blueRef = useRef<SVGFEFuncBElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const matrix = matrixRef.current;
    const red = redRef.current;
    const green = greenRef.current;
    const blue = blueRef.current;
    if (canvas === null || matrix === null || red === null || green === null || blue === null) {
      return undefined;
    }
    return runPresence({ canvas, nodes: { matrix, tables: [red, green, blue] } });
  }, []);
  return (
    <>
      {/* The ramp's values are the loop's to write, every one eased, so none is a prop React would put back. */}
      <svg aria-hidden="true" width="0" height="0" className="pointer-events-none absolute">
        <filter id={filterId} x="0" y="0" width="1" height="1" colorInterpolationFilters="sRGB">
          <feFlood floodColor="black" result="ground" />
          <feMerge>
            <feMergeNode in="ground" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
          <feColorMatrix ref={matrixRef} type="matrix" result="bright" />
          <feComponentTransfer in="bright" result="ramped">
            <feFuncR ref={redRef} type="table" />
            <feFuncG ref={greenRef} type="table" />
            <feFuncB ref={blueRef} type="table" />
          </feComponentTransfer>
          <feColorMatrix in="bright" type="matrix" values={rampOpacityMatrix()} result="mask" />
          <feComposite in="ramped" in2="mask" operator="in" />
        </filter>
      </svg>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute"
        // A canvas is a replaced element: `inset` alone does not stretch it, and its size would follow the pixel
        // buffer this loop grows by the pixel ratio every frame. So the size is stated.
        style={{
          filter: `url(#${filterId})`,
          height: `${String(100 + BLEED * 200)}%`,
          left: `-${String(BLEED * 100)}%`,
          top: `-${String(BLEED * 100)}%`,
          width: `${String(100 + BLEED * 200)}%`,
        }}
      />
    </>
  );
}

/** A ramp's gain and colours, over its ground, as the exact attribute values its filter takes. */
function rampAttributes({
  gain,
  ramp,
  lightness,
}: {
  gain: number;
  ramp: RampChannels;
  lightness: number;
}): readonly [string, string, string, string] {
  return [
    rampMatrix({ gain }),
    rampTable({ channel: 0, lightness, ramp }),
    rampTable({ channel: 1, lightness, ramp }),
    rampTable({ channel: 2, lightness, ramp }),
  ];
}

/** Write a ramp's attribute values onto its filter. */
function paintRamp({ nodes, values }: { nodes: RampNodes; values: readonly [string, string, string, string] }): void {
  const [matrix, red, green, blue] = values;
  nodes.matrix.setAttribute("values", matrix);
  nodes.tables[0].setAttribute("tableValues", red);
  nodes.tables[1].setAttribute("tableValues", green);
  nodes.tables[2].setAttribute("tableValues", blue);
}

/** Start the presence's frame loop on a canvas and its ramp; the answer stops it. */
function runPresence({ canvas, nodes }: { canvas: HTMLCanvasElement; nodes: RampNodes }): () => void {
  const style = getComputedStyle(canvas);
  const first = inputsOf({ canvas, style });
  // Painted at mount, before anything can stop the loop, so the filter never sits with empty tables: not while a
  // hidden canvas skips its frames, and not when the canvas has no 2D context to draw with at all.
  const firstValues = rampAttributes({
    gain: rampGainOf({ mood: first.mood }),
    lightness: lightnessOf({ ground: first.ground }),
    ramp: rampChannels({ ramp: first.ramp }),
  });
  paintRamp({ nodes, values: firstValues });
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    return () => undefined;
  }
  const still = window.matchMedia("(prefers-reduced-motion: reduce)");
  let state: CanvasState = {
    clockS: 0,
    gain: rampGainOf({ mood: first.mood }),
    lightness: lightnessOf({ ground: first.ground }),
    lvl: 0,
    moveLvl: 0,
    ramp: rampChannels({ ramp: first.ramp }),
  };
  let presence = first.presence;
  let painter: PresencePainter = makePresencePainter({ presence });
  let painted = firstValues.join("|");
  let last = performance.now();
  let frame = 0;
  let unpainted = true;
  const tick = (now: number): void => {
    frame = requestAnimationFrame(tick);
    // At rest the orb paints thirty times a second, not at the display's rate (`presenceFrame.ts` carries the
    // measurement). The mood is read every frame, an attribute and no style, so a call or a voice turning the
    // mood live paints on its first frame. A level rising inside a resting mood waits for the next resting paint,
    // at most a thirtieth of a second, since reading it means a style read. A skipped frame draws nothing, and the
    // clock steps from paint to paint.
    const due =
      unpainted ||
      shouldPaintPresenceFrame({
        elapsedMs: now - last,
        level: Math.max(state.lvl, state.moveLvl),
        mood: moodOf({ canvas }),
      });
    if (!due) {
      return;
    }
    unpainted = false;
    const dtS = Math.min(MAX_FRAME_S, Math.max(0, (now - last) / 1000));
    last = now;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) {
      return;
    }
    const ratio = presencePixelRatio({ device: window.devicePixelRatio });
    if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
    }
    const box = Math.min(w, h) / (1 + 2 * BLEED);
    const moving = !still.matches;
    const inputs = inputsOf({ canvas, style });
    if (inputs.presence !== presence) {
      presence = inputs.presence;
      painter = makePresencePainter({ presence });
    }
    state = advance({ dtS, inputs, moving, state });
    // Written only when it moves: an attribute set re-runs the filter, and a still orb's ramp sits still. Keyed on the
    // very strings written, so an easing ramp settles exactly on its theme's values rather than a rounding short.
    const values = rampAttributes({ gain: state.gain, lightness: state.lightness, ramp: state.ramp });
    const key = values.join("|");
    if (key !== painted) {
      painted = key;
      paintRamp({ nodes, values });
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    painter({
      box,
      clockS: state.clockS,
      ctx,
      detail: inputs.detail,
      dtS,
      h,
      level: state.lvl,
      mood: inputs.mood,
      moveLevel: state.moveLvl,
      moving,
      nowS: now / 1000,
      pace: inputs.pace,
      sim: inputs.sim,
      voice: presenceVoiceInputOf({ level: state.lvl, mood: inputs.mood }),
      w,
    });
  };
  frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
  };
}

/** One frame of what every presence shares: the clock run at the mood's pace, the levels followed, the ramp eased. */
function advance({
  state,
  inputs,
  dtS,
  moving,
}: {
  state: CanvasState;
  inputs: FrameInputs;
  dtS: number;
  moving: boolean;
}): CanvasState {
  let { clockS } = state;
  if (moving) {
    clockS += dtS / inputs.pace;
  }
  // Colour is not motion, so it eases under reduce-motion too; so does the level, which only brightens and swells.
  const rampShare = 1 - Math.exp(-dtS / RAMP_EASE_S);
  const targetGain = rampGainOf({ mood: inputs.mood });
  return {
    clockS,
    gain: state.gain + (targetGain - state.gain) * rampShare,
    lightness: lightnessToward({ from: state.lightness, ground: inputs.ground, share: rampShare }),
    lvl: easeToward({ current: state.lvl, dtS, rate: LEVEL_RATE, target: inputs.lvl }),
    moveLvl: easeToward({ current: state.moveLvl, dtS, rate: LEVEL_RATE, target: inputs.moveLvl }),
    ramp: rampToward({ from: state.ramp, share: rampShare, to: rampChannels({ ramp: inputs.ramp }) }),
  };
}
