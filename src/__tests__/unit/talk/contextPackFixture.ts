/**
 * The empty pack, the bare ask and the check-in builder the context-pack tests start from. Builders only, so every
 * assertion stays in the test file.
 */
import type { TalkContextPack } from "../../../talk/contextPack.js";
import type { PackCheckIn } from "../../../talk/packCheckIns.js";

/** A pack with every section empty, built two minutes before the tests' clock. */
export const EMPTY: TalkContextPack = {
  asks: [],
  boardObservedIso: "2026-09-24T13:58:00.000Z",
  builtIso: "2026-09-24T13:58:00.000Z",
  checkIns: [],
  glossary: [],
  landings: [],
  lessons: undefined,
  recentlyLeft: [],
  seats: [],
  turns: [],
  turnsSinceIso: "2026-09-23T14:00:00.000Z",
  unread: [],
};

/** An ask's pull-request half on a row that names none. */
export const NO_PR = { prWords: undefined, proofs: undefined } as const;

/** An ask with no pull request, asked time or lean, every case naming its own slug and words. */
export const BARE_ASK = { ...NO_PR, askedIso: undefined, lean: undefined, priority: "p2", question: "Q?" };

/**
 * One check-in rule, overridable field by field.
 *
 * @param over the fields a case replaces on the default rule
 * @returns the default check-in with those fields swapped in
 */
export const checkIn = (over: Partial<PackCheckIn> = {}): PackCheckIn => ({
  acts: 4,
  cards: 3,
  did: "Pushed back on CodeRabbit's rename on the logger PR",
  doneIso: "2026-09-24T12:00:00.000Z",
  evidence: "github reply printed 201",
  key: "act:ev-2",
  kind: "push-back-on-coderabbit",
  origin: "the-logger-run",
  place: "acme/acme-admin",
  reason: "the rename would break the public import path",
  tags: ["repo:acme-admin", "area:logging"],
  ...over,
});
