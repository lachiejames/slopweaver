/**
 * The mint half of the voice's context pack: whether the file `talk pack --write` stored rides into a call,
 * and the block it becomes when it does. A missing, unparseable, future-dated or stale file is left out with
 * the reason, so a mint never waits on the pack and never speaks from a board older than the bound.
 *
 * Pure: the caller reads the file and passes the mint's instant.
 */

import { z } from "zod";
import { safeJsonParse } from "#lib/safeJson.js";

import { renderContextPack, type TalkContextPack } from "./contextPack.js";
import type { StoredLessons } from "./continuity.js";
import { storedPackProofsSchema } from "./packProofs.js";

/**
 * How old a pack may be and still ride into a call. The console server rebuilds it once it is half this old
 * (`site/lib/packKeeper.ts`), and the supervisor's sweep refreshes it too; an older one is left out rather than
 * spoken from, since "nothing is waiting on you" read off a stale board is the one answer worse than a slow one.
 */
export const PACK_MAX_AGE_MINUTES = 60;

/**
 * The largest stored pack a mint reads, and so the largest `talk pack --write` writes. A real one is a few hundred
 * KiB, its every passage cut and its sections budgeted at render; anything near this is a half nobody bounded.
 */
export const PACK_MAX_BYTES = 1024 * 1024;

/**
 * Why a pack of this size is not one a mint reads, or `undefined` when it is. The writer and the mint ask the same
 * question, so a pack can never be written that every call then leaves out.
 *
 * @param bytes the pack's UTF-8 size
 * @param path where it is, or would be, stored
 * @returns the left-out reason, or `undefined` within the bound
 */
export function packPastBound({ bytes, path }: { bytes: number; path: string }): string | undefined {
  if (bytes <= PACK_MAX_BYTES) {
    return undefined;
  }
  return `${path} is ${String(bytes)} bytes, past the ${String(PACK_MAX_BYTES)}-byte bound`;
}

const optionalString = z.string().optional();

/** The lessons the pack stores (`./continuity.ts` `StoredLessons`). */
const storedLessonsSchema = z.object({
  builtIso: z.string(),
  knowledge: z.array(
    z.object({ claim: z.string(), domain: z.string(), id: z.string(), recordedAtIso: z.string(), verdict: z.string() }),
  ),
  unread: z.array(z.object({ section: z.literal("knowledge"), why: z.string() })),
});

/**
 * One stored ask. The owner's words are `ownerWords`, or `hisWords` in a pack an older checkout wrote; a pack
 * declaring both on one ask is not a pack, rather than one spelling silently winning.
 */
const storedAskSchema = z
  .object({
    askedIso: optionalString,
    hisWords: z.array(z.string()).optional(),
    lean: optionalString,
    ownerWords: z.array(z.string()).optional(),
    // Optional, both: a pack stored before an ask carried its pull requests' words and proofs still rides in.
    prWords: z
      .array(z.object({ atIso: z.string(), identity: z.string(), rowSlug: z.string(), words: z.string() }))
      .optional(),
    priority: optionalString,
    proofs: storedPackProofsSchema.optional(),
    question: z.string(),
    slug: z.string(),
  })
  .refine((ask) => ask.ownerWords === undefined || ask.hisWords === undefined, {
    message: "an ask stores the owner's words under both ownerWords and hisWords",
  })
  .transform(({ hisWords, ownerWords, ...ask }) => {
    if (ownerWords === undefined) {
      return { ...ask, ownerWords: hisWords };
    }
    return { ...ask, ownerWords };
  });

