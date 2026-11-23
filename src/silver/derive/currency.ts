/**
 * Whether a refresh may skip its whole-corpus derive, pure half.
 *
 * `deriveFreshness` (`./freshness.ts`) asks whether the identity roster is safe for a send to use. This
 * module asks a stronger question of the same stamp: whether every artefact derive writes is already what a
 * rebuild would write. Only `refresh` asks it (`../../cli/commands/refresh/derive.ts`), and its effectful half,
 * reading the stamp and statting each artefact, lives there.
 */
import { ALL_CORPUS_SOURCES } from "../../integrations/corpusSources.js";
import {
  type ArtefactWitness,
  type CorpusWitness,
  type DeriveFreshness,
  type FreshnessObservation,
  type FreshnessStamp,
  freshnessReason,
  SILVER_ROSTER_ARTEFACT,
  type SourceWitness,
} from "./freshness.js";

/**
 * Whether silver as it stands is already what a derive would write, or why it has to be rebuilt.
 *
 * `current` is a stronger claim than `deriveFreshness`'s `fresh`, which looks only at the roster's own
 * inputs. A refresh that skips its derive on `current` must leave EVERY artefact as true as a rebuild would.
 */
export type SilverCurrency =
  { readonly kind: "current"; readonly derivedAtIso: string } | { readonly kind: "rebuild"; readonly why: string };

/**
 * Decide whether a refresh may skip its whole-corpus derive. Pure.
 *
 * MEASURED on the owner's 3,441,013-record corpus, from a cmux session with the same NODE_OPTIONS
 * as a seat: `/usr/bin/time -l slopweaver refresh --source fathom --store` stored 0 transcripts and still
 * peaked at 7,933 MiB RSS in 99 s, every byte of it the derive. Under cmux's
 * 4,096 MiB ceiling that derive died (exit 134), six times across `resync-corpus-calendar` and
 * `resync-corpus-fathom`. A derive whose inputs have not moved rebuilds byte-identical silver,
 * so loading the corpus to do it buys nothing.
 *
 * `current` needs all six of these:
 *
 * - **every artefact the derive writes is on disk**, so a deleted file is rebuilt rather than vouched for;
 * - **each is exactly the file the stamped derive wrote** — the size and mtime its `stat` recorded straight
 *   after the write — so a derive killed mid-write, leaving its file under another derive's stamp, is rebuilt
 *   rather than vouched for;
 * - **the send gate's own verdict is `fresh`.** That verdict compares the roster sources' resume cursors,
 *   which advance on a refresh that writes nothing. Skip without it, and the next Slack or Linear send that
 *   names someone pays the whole-corpus derive inside the send (`../rosterForSend.ts`) instead;
 * - **every source's bronze, member and structure extent is unchanged**, the roster sources AND the four
 *   (calendar, fathom, gmail, gold) the send gate ignores, because the directory and the opportunities read
 *   them all. A non-roster cursor is deliberately NOT compared: derive does not read it;
 * - **the sync-author denylist is the same size;**
 * - **the corpus tree the reader walks is the same** — the same resolved root, and the same recursive count of
 *   `.jsonl` files, bytes and unlistable paths. The per-source witness sees only each source's top level, while
 *   the reader recurses the whole root, so a nested file, a loose one or a `--corpus` stamp would otherwise pass.
 *
 * What it cannot see: a same-length rewrite of any input (`./freshness.ts`'s header: bronze, a member or
 * structure roster, the identity roster or the denylist), a change to derive's own code, and a second derive writing
 * in the instant between another's write and its `stat`. A same-length edit and a code change heal on the next
 * bronze movement, which a four-hourly resync supplies; `slopweaver derive` heals any of them at once.
 *
 * @param freshness what `deriveFreshness` said about the roster, through `loadDerivedRoster`
 * @param stamp the stamp beside the artefacts, or undefined when there is none
 * @param observed what the inputs hold now
 * @param missingArtefacts every artefact path derive writes that is not on disk
 * @param onDisk each content artefact's current size and mtime, keyed by path, to pair with the stamp's record
 * @returns `current` with when silver was derived, or the reason it must be rebuilt
 */
