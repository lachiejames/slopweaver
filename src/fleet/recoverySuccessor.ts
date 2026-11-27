/**
 * The handover doc a Recovery press seats the supervisor from, when the chair it restarts is down: the pure half of
 * `./recoverySuccessorStore.ts`.
 *
 * A chair that hands off writes its successor a rich doc (`skills/supervisor/reference/briefing-contract.md`
 * § Successor handoff). A chair Recovery restarts is down, so nobody can write that doc. This one is mechanical:
 * it carries only what a successor must hold to boot — `role: supervisor`, the `/slopweaver:supervisor` invocation
 * as its first instruction, the sweep, `cmux takeover` (a bare `cmux pin` where no chair was pinned) — and points at the newest predecessor doc rather than
 * copying any of it, so what the successor reads is whatever that doc, and everything it points to, says now.
 *
 * **The control plane's chair hand-off writes the same doc** (`../cli/commands/supervisor/chairHandOffRun.ts`), with
 * the reasons its watch named and the outgoing chair's note verbatim under its own heading — or, when no note arrived
 * in time, the one paragraph telling the successor to rebuild the picture from files. Without that option the doc is
 * Recovery's, byte for byte.
 *
 * **The slug is the chain's next number, counted over everything the home holds.** A doc and a run journal each
 * occupy a number, so a number whose doc was deleted is still never reused. The store creates the file exclusively,
 * so a number another writer takes first is skipped rather than overwritten.
 */

/** The prefix every supervisor successor's slug carries, followed by its number in the chain. */
export const SUCCESSOR_SLUG_PREFIX = "fresh-supervisor-handoff-";

/** The chair whose place a Recovery successor takes, when one is known. */
export interface RecoveryPredecessor {
  /** Where its host held it: `workspace:<n>` or `app:<id>`. */
  readonly label: string;
  /** Its handover slug, when its ledger row names one. */
  readonly slug?: string;
}

/**
 * The chain number a slug carries.
 *
 * @param slug a handover slug
 * @returns the number after {@link SUCCESSOR_SLUG_PREFIX}, or `undefined` for a slug outside the chain
 */
export function successorNumberOf({ slug }: { slug: string }): number | undefined {
  const match = /^fresh-supervisor-handoff-(\d{1,9})$/u.exec(slug);
  if (match === null) {
    return undefined;
  }
  return Number(match[1]);
}

/**
 * The next free successor slug: one past the highest chain number any doc or journal in the home holds.
 *
 * @param occupied every handover slug the home holds, from its docs and its run journals both
 * @returns `fresh-supervisor-handoff-<n>`, `1` for a home with no chain yet
 */
export function nextSuccessorSlug({ occupied }: { occupied: readonly string[] }): string {
  let highest = 0;
  for (const slug of occupied) {
    const number = successorNumberOf({ slug });
    if (number !== undefined && number > highest) {
      highest = number;
    }
  }
  return `${SUCCESSOR_SLUG_PREFIX}${String(highest + 1)}`;
}

/** What the successor is told about the chair before it, in one paragraph. */
function predecessorParagraph({
  predecessor,
  handoversDir,
}: {
  predecessor: RecoveryPredecessor | undefined;
  handoversDir: string;
}): string {
  if (predecessor === undefined) {
    return "No supervisor was pinned, so there is no predecessor doc: build the picture from the board (`slopweaver handover list`).";
  }
  if (predecessor.slug === undefined) {
    return `The chair before you was ${predecessor.label}, and its ledger row names no handover doc: build the picture from the board (\`slopweaver handover list\`).`;
  }
  return (
    `The chair before you was ${predecessor.label}, booted from \`${handoversDir}/${predecessor.slug}.md\`. Read that doc ` +
    "whole, and every state file and older doc it points you at, then the board (`slopweaver handover list`): rows " +
    "written since it was written win over it."
  );
}

/**
 * The control plane's chair hand-off a successor doc is written for (`../supervisor/chairHandOff.ts`): the episode,
 * the reasons the watch named, and the outgoing chair's note, or how long the control plane waited for one.
 */
export interface SuccessorHandOff {
  readonly episodeId: string;
  readonly reasons: readonly string[];
  /** The outgoing chair's note, verbatim, or undefined when none arrived. */
  readonly note: string | undefined;
  readonly noteWaitSeconds: number;
}

/** The sentence after the seat command: what a refusal means, and what never to do about one. */
const REFUSAL_SENTENCE =
  "If it refuses, read its reason: run what it names when that is a read it wants first, and otherwise say why in " +
  "this card and stop. Never move the pin around a refusal, and never close another session to clear one.";

/**
 * How the successor takes the pin: `cmux takeover` from a pinned chair, a bare `cmux pin` where none was pinned,
 * since a takeover with no predecessor refuses.
 */