/** The pack as `talk pack --write` stores it: a key JSON dropped for an `undefined` is optional here. */
const storedPackSchema = z.object({
  asks: z.array(storedAskSchema),
  boardObservedIso: optionalString,
  builtIso: z.string(),
  // Optional: a pack written before the voice walked the owner's check-ins still rides in, and says so.
  checkIns: z
    .array(
      z.object({
        acts: z.number(),
        cards: z.number(),
        did: optionalString,
        doneIso: z.string(),
        evidence: z.string(),
        key: z.string(),
        kind: z.string(),
        origin: optionalString,
        place: z.string(),
        reason: z.string(),
        tags: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  glossary: z.array(z.object({ means: z.string(), term: z.string() })),
  landings: z.array(z.object({ atIso: z.string(), sha: z.string(), subject: z.string() })),
  // Optional: a pack written before the lessons were stored on their own still rides in, its lessons unread.
  lessons: storedLessonsSchema.optional(),
  // Optional: a pack written before it carried the cards that left the owner's Queue still rides in, and says so.
  recentlyLeft: z
    .array(z.object({ about: optionalString, key: z.string(), removedIso: z.string(), why: z.string() }))
    .optional(),
  seats: z.array(
    z.object({
      directory: z.string(),
      lastAtIso: optionalString,
      lastMessage: optionalString,
      pinned: z.boolean(),
      ref: z.string(),
      title: optionalString,
    }),
  ),
  turns: z.array(z.object({ atIso: z.string(), text: z.string(), viaVoice: z.boolean() })),
  turnsSinceIso: optionalString,
  unread: z.array(
    z.object({
      section: z.enum(["asks", "seats", "turns", "landings", "checkIns", "recentlyLeft", "proofs"]),
      why: z.string(),
    }),
  ),
});

type StoredPack = z.infer<typeof storedPackSchema>;

/** What a mint does with the stored pack: rides it in, or says why not. */
export type PackAtMint =
  | {
      readonly kind: "embedded";
      readonly block: string;
      readonly builtIso: string;
      readonly ageMinutes: number;
      readonly bytes: number;
      /** The lessons the pack's read found — the one half of where the last call left off the mint takes from it. */
      readonly lessons: StoredLessons | undefined;
    }
  | { readonly kind: "left-out"; readonly why: string };

/**
 * Parse the stored file into a pack, or say why it is not one.
 *
 * @param text the stored file's contents
 * @returns the parsed pack, or the left-out reason
 */
function storedPackOf({ text }: { text: string }): StoredPack | { readonly why: string } {
  let raw: unknown;
  try {
    raw = safeJsonParse({ label: "talk pack", text });
  } catch (cause) {
    return { why: `the stored pack is not JSON: ${String(cause)}` };
  }
  const parsed = storedPackSchema.safeParse(raw);
  if (!parsed.success) {
    return { why: `the stored pack is not a pack: ${parsed.error.issues[0]!.message}` };
  }
  return parsed.data;
}

/**
 * The stored shape as the pack type, with each absent optional carried as an explicit `undefined`.
 *
 * @param stored what the schema accepted
 * @returns the pack the renderer reads
 */
function packOfStored({ stored }: { stored: StoredPack }): TalkContextPack {
  return {
    asks: stored.asks.map((ask) => ({
      askedIso: ask.askedIso,
      ownerWords: ask.ownerWords,
      lean: ask.lean,
      prWords: ask.prWords,
      priority: ask.priority,
      proofs: ask.proofs,
      question: ask.question,
      slug: ask.slug,
    })),
    boardObservedIso: stored.boardObservedIso,
    builtIso: stored.builtIso,
    checkIns: stored.checkIns?.map((checkIn) => ({
      acts: checkIn.acts,
      cards: checkIn.cards,
      did: checkIn.did,
      doneIso: checkIn.doneIso,
      evidence: checkIn.evidence,
      key: checkIn.key,
      kind: checkIn.kind,
      origin: checkIn.origin,
      place: checkIn.place,
      reason: checkIn.reason,
      tags: checkIn.tags,
    })),
    glossary: stored.glossary,
    landings: stored.landings,
    lessons: stored.lessons,
    recentlyLeft: stored.recentlyLeft?.map((left) => ({
      about: left.about,
      key: left.key,
      removedIso: left.removedIso,
      why: left.why,
    })),
    seats: stored.seats.map((seat) => ({
      directory: seat.directory,
      lastAtIso: seat.lastAtIso,
      lastMessage: seat.lastMessage,
      pinned: seat.pinned,
      ref: seat.ref,
      title: seat.title,
    })),
    turns: stored.turns,
    turnsSinceIso: stored.turnsSinceIso,
    unread: stored.unread,
  };
}

/**
 * How long ago a stored pack was built, or why its build instant cannot be trusted.
 *
 * @param stored what the schema accepted
 * @param nowIso the instant the age is measured at
 * @returns the age in milliseconds and rounded minutes, or why it has none
 */
function packAgeOf({
  stored,
  nowIso,
}: {
  stored: StoredPack;
  nowIso: string;
}): { readonly ageMs: number; readonly ageMinutes: number } | { readonly why: string } {
  const builtMs = Date.parse(stored.builtIso);
  if (Number.isNaN(builtMs)) {
    return { why: `the stored pack's builtIso ${stored.builtIso} is not an instant` };
  }
  const ageMs = Date.parse(nowIso) - builtMs;
  if (ageMs < 0) {
    return { why: `the stored pack's builtIso ${stored.builtIso} is after this call started` };
  }
  return { ageMinutes: Math.round(ageMs / 60_000), ageMs };
}

/** Whether `talk pack --write --if-older-than` rebuilds: due with the reason, or fresh with its age. */
export type PackRefresh =
  { readonly due: true; readonly why: string } | { readonly due: false; readonly ageMinutes: number };

/**
 * Whether the stored pack is due a rebuild. A missing, unparseable or future-dated file is due, exactly as a mint
 * would leave it out, and so is one older than the bound; anything else is fresh, so the 19s gather is skipped.
 *
 * @param text the stored file's contents, or `undefined` when there is no file
 * @param nowIso the instant the check runs at
 * @param olderThanMinutes the age past which it is rebuilt
 * @returns due with the reason, or fresh with its age
 */
export function packRefreshDue({
  text,
  nowIso,
  olderThanMinutes,
}: {
  text: string | undefined;
  nowIso: string;
  olderThanMinutes: number;
}): PackRefresh {
  if (text === undefined) {
    return { due: true, why: "no pack has been written" };
  }
  const stored = storedPackOf({ text });
  if ("why" in stored) {
    return { due: true, why: stored.why };
  }
  const age = packAgeOf({ nowIso, stored });
  if ("why" in age) {
    return { due: true, why: `the stored pack's builtIso ${stored.builtIso} is not a past instant` };
  }
  if (age.ageMs > olderThanMinutes * 60_000) {
    return {
      due: true,
      why: `the stored pack is ${String(age.ageMinutes)} minutes old, past ${String(olderThanMinutes)}`,
    };
  }
  return { ageMinutes: age.ageMinutes, due: false };
}

/**
 * Decide whether the stored pack rides into a call, and render it if so.
 *
 * @param text the stored file's contents, or `undefined` when there is no file
 * @param nowIso the mint's instant
 * @returns the block to append to the delegated instructions, or why it was left out
 */
export function packForMint({ text, nowIso }: { text: string | undefined; nowIso: string }): PackAtMint {
  if (text === undefined) {
    return { kind: "left-out", why: "no pack has been written — `slopweaver talk pack --write`" };
  }
  const stored = storedPackOf({ text });
  if ("why" in stored) {
    return { kind: "left-out", why: stored.why };
  }
  const age = packAgeOf({ nowIso, stored });
  if ("why" in age) {
    return { kind: "left-out", why: age.why };
  }
  const { ageMs, ageMinutes } = age;
  if (ageMs > PACK_MAX_AGE_MINUTES * 60_000) {
    return {
      kind: "left-out",
      why: `the stored pack is ${String(ageMinutes)} minutes old, past the ${String(PACK_MAX_AGE_MINUTES)}-minute bound`,
    };
  }
  const pack = packOfStored({ stored });
  const block = renderContextPack({ nowIso, pack });
  return {
    ageMinutes,
    block,
    builtIso: stored.builtIso,
    bytes: Buffer.byteLength(block, "utf8"),
    kind: "embedded",
    lessons: pack.lessons,
  };
}
