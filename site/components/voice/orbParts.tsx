/**
 * The pieces both of the voice's views draw the same way: the disc the orb sits on, the glyph each piece of work
 * wears, Slack's mark, the running list's unread dot, and the words on the nudge. The corner orb (`VoiceWidget.tsx`) and the stage (`VoiceStage.tsx`) read them from here
 * so the two never say a thing differently.
 */
import type { ReactElement } from "react";

import type { OrbBadge } from "../../lib/orbMood";
import type { NudgeOffer } from "../../lib/voiceActivity";
import {
  backingIsPressable,
  DEFAULT_ORB_BACKING_OPACITY,
  type OrbBacking,
  type OrbBackingOpacity,
} from "../../lib/voiceStage";

/**
 * Each mood's colour, as `--v-ring`, keyed off a `data-mood` on the element wearing it: the corner's widget and the
 * stage both carry it, so a mood is the same colour in either view. With no call up the orb wears the console's own
 * colour, the idle mood's, a little dimmed by the widget: slate grey under a microphone was the old talk button.
 * Hearing the owner is sky blue and the voice speaking is fuchsia, well apart on the wheel, so the states are clearly
 * distinct for whether the owner is talking or the voice is; writing sits further round so it does not read as the
 * owner. Speaking sits between thinking's violet and relaying's pink, the two the owner likes, and off green, which
 * reads badly on the neon look. Stopped for the owner is hearing's blue lit almost white — a flash of attention
 * that cools into hearing as the colour eases.
 */
export const MOOD_RING =
  "[--v-ring:var(--c-primary)] data-[mood=browsing]:[--v-ring:oklch(0.8_0.14_125)] data-[mood=code]:[--v-ring:oklch(0.66_0.17_265)] data-[mood=connecting]:[--v-ring:oklch(0.78_0.12_85)] data-[mood=error]:[--v-ring:oklch(0.68_0.18_25)] data-[mood=hearing]:[--v-ring:oklch(0.82_0.12_215)] data-[mood=idle]:[--v-ring:var(--c-primary)] data-[mood=looking]:[--v-ring:oklch(0.86_0.16_95)] data-[mood=recalling]:[--v-ring:oklch(0.74_0.13_50)] data-[mood=reconnecting]:[--v-ring:oklch(0.62_0.05_265)] data-[mood=relaying]:[--v-ring:oklch(0.75_0.17_10)] data-[mood=slack]:[--v-ring:oklch(0.62_0.19_340)] data-[mood=speaking]:[--v-ring:oklch(0.77_0.17_325)] data-[mood=stalled]:[--v-ring:oklch(0.78_0.14_70)] data-[mood=thinking]:[--v-ring:oklch(0.72_0.15_295)] data-[mood=working]:[--v-ring:oklch(0.72_0.14_290)] data-[mood=writing]:[--v-ring:oklch(0.78_0.12_250)] data-[mood=yielded]:[--v-ring:oklch(0.93_0.08_200)]";

/**
 * The disc the orb sits on in the corner. Without it the small view reads as a squiggly line rather than an orb, so
 * it makes the boundaries very clear: a dark background, crisp, the orb spilling out of it a little, since its
 * colours were picked on black. So it is near-black and solid, one hairline rim of the mood's colour, no
 * glass, highlight or shadow — never a glyph on it, which would be the old talk button again — and it reaches about
 * the star cluster's resting edge (`FIELD_SCALE`, `swarmPainter.ts`), so a loud swell spills just past it onto whatever is
 * behind, the presence's empty space being clear. No backdrop blur: over the owner's desktop the overlay window is transparent
 * and there is nothing behind it to blur.
 *
 * **Its edge is the orb's clickable edge.** With the orb always on top of another app, an unclear boundary invites a
 * misclick, so the disc's edge is the target's edge. The disc reaches a
 * little past the orb's button, so where it stands it takes the pointer itself and its press reaches the button it
 * sits in — the desktop overlay's hit-test (`desktop/src/preload.ts`) finds it inside the orb's marked box — and a
 * click just outside the line still falls through to the owner's app. The stage's, never seen at rest, takes nothing.
 *
 * Both views draw it inside the layer that flies (`useOrbFlight.ts`), so it travels and scales with the orb: the
 * corner's stands, and gathers in as that orb lands from the stage; the stage's rests at nothing, so the enlarged
 * view is untouched, and leaves as that orb grows out of the corner (`backdropFadeOf`, `site/lib/orbFlight.ts`). While
 * the corner's lands it takes nothing either: it is laid over the stage orb's old place then, so the second click of
 * the double-click that closed the stage would land on it and open the stage again.
 *
 * **What it is drawn as is stored** (a solid disc can look like plastic, so `ORB_BACKINGS`,
 * `site/lib/voiceStage.ts`, offers others): the dark disc, one hairline ring, only a glow of the mood's colour with no edge, or
 * nothing. Every theme in the Settings modal wears the dark disc (`site/lib/themePresets.ts`), and each theme's preview
 * draws its corner on this same backdrop, so a preview is the corner exactly.
 * Every one is the same span that flies and fades; one the owner cannot see takes no pointer (`backingIsPressable`),
 * so with nothing behind it the orb's own button is the whole target and nothing invisible sits in the owner's app's
 * way. The glow
 * stays inside the disc's reach, so the corner window's margin never cuts it off.
 *
 * **How strongly it is drawn is stored too** (a background opacity setting, `ORB_BACKING_OPACITIES`): the whole
 * backing, rim and shadow with it, at that share. All the way down it is one the owner cannot see, so it takes no
 * pointer either.
 *
 * @param shown true where it stands (the corner), false where it only shows in flight (the stage)
 * @param pressable whether it takes the pointer now: the standing corner disc, never one in flight
 * @param backing which backing the owner picked
 * @param opacity how strongly the owner has it drawn, a percentage; full when not given
 * @returns the disc
 */
