/**
 * The orb's presences: what happens inside the orb, chosen on its own and kept apart from the theme.
 *
 * A presence tab dictates what happens inside the orb and applies live, as the appearance tab does. The presence and
 * the theme are decoupled: the presence choice sticks and the theme supplies its colours, with six options for each.
 *
 * So a presence is a shape and a motion only. Every one is drawn as grey light and coloured by the theme's ramp
 * (`./orbRamp.ts`), so any presence under any theme is already a pairing that holds together. The painters are
 * `components/voice/presencePainters.ts`; the Settings tab is `components/console/PresencePresets.tsx`.
 *
 * Pure, and imports nothing at run time.
 */

/** Every presence's id, in the order the Settings tab shows them. */
export const PRESENCE_IDS = ["star-cluster", "mist", "ink", "dot-matrix", "aurora", "embers"] as const;

/** One of {@link PRESENCE_IDS}. */
export type PresenceId = (typeof PRESENCE_IDS)[number];

/** One presence: its id and its name under its tile. */
export interface OrbPresence {
  readonly id: PresenceId;
  readonly name: string;
}

/**
 * The presences, in tile order: the star cluster's twinkling points, mist's two breathing clouds, ink blooming and
 * fading in water, a dot matrix rippling from its middle, aurora curtains swaying, and embers rising from below. The
 * sixth is the owner's pick off the gallery.
 */
export const ORB_PRESENCES: readonly OrbPresence[] = [
  { id: "star-cluster", name: "Star cluster" },
  { id: "mist", name: "Mist" },
  { id: "ink", name: "Ink" },
  { id: "dot-matrix", name: "Dot matrix" },
  { id: "aurora", name: "Aurora" },
  { id: "embers", name: "Embers" },
];

/**
 * The presence a first call wears, before the owner has picked one: the star cluster, which reads as mesmerizing on
 * black.
 */
export const DEFAULT_PRESENCE: PresenceId = "star-cluster";

/** Where the owner's pick of presence is kept, in this browser, so the next launch wears it. */
export const PRESENCE_STORAGE_KEY = "slopweaver.talk.presence.v1";

/**
 * Whether a value is a presence.
 *
 * @returns true for a name in {@link PRESENCE_IDS}
 */
export function isPresenceId(value: unknown): value is PresenceId {
  return PRESENCE_IDS.some((id) => id === value);
}

/**
 * A presence by id.
 *
 * @returns the presence, or `undefined` for an id that names none
 */
export function presenceOf({ id }: { id: string }): OrbPresence | undefined {
  return ORB_PRESENCES.find((presence) => presence.id === id);
}
