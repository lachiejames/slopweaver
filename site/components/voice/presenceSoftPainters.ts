/**
 * The soft presences: mist, ink and embers — none with an edge, each a few rounds of grey light falling to nothing.
 *
 * Mist is two clouds breathing round a core, the owner's on the left swelling while they speak and the voice's on the
 * right while it does. Ink blooms in water and fades, each bloom spreading out from the middle while the voice speaks
 * and drawing in while the owner does. Embers are sparks rising from under the orb and going out as they climb, the
 * owner's and the voice's struck apart (`lib/presenceEmbers.ts`). Under reduce-motion ink and embers hold the blooms and sparks they
 * have, and every one of the three still grows and brightens with the level.
 *
 * Painters for `presencePainters.ts`; the shared kit is `presencePainter.ts`.
 */
import { EMBER_LIFE_S, type EmberSpark, emberAfter, emberEmissionOf } from "../../lib/presenceEmbers";
import { PRESENCE_BUDGETS, type PresenceVoiceInput, withNewest } from "../../lib/presenceInput";
import {
  BOT_GREY,
  flowSignOf,
  greyOf,
  greySpot,
  OWNER_GREY,
  type PresencePainter,
  presenceLightOf,
  REST_GREY,
  seeded,
  wander,
} from "./presencePainter";

/**
 * Mist: two soft clouds breathing out of step, a core between them, and a smaller cloud circling while it thinks.
 *
 * @returns the painter
 */
export function makeMistPainter(): PresencePainter {
  return (frame) => {
    const { ctx, w, h, box, clockS: t, voice } = frame;
    const cx = w / 2;
    const cy = h / 2;
    const light = presenceLightOf({ level: frame.level });
    const breath = 0.5 + 0.5 * Math.sin(t * 0.9);
    const swell = 1 + frame.moveLevel * 0.25;
    ctx.globalCompositeOperation = "lighter";
    greySpot({
      alpha: (0.3 + voice.mic * 0.45) * light,
      ctx,
      grey: OWNER_GREY,
      r: box * (0.24 + voice.mic * 0.12 + breath * 0.02) * swell,
      x: cx - box * 0.06 + wander({ seed: 1, x: t * 0.4 }) * box * 0.1,
      y: cy + wander({ seed: 2, x: t * 0.35 }) * box * 0.08,
    });
    greySpot({
      alpha: (0.3 + voice.output * 0.45) * light,
      ctx,
      grey: BOT_GREY,
      r: box * (0.24 + voice.output * 0.12 + (1 - breath) * 0.02) * swell,
      x: cx + box * 0.06 + wander({ seed: 3, x: t * 0.33 }) * box * 0.1,
      y: cy + wander({ seed: 4, x: t * 0.45 }) * box * 0.08,
    });
    if (voice.turn === "thinking") {
      greySpot({
        alpha: 0.3 * light,
        ctx,
        grey: REST_GREY,
        r: box * 0.16,
        x: cx + Math.sin(t * 2) * box * 0.1,
        y: cy + Math.cos(t * 2) * box * 0.1,
      });
    }
    const active = Math.max(voice.mic, voice.output);
    greySpot({
      alpha: (0.1 + active * 0.3) * light,
      ctx,
      grey: 0.7,
      r: box * (0.09 + active * 0.08) * swell,
      x: cx,
      y: cy,
    });
    ctx.globalCompositeOperation = "source-over";
  };
}

/** One ink bloom: where it opened, in shares of the orb from its middle, how far through its life, and its grey. */
interface Bloom {
  readonly dx: number;
  readonly dy: number;
  readonly age: number;
  readonly size: number;
  readonly grey: number;
  /** Which way it spreads: out while the voice spoke it, in while the owner did, still in quiet. */
  readonly flow: number;
}

/** How long a bloom lives, seconds. */
const BLOOM_LIFE_S = 2.6;

/**
 * Ink: blooms opening in water near the middle and fading as they spread, more of them and bigger as a voice rises.
 *
 * @returns the painter
 */
