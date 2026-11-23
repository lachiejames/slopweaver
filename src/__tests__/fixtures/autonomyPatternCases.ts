/*
 * One table of acts the autonomy register and the console's check-in list must draw into the same PATTERNS.
 *
 * Pure data with no imports, on purpose: `site/` cannot import `src/autonomy/query.ts` (its type graph reaches
 * `neverthrow` and `zod`, which the site package does not install), and `src/` cannot import the page (its graph
 * reaches `react`). So the mirror is two halves over this one table, and each half holds its surface to it:
 *
 * - `src/__tests__/unit/autonomy/patternMirror.test.ts` folds every case with the REAL register and asserts the
 *   fold prints exactly `payload` (and `wordedPayload`) and draws exactly `groups`;
 * - `site/__tests__/unit/actPatternMirror.test.ts` reads every `payload` with the page's reader and asserts the
 *   check-in list draws exactly `groups`.
 *
 * Both are equal to the same table, so the register and the page are equal to each other.
 */

/** The sentence one pattern's acts are written up in. */
export const PATTERN_SAID = "I rebased your security PR onto staging so the reviewer sees it green";

const PR = "https://github.com/acme/acme-admin/pull";

/** One act as the register records it — and, with nothing else on its line, as `autonomy list --json` prints it. */
export interface PatternAct {
  readonly actionId: string;
  readonly bySession: string;
  readonly doneIso: string;
  readonly kind: string;
  readonly subject: string;
  readonly why: string;
  readonly witness: string;
  readonly said?: string;
}

/** One act, at a minute past 01:00 that orders it. */
function patternAct({
  id,
  kind = "rebase",
  subject,
  minute,
  said,
}: {
  id: string;
  kind?: string;
  subject: string;
  minute: number;
  said?: string;
}): PatternAct {
  const base = {
    actionId: id,
    bySession: "mirror",
    doneIso: `2026-09-28T01:${String(minute).padStart(2, "0")}:00.000Z`,
    kind,
    subject,
    why: "mirror",
    witness: "mirror",
  };
  if (said === undefined) {
    return base;
  }
  return { ...base, said };
}

/** One case: its acts NEWEST FIRST, as the register orders them, and the patterns both surfaces must draw. */
export interface PatternCase {
  readonly name: string;
  readonly acts: readonly PatternAct[];
  /** Each pattern's action ids, its newest first; the patterns in the order of their newest act. */
  readonly groups: readonly (readonly string[])[];
}

/** Every case, each act listed newest first. */
export const PATTERN_CASES: readonly PatternCase[] = [
  { acts: [], groups: [], name: "no acts" },
  {
    acts: [patternAct({ id: "a", minute: 1, said: PATTERN_SAID, subject: `${PR}/1` })],
    groups: [["a"]],
    name: "one act",
  },
  {
    acts: ["17519", "17535", "17553", "17522", "17524", "17531", "17554"].map((pull, index) =>
      patternAct({ id: pull, minute: 6 - index, said: PATTERN_SAID, subject: `${PR}/${pull}` }),
    ),
    groups: [["17519", "17535", "17553", "17522", "17524", "17531", "17554"]],
    name: "seven rebases in one sentence",
  },
  {
    acts: [
      patternAct({ id: "b", kind: "fix-red-ci", minute: 2, said: PATTERN_SAID, subject: `${PR}/2` }),
      patternAct({ id: "a", minute: 1, said: PATTERN_SAID, subject: `${PR}/1` }),
    ],
    groups: [["b"], ["a"]],
    name: "one sentence, two kinds",
  },
  {
    acts: [
      patternAct({ id: "c", minute: 3, said: PATTERN_SAID, subject: `${PR}/2` }),
      patternAct({ id: "b", minute: 2, said: PATTERN_SAID, subject: `${PR}/1` }),
      patternAct({ id: "a", minute: 1, said: "first", subject: `${PR}/1` }),
    ],
    groups: [["c", "b", "a"]],
    name: "joined through a middle act sharing a subject with one and a sentence with the other",
  },
  {
    acts: [
      patternAct({ id: "c", minute: 3, subject: `${PR}/1` }),
      patternAct({ id: "b", minute: 2, subject: `${PR}/2` }),
      patternAct({ id: "a", minute: 1, subject: `${PR}/1` }),
    ],
    groups: [["c", "a"], ["b"]],
    name: "no sentence: one pattern per subject",
  },
  {
    acts: [
      patternAct({ id: "b", minute: 2, said: `${PATTERN_SAID}.`, subject: `${PR}/2` }),
      patternAct({ id: "a", minute: 1, said: PATTERN_SAID, subject: `${PR}/1` }),
    ],
    groups: [["b"], ["a"]],
    name: "sentences one character apart",
  },
];

/**
 * The lines `autonomy list --json` prints for a case's acts with no word on any of them.
 *
 * @param acts the case's acts, newest first
 * @returns one line per act
 */
export function payloadOf({ acts }: { acts: readonly PatternAct[] }): readonly { action: PatternAct }[] {
  return acts.map((action) => ({ action }));
}

/** The owner's word, as each worded case gives it on every pattern's newest act. */
export const PATTERN_WORD = { bySession: "mirror", steer: "right call", steeredIso: "2026-09-28T07:00:00.000Z" };

/**
 * The lines `autonomy list --json` prints for a case once {@link PATTERN_WORD} is given on each pattern's newest
 * act: the lead carries it as its latest steer, and every earlier act carries it as its pattern's word.
 *
 * @returns one line per act, newest first
 */
export function wordedPayloadOf({ patternCase }: { patternCase: PatternCase }): readonly object[] {
  const leadOf = new Map(patternCase.groups.flatMap((group) => group.map((id) => [id, group[0]!] as const)));
  return patternCase.acts.map((action) => {
    const lead = leadOf.get(action.actionId)!;
    if (lead === action.actionId) {
      return { action, latestSteer: { actionId: lead, ...PATTERN_WORD } };
    }
    return { action, patternSteer: { actionId: lead, steer: PATTERN_WORD.steer } };
  });
}

/**
 * One sentence written up where a scoped rule covers the older act and not the newer. Joined on their sentence, the older act sat folded under the newer act's asking card, counted under no
 * rule. A pattern never spans two standing rules, so these are two.
 */
export const SCOPED_RULE = {
  actionId: "class-scoped.b-rebases",
  anchor: "transcript:mirror#b",
  bySession: "mirror",
  kinds: "rebase",
  steer: "rebase b's pull requests unasked",
  steeredIso: "2026-09-28T07:00:00.000Z",
  subjectPrefix: "https://b.example/",
};

/** The scoped case's acts, newest first. */
export const SCOPED_ACTS: readonly PatternAct[] = [
  patternAct({ id: "N", minute: 2, said: PATTERN_SAID, subject: "https://a.example/1" }),
  patternAct({ id: "O", minute: 1, said: PATTERN_SAID, subject: "https://b.example/1" }),
];

/** What `autonomy list --json` prints for the scoped case: the rule rides on the one act it covers. */
export const SCOPED_PAYLOAD: readonly object[] = [
  { action: SCOPED_ACTS[0]! },
  { action: SCOPED_ACTS[1]!, classSteer: SCOPED_RULE },
];

/** The scoped case's patterns: two, each alone. */
export const SCOPED_GROUPS: readonly (readonly string[])[] = [["N"], ["O"]];