export function silverCurrency({
  freshness,
  stamp,
  observed,
  missingArtefacts,
  onDisk,
}: {
  freshness: DeriveFreshness;
  stamp: FreshnessStamp | undefined;
  observed: FreshnessObservation;
  missingArtefacts: readonly string[];
  onDisk: Readonly<Record<string, ArtefactWitness>>;
}): SilverCurrency {
  if (missingArtefacts.length > 0) {
    return { kind: "rebuild", why: `silver is incomplete: ${missingArtefacts.join(", ")} absent` };
  }
  if (freshness.kind !== "fresh") {
    return { kind: "rebuild", why: freshnessReason({ artefact: SILVER_ROSTER_ARTEFACT, freshness }) };
  }
  if (stamp === undefined) {
    return { kind: "rebuild", why: "silver carries no freshness stamp" };
  }
  const written = stamp.artefacts;
  if (written === null) {
    return { kind: "rebuild", why: "the stamp does not record the artefacts its derive wrote" };
  }
  const unpaired = Object.entries(onDisk)
    .filter(([path, now]) => {
      const was: ArtefactWitness | undefined = written[path];
      return was === undefined || was.bytes !== now.bytes || was.mtimeMs !== now.mtimeMs;
    })
    .map(([path]) => path);
  if (unpaired.length > 0) {
    return {
      kind: "rebuild",
      why: `${unpaired.join(", ")} is not what the stamped derive wrote, so silver may mix two derives' output`,
    };
  }
  const moved = ALL_CORPUS_SOURCES.filter((source) =>
    extentMoved({ observed: observed.sources[source], stamped: stamp.sources[source] }),
  );
  if (moved.length > 0) {
    return { kind: "rebuild", why: `bronze, members or structures moved for ${moved.join(", ")}` };
  }
  if (stamp.exclusionBytes !== observed.exclusionBytes) {
    return {
      kind: "rebuild",
      why: `the sync-author denylist moved ${String(stamp.exclusionBytes)}B → ${String(observed.exclusionBytes)}B`,
    };
  }
  // Last, because a per-source move above names the source and this can only name the tree.
  const corpusMoved = corpusMovedReason({ observed: observed.corpus, stamped: stamp.corpus });
  if (corpusMoved !== undefined) {
    return { kind: "rebuild", why: corpusMoved };
  }
  return { derivedAtIso: stamp.derivedAtIso, kind: "current" };
}

/** Why the tree derive's reader walks differs from the one silver was derived from, or undefined when it does not. */
function corpusMovedReason({
  stamped,
  observed,
}: {
  stamped: CorpusWitness | null;
  observed: CorpusWitness | null;
}): string | undefined {
  if (stamped === null || observed === null) {
    return "the stamp does not witness the corpus tree derive reads";
  }
  if (stamped.root !== observed.root) {
    return `silver was derived from ${stamped.root}, not ${observed.root}`;
  }
  if (
    stamped.files !== observed.files ||
    stamped.bytes !== observed.bytes ||
    stamped.unreadable !== observed.unreadable
  ) {
    return `the corpus tree moved: ${treeExtent({ tree: stamped })} → ${treeExtent({ tree: observed })}`;
  }
  return undefined;
}

/** A corpus tree's extent as one phrase, e.g. `2 file(s) 100B, 0 unlistable`. */
function treeExtent({ tree }: { tree: CorpusWitness }): string {
  return `${String(tree.files)} file(s) ${String(tree.bytes)}B, ${String(tree.unreadable)} unlistable`;
}

/** Whether anything derive READS for one source moved — its cursor excluded, which derive never reads. */
function extentMoved({ stamped, observed }: { stamped: SourceWitness; observed: SourceWitness }): boolean {
  return (
    stamped.bronzeFiles !== observed.bronzeFiles ||
    stamped.bronzeBytes !== observed.bronzeBytes ||
    stamped.memberBytes !== observed.memberBytes ||
    stamped.structureBytes !== observed.structureBytes
  );
}