export function makeInkPainter(): PresencePainter {
  const rand = seeded({ seed: 2 });
  const opened = (): Pick<Bloom, "dx" | "dy"> => ({ dx: (rand() - 0.5) * 0.36, dy: (rand() - 0.5) * 0.3 });
  // A few blooms already open, so the first frame — and a still one under reduce-motion — is never empty.
  let blooms: readonly Bloom[] = [0.15, 0.35, 0.55, 0.75].map((age) => ({
    ...opened(),
    age,
    flow: 0,
    grey: REST_GREY,
    size: 0.6,
  }));
  let carry = 0;
  return (frame) => {
    const { ctx, w, h, box, dtS, moving, voice } = frame;
    const active = Math.max(voice.mic, voice.output);
    if (moving) {
      const cap = PRESENCE_BUDGETS[frame.detail].inkBlooms;
      carry += (0.3 + active * 9) * dtS;
      while (carry >= 1) {
        carry -= 1;
        const bloom: Bloom = {
          ...opened(),
          age: 0,
          flow: flowSignOf({ voice }),
          grey: greyOf({ voice }),
          size: 0.4 + active,
        };
        blooms = withNewest({ cap, item: bloom, items: blooms });
      }
      blooms = blooms
        .map((bloom) => ({ ...bloom, age: bloom.age + dtS / BLOOM_LIFE_S }))
        .filter((bloom) => bloom.age < 1);
    }
    const light = presenceLightOf({ level: frame.level });
    const swell = 1 + frame.moveLevel * 0.3;
    ctx.globalCompositeOperation = "lighter";
    for (const bloom of blooms) {
      const reach = 1 + bloom.flow * bloom.age * 0.6;
      greySpot({
        alpha: (1 - bloom.age) ** 2 * 0.5 * light,
        ctx,
        grey: bloom.grey,
        r: (0.03 + bloom.age * 0.26) * bloom.size * box * swell,
        x: w / 2 + bloom.dx * box * reach + bloom.age * 0.02 * box,
        y: h / 2 + bloom.dy * box * reach - bloom.age * 0.04 * box,
      });
    }
    ctx.globalCompositeOperation = "source-over";
  };
}

/** The owner's sparks and the voice's, each its own stream: which turn it stands for, and how loud that voice is. */
const EMBER_STREAMS = [
  { level: (voice: PresenceVoiceInput): number => voice.mic, turn: "owner" },
  { level: (voice: PresenceVoiceInput): number => voice.output, turn: "bot" },
] as const;

/**
 * Embers: sparks struck under the orb and rising through it, going out as they climb. The owner's and the voice's are struck
 * apart, more of them and quicker the louder each is; the voice's lean out from the middle and the owner's lean in.
 *
 * @returns the painter
 */
export function makeEmbersPainter(): PresencePainter {
  const rand = seeded({ seed: 5 });
  const struck = ({ lean, lift, grey }: { lean: number; lift: number; grey: number }): EmberSpark => {
    const xShare = (rand() - 0.5) * 0.4;
    return {
      ageS: 0,
      grey,
      radiusShare: 0.012 + rand() * 0.012,
      swayPhase: rand() * Math.PI * 2,
      vxShareS: (rand() - 0.5) * 0.06 + Math.sign(xShare) * lean * 0.06,
      vyShareS: -(0.12 + rand() * 0.3 + lift * 0.3),
      xShare,
      yShare: 0.48,
    };
  };
  // A few already rising, the owner's and the voice's in turn, so the first frame — and a still one under reduce-motion — is
  // never empty.
  let sparks: readonly EmberSpark[] = Array.from({ length: 12 }, (_, index) => {
    const spark = struck({ grey: index % 2 === 0 ? OWNER_GREY : BOT_GREY, lean: 0, lift: 0 });
    const ageS = (index / 12) * EMBER_LIFE_S * 0.8;
    return { ...spark, ageS, yShare: spark.yShare + spark.vyShareS * ageS };
  });
  const carries = { bot: 0, owner: 0 };
  return (frame) => {
    const { ctx, w, h, box, dtS, moving, voice } = frame;
    const cap = PRESENCE_BUDGETS[frame.detail].emberSparks;
    for (const stream of EMBER_STREAMS) {
      const own: PresenceVoiceInput = { ...voice, turn: stream.turn };
      const level = stream.level(voice);
      const emission = emberEmissionOf({ carry: carries[stream.turn], dtS, level, moving });
      carries[stream.turn] = emission.carry;
      for (let k = 0; k < emission.count; k += 1) {
        const item = struck({ grey: greyOf({ voice: own }), lean: flowSignOf({ voice: own }), lift: level });
        sparks = withNewest({ cap, item, items: sparks });
      }
    }
    if (moving) {
      sparks = sparks.map((spark) => emberAfter({ dtS, moving, spark })).filter((spark) => spark.ageS < EMBER_LIFE_S);
    }
    const light = presenceLightOf({ level: frame.level });
    const swell = 1 + frame.moveLevel * 0.25;
    ctx.globalCompositeOperation = "lighter";
    for (const spark of sparks) {
      const life = 1 - spark.ageS / EMBER_LIFE_S;
      const sway = Math.sin(spark.ageS * 3 + spark.swayPhase) * 0.02;
      greySpot({
        alpha: life * 0.8 * light,
        ctx,
        grey: spark.grey,
        r: spark.radiusShare * (0.5 + life) * box * swell,
        x: w / 2 + (spark.xShare + sway) * box,
        y: h / 2 + spark.yShare * box,
      });
    }
    ctx.globalCompositeOperation = "source-over";
  };
}