function seatStep({
  predecessor,
  handOff,
}: {
  predecessor: RecoveryPredecessor | undefined;
  handOff: SuccessorHandOff | undefined;
}): string {
  let after = `Do this before reading anything else: the press reads the pin moving to you as the chair restarted. ${REFUSAL_SENTENCE}`;
  if (handOff !== undefined) {
    after =
      "Do this before reading anything else: the control plane already closed the outgoing chair's run, so " +
      `takeover's predecessor gate reads it finished. ${REFUSAL_SENTENCE}`;
  }
  if (predecessor === undefined) {
    return `Run \`slopweaver cmux pin\`, with no \`--workspace\`, so the pin records this app session. ${after}`;
  }
  return `Run \`slopweaver supervisor owner-turns\` until it reports nothing left, then \`slopweaver cmux takeover\`. ${after}`;
}

/** The lines a doc's opening carries: Recovery's, or the hand-off's with the reasons the watch named. */
function openingLines({
  handOff,
  replaced,
  writtenAtIso,
}: {
  handOff: SuccessorHandOff | undefined;
  replaced: string;
  writtenAtIso: string;
}): { readonly summary: string; readonly title: string; readonly why: readonly string[] } {
  if (handOff === undefined) {
    return {
      summary: `Fresh /slopweaver:supervisor seated by a Recovery press in the desktop app at ${writtenAtIso}, replacing ${replaced}, which was down.`,
      title: "# Fresh supervisor, seated by Recovery",
      why: [
        "The owner pressed Recovery in the desktop app because the supervisor was down. Nobody wrote you a hand-off: this " +
          "doc was written mechanically, and it is waiting for you to take the pin.",
      ],
    };
  }
  return {
    summary: `Fresh /slopweaver:supervisor seated by the control plane's chair hand-off at ${writtenAtIso}, replacing ${replaced}, which reached its bar.`,
    title: "# Fresh supervisor, seated by the control plane's chair hand-off",
    why: [
      `The control plane handed the chair off (\`${handOff.episodeId}\`) because its watch said so:`,
      "",
      ...handOff.reasons.map((reason) => `- ${reason}`),
      "",
      "No model decided this: the outgoing chair was asked only for a note. This doc was written mechanically, and it " +
        "is waiting for you to take the pin.",
    ],
  };
}

/** The hand-off note section: the outgoing chair's note verbatim, or the rebuild-from-files instruction. */
function noteLines({ handOff }: { handOff: SuccessorHandOff | undefined }): readonly string[] {
  if (handOff === undefined) {
    return [];
  }
  if (handOff.note === undefined) {
    return [
      "## No hand-off note",
      "",
      `No hand-off note arrived within ${String(handOff.noteWaitSeconds)}s; rebuild the picture from files as a fresh chair does (skills/pickup).`,
      "",
    ];
  }
  return ["## Hand-off note from the outgoing chair", "", handOff.note.trimEnd(), ""];
}

/**
 * The successor doc's whole text.
 *
 * @param slug the successor's own slug
 * @param repo the checkout the chair runs in
 * @param handoversDir the home's handover directory, where the predecessor's doc lives
 * @param predecessor the chair it replaces, when one was pinned
 * @param writtenAtIso when Recovery, or the control plane, wrote it
 * @param handOff the control plane's chair hand-off this doc is for; absent for a Recovery press, whose doc it leaves
 *   exactly as it was
 * @returns the doc, front matter first
 */
export function recoverySuccessorDoc({
  slug,
  repo,
  handoversDir,
  predecessor,
  writtenAtIso,
  handOff,
}: {
  slug: string;
  repo: string;
  handoversDir: string;
  predecessor: RecoveryPredecessor | undefined;
  writtenAtIso: string;
  handOff?: SuccessorHandOff | undefined;
}): string {
  const replaced = predecessor === undefined ? "no pinned chair" : `the chair on ${predecessor.label}`;
  const opening = openingLines({ handOff, replaced, writtenAtIso });
  return [
    "---",
    `slug: ${slug}`,
    "role: supervisor",
    "priority: p1",
    "status: ready",
    "blockedBy: []",
    `repo: ${repo}`,
    "artifact: null",
    "doneWhen: []",
    'probeWaiver: "The outcome is the supervisor pin on this session, which `cmux takeover` itself checks; no repo-local command re-asserts a live pin."',
    `summary: "${opening.summary}"`,
    "workspace: self",
    'workspaceBecause: "the supervisor chair runs in the main checkout"',
    "---",
    "",
    opening.title,
    "",
    "You INVOKE `/slopweaver:supervisor` through the `Skill` tool as your first act (reading it is not running it).",
    "",
    ...opening.why,
    "",
    "1. Arm the sweep, as `skills/supervisor/reference/briefing-contract.md` § 7 says.",
    `2. ${seatStep({ handOff, predecessor })}`,
    `3. ${predecessorParagraph({ handoversDir, predecessor })}`,
    "4. Once the picture is read, run `slopweaver supervisor reoriented` once, with no `--attempt`.",
    "",
    ...noteLines({ handOff }),
  ].join("\n");
}
