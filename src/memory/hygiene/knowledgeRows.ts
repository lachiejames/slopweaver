/**
 * The knowledge rows the referent arm reads — every claim's CURRENT belief in the memories table, as the
 * documents `./referents.ts` scans. Pure: the recordings arrive already read.
 *
 * ## Why this pass reads them at all
 *
 * Weekly hygiene covers all four stores, not the auto-memory leaves only. Knowledge rows naming `src/live/ask/burstSurface.ts` and
 * `skills/recipe-scheduler` stood unflagged after both were gone, and `knowledge recall` handed them to the
 * next session as if they were still true — a session sent hunting for a file that does not exist.
 *
 * ## Only what recall would return
 *
 * The latest recording of each claim id, dropped when a LATER recording names that id in `supersedes` — the
 * same population `NOT_RETIRED` in `../../knowledge/memoryStore.ts` gives recall. An older recording of a
 * claim is history the table keeps on purpose; proposing an edit to it would ask the owner to rewrite the past.
 *
 * ## Lessons and preferences, never traces
 *
 * A trace records where one investigation looked at one instant, and a repro naming a verb since removed is
 * what was true then. A lesson or a preference is a claim a session acts on NOW, which is what the arm tests.
 */
import type { MemoryRecordingRow } from "../../store/schema/memories.js";
import {
  distinctReferents,
  extractCommandReferents,
  extractProseReferents,
  extractReferents,
  type Referent,
  type ReferentDocument,
} from "./referents.js";

/** The prefix a knowledge row's document name carries, so a proposal's `files` never reads as a leaf path. */
const KNOWLEDGE_DOCUMENT_PREFIX = "knowledge:";

/** The columns this module reads off one recording. A structural subset, so a test builds a plain object. */
export type KnowledgeRecording = Pick<
  MemoryRecordingRow,
  | "behaviourChange"
  | "caveat"
  | "claim"
  | "evidence"
  | "id"
  | "kind"
  | "recordedAt"
  | "repro"
  | "retrievalCue"
  | "seq"
  | "supersedes"
>;

/** Whether `left` was recorded after `right`, by the table's own order: the instant, then the write sequence. */
function recordedAfter({ left, right }: { left: KnowledgeRecording; right: KnowledgeRecording }): boolean {
  const leftMs = left.recordedAt.getTime();
  const rightMs = right.recordedAt.getTime();
  if (leftMs !== rightMs) {
    return leftMs > rightMs;
  }
  return left.seq > right.seq;
}

/**
 * Every claim's current belief: its latest recording, when no later recording retired it.
 *
 * @param recordings every recording the table holds, in any order
 * @returns the lessons and preferences recall would return, in claim-id order so two runs list them identically
 */
export function currentKnowledgeBeliefs({
  recordings,
}: {
  recordings: readonly KnowledgeRecording[];
}): readonly KnowledgeRecording[] {
  const latest = new Map<string, KnowledgeRecording>();
  // Per retired id, its LATEST successor: a belief is retired iff that one was recorded after it.
  const latestSuccessor = new Map<string, KnowledgeRecording>();
  for (const recording of recordings) {
    const held = latest.get(recording.id);
    if (held === undefined || recordedAfter({ left: recording, right: held })) {
      latest.set(recording.id, recording);
    }
    if (recording.supersedes === null) {
      continue;
    }
    const successor = latestSuccessor.get(recording.supersedes);
    if (successor === undefined || recordedAfter({ left: recording, right: successor })) {
      latestSuccessor.set(recording.supersedes, recording);
    }
  }
  const retired = (belief: KnowledgeRecording): boolean => {
    const successor = latestSuccessor.get(belief.id);
    return successor !== undefined && recordedAfter({ left: successor, right: belief });
  };
  return [...latest.values()]
    .filter((belief) => belief.kind !== "trace" && !retired(belief))
    .toSorted((left, right) => left.id.localeCompare(right.id));
}

/**
 * Every referent one belief makes, across every free-text field a session reads.
 *
 * Three criteria, because a row is written in a different house style from a leaf: a code span reads exactly as
 * it does in a leaf; PROSE is read for paths and skills against the checkouts' top-level names
 * (`extractProseReferents`); and the `repro`, which is a command, is read for the verbs it runs. A verb is never
 * read out of prose — see `extractCommandReferents`.
 *
 * @param belief one current belief
 * @param roots the top-level directory names of every checkout the referents resolve against
 * @returns each distinct referent, spans first, then prose, then the repro's verbs, less any path that is the tail of a longer one the row names; lines count across the fields in the order claim, evidence, caveat, repro, behaviour change, retrieval cue
 */
function knowledgeReferents({
  belief,
  roots,
}: {
  belief: KnowledgeRecording;
  roots: ReadonlySet<string>;
}): readonly Referent[] {
  const before = [belief.claim, belief.evidence, belief.caveat].filter((field): field is string => field !== null);
  const fields = [...before, belief.repro, belief.behaviourChange, belief.retrievalCue].filter(
    (field): field is string => field !== null,
  );
  const text = fields.join("\n");
  const reproLine = before.join("\n").split("\n").length + 1;
  const referents = distinctReferents({
    referents: [
      ...extractReferents({ text }),
      ...extractProseReferents({ roots, text }),
      ...(belief.repro === null ? [] : extractCommandReferents({ line: reproLine, text: belief.repro })),
    ],
  });
  // A path the same row also names in full is shorthand for it — `src/test/x.ts` beside
  // `packages/backend/src/test/x.ts` — and would otherwise be judged against the checkout's root.
  const paths = referents.filter((referent) => referent.kind === "path").map((referent) => referent.text);
  return referents.filter(
    (referent) =>
      referent.kind !== "path" ||
      (!paths.some((path) => path.endsWith(`/${referent.text}`)) && !namesADependency({ path: referent.text })),
  );
}

/**
 * Whether a path runs through an installed package — `site/node_modules/next/dist/…`. That file is a
 * dependency's, which a lockfile bump moves without the row having been wrong, and no checkout commits it.
 */
function namesADependency({ path }: { path: string }): boolean {
  return path.split("/").includes("node_modules");
}

/**
 * One document per belief, named `knowledge:<id>`.
 *
 * @param beliefs the current beliefs, from {@link currentKnowledgeBeliefs}
 * @param roots the top-level directory names of every checkout, which decide what prose names a repo path
 * @returns the documents, in the order given
 */
export function knowledgeDocuments({
  beliefs,
  roots,
}: {
  beliefs: readonly KnowledgeRecording[];
  roots: ReadonlySet<string>;
}): readonly ReferentDocument[] {
  return beliefs.map((belief) => ({
    file: `${KNOWLEDGE_DOCUMENT_PREFIX}${belief.id}`,
    referents: knowledgeReferents({ belief, roots }),
  }));
}