export function OrbBackdrop({
  shown,
  pressable,
  backing,
  opacity = DEFAULT_ORB_BACKING_OPACITY,
}: {
  shown: boolean;
  pressable: boolean;
  backing: OrbBacking;
  opacity?: OrbBackingOpacity;
}): ReactElement {
  const takes = pressable && backingIsPressable({ backing, opacity });
  let strength = 0;
  if (shown) {
    strength = Number(opacity) / 100;
  }
  return (
    <span
      aria-hidden="true"
      data-orb-backdrop=""
      data-backing={backing}
      data-backing-opacity={opacity}
      className={`absolute -inset-[12%] rounded-full ${BACKING_LOOK[backing]} transition-[border-color,background-color,opacity] duration-700 ${takes ? "pointer-events-auto" : "pointer-events-none"}`}
      style={{ opacity: strength }}
    />
  );
}

/** Each backing's drawing; every one is a round span of the same reach. */
const BACKING_LOOK: Readonly<Record<OrbBacking, string>> = {
  disc: "border border-solid border-[color-mix(in_oklch,var(--v-ring)_28%,oklch(1_0_0/14%))] bg-[oklch(0.11_0.008_265)]",
  glow: "bg-[radial-gradient(circle,color-mix(in_oklch,var(--v-ring)_24%,transparent)_0%,color-mix(in_oklch,var(--v-ring)_10%,transparent)_52%,transparent_71%)]",
  none: "",
  ring: "border border-solid border-[color-mix(in_oklch,var(--v-ring)_55%,transparent)]",
};

/** What each badge shows. The Slack mark is drawn; everything else is one emoji. */
export const BADGE_GLYPHS: Readonly<Record<Exclude<OrbBadge, "slack">, string>> = {
  browsing: "🌐",
  code: "💻",
  error: "⚠️",
  looking: "👀",
  recalling: "🔎",
  relaying: "📨",
  stalled: "💤",
  thinking: "💭",
  working: "⚙️",
  writing: "✍️",
};

/**
 * A badge's glyph: Slack's mark for Slack, the emoji for everything else.
 *
 * @param size the mark's Tailwind size class, since an emoji takes its size from the text around it
 * @returns the glyph
 */
export function BadgeGlyph({ badge, size }: { badge: OrbBadge; size: string }): ReactElement {
  if (badge === "slack") {
    return <SlackMark size={size} />;
  }
  return <>{BADGE_GLYPHS[badge]}</>;
}

/**
 * Slack's four-colour mark, drawn as the pinwheel of rounded bars it is made of.
 *
 * @param size its Tailwind size class
 * @returns the mark
 */
export function SlackMark({ size }: { size: string }): ReactElement {
  return (
    <svg viewBox="0 0 24 24" className={size}>
      <rect x="8" y="2" width="3.6" height="10" rx="1.8" fill="#36C5F0" />
      <rect x="12" y="8" width="10" height="3.6" rx="1.8" fill="#2EB67D" />
      <rect x="12.4" y="12" width="3.6" height="10" rx="1.8" fill="#ECB22E" />
      <rect x="2" y="12.4" width="10" height="3.6" rx="1.8" fill="#E01E5A" />
    </svg>
  );
}

/**
 * The running list's unread dot: the voice or the fleet left the owner something they have not opened the list on since. Worn
 * at the top right of whatever opens the list — its button on the call card, and the orb while the card is not up —
 * and never for the owner's own adds (`site/lib/runningListDraw.ts`'s `runningListUnread`).
 */
export const UNREAD_DOT =
  "pointer-events-none absolute top-0 right-0 size-[0.55rem] rounded-full border border-solid border-(--c-card) bg-primary";

/** What each nudge says, and what its title says it does. */
export const NUDGE_COPY: Readonly<Record<NudgeOffer, { readonly label: string; readonly title: string }>> = {
  ask: {
    label: "nudge it to answer",
    title: "the turn is the voice's; it takes it from what you last said, once",
  },
  interrupt: {
    label: "stop Codex and ask it to answer",
    title: "the Codex turn has gone quiet; it is stopped, and the voice answers what you last said, once",
  },
};
