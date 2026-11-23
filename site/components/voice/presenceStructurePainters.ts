/**
 * The structured presences: aurora and the dot matrix.
 *
 * Aurora is curtains of light hanging across the orb, swaying, the owner's voice lengthening and brightening the left ones
 * and the voice's own the right. The dot matrix is a fixed round grid of points, each lit by one of ten bands from its
 * middle (low notes at the heart, high at the rim), a slow ripple running out through it while the voice speaks and in
 * while the owner does. Each works to its detail's budget (`PRESENCE_BUDGETS`, `site/lib/presenceInput.ts`): fewer curtains
 * and a coarser grid in the corner.
 *
 * Painters for `presencePainters.ts`; the shared kit is `presencePainter.ts`.
 */
import { PRESENCE_BUDGETS } from "../../lib/presenceInput";
import {
  BOT_GREY,
  flowSignOf,
  greyCss,
  greyOf,
  OWNER_GREY,
  type PresencePainter,
  presenceLightOf,
  wander,
} from "./presencePainter";

/** How wide the curtains hang, as a share of the orb. */
const AURORA_SPAN = 1.2;

/**
 * Aurora: soft vertical curtains, each a gradient from nothing to its brightest and back, drawn twice — a wide faint
 * pass under a narrow one — where a blur would have spread it.
 *
 * @returns the painter
 */
export function makeAuroraPainter(): PresencePainter {
  return (frame) => {
    const { ctx, w, h, box, clockS, voice } = frame;
    const columns = PRESENCE_BUDGETS[frame.detail].auroraColumns;
    let t = clockS;
    if (voice.turn === "thinking") {
      // Work in flight shimmers the curtains a little quicker.
      t = clockS * 1.6;
    }
    const cx = w / 2;
    const top = h / 2 - box * 0.5;
    const span = box * AURORA_SPAN;
    const columnWidth = span / columns;
    const light = presenceLightOf({ level: frame.level });
    const reach = 1 + frame.moveLevel * 0.2;
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < columns; i += 1) {
      const u = i / (columns - 1);
      // The owner's voice sways the left curtains, the voice's own the right.
      const level = voice.mic * (1 - u) + voice.output * u;
      const envelope = 0.25 + 0.75 * Math.sin(Math.PI * u);
      const grey = OWNER_GREY + (BOT_GREY - OWNER_GREY) * u;
      const sway = wander({ seed: i * 0.7, x: t * 0.5 + u * 3 }) * box * 0.05;
      const length = box * (0.45 + 0.15 * (wander({ seed: i, x: t * 0.3 }) + 1) * 0.5 + level * 0.35) * reach;
      const x = cx + (u - 0.5) * span + sway;
      const alpha = (0.16 + level * 0.45) * envelope * light;
      for (const [width, share] of [
        [2.4, 0.35],
        [1.2, 1],
      ] as const) {
        const g = ctx.createLinearGradient(0, top, 0, top + length);
        g.addColorStop(0, greyCss({ alpha: 0, grey }));
        g.addColorStop(0.3, greyCss({ alpha: alpha * share, grey }));
        g.addColorStop(1, greyCss({ alpha: 0, grey }));
        ctx.fillStyle = g;
        ctx.fillRect(x - (columnWidth * width) / 2, top, columnWidth * width, length);
      }
    }
    ctx.globalCompositeOperation = "source-over";
  };
}

/** How many brightness steps the grid batches its points into: one path, and one fill, per step. */
const DOT_STEPS = 8;

/** The grid's radius, as a share of the orb. */
const DOT_REACH = 0.6;

/**
 * The dot matrix: a round grid of points lit from the middle outward by the voice's bands, batched into one path per
 * brightness step rather than a fill per point.
 *
 * @returns the painter
 */
export function makeDotMatrixPainter(): PresencePainter {
  return (frame) => {
    const { ctx, w, h, box, clockS, voice } = frame;
    const n = PRESENCE_BUDGETS[frame.detail].dotGrid;
    const radius = box * DOT_REACH;
    const spacing = (radius * 2) / (n - 1);
    const cx = w / 2;
    const cy = h / 2;
    const flow = flowSignOf({ voice });
    // A ripple runs out from the middle while the voice speaks, in toward it while the owner does, and pulses evenly at rest.
    let depth = 0.12;
    if (flow === 0) {
      depth = 0.06;
    }
    const light = presenceLightOf({ level: frame.level });
    const grow = 1 + frame.moveLevel * 0.2;
    const paths = Array.from({ length: DOT_STEPS }, () => new Path2D());
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        const x = cx + (i / (n - 1) - 0.5) * radius * 2;
        const y = cy + (j / (n - 1) - 0.5) * radius * 2;
        const share = Math.hypot(x - cx, y - cy) / radius;
        if (share > 1.02) {
          continue;
        }
        // Low notes at the heart, high at the rim.
        const band = Math.min(voice.bands.length - 1, Math.floor(share * voice.bands.length));
        const level = voice.bands.at(band)!;
        const ripple = 0.5 + 0.5 * Math.sin(clockS * 1.6 - flow * share * 5);
        const bright = Math.min(1, Math.max(0, 0.12 + level * 0.85 + ripple * depth)) * light;
        const step = Math.min(DOT_STEPS - 1, Math.floor(bright * DOT_STEPS));
        const dot = spacing * (0.16 + level * 0.24) * grow;
        const path = paths.at(step)!;
        path.moveTo(x + dot, y);
        path.arc(x, y, dot, 0, Math.PI * 2);
      }
    }
    const grey = greyOf({ voice });
    ctx.globalCompositeOperation = "lighter";
    paths.forEach((path, step) => {
      ctx.fillStyle = greyCss({ alpha: (step + 0.5) / DOT_STEPS, grey });
      ctx.fill(path);
    });
    ctx.globalCompositeOperation = "source-over";
  };
}
