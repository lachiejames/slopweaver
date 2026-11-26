/**
 * Write the handover doc a Recovery press seats the supervisor from (`./recoverySuccessor.ts` composes it).
 *
 * The file is created EXCLUSIVELY: a number another writer took between the scan and the write fails the create,
 * so the home is scanned again and the next number tried, and no doc anybody else wrote is ever overwritten.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import { createFileExclusive } from "#lib/writeAtomic.js";

import { stateHomePaths } from "../stateHome.js";
import { type FleetError, FleetErrors } from "./errors.js";
import { nextSuccessorSlug, type RecoveryPredecessor, recoverySuccessorDoc } from "./recoverySuccessor.js";

/** How many numbers a write tries before it gives up: each one lost only to a writer that took it first. */
const CREATE_TRIES = 5;

/** A successor doc Recovery wrote. */
export interface RecoverySuccessorFile {
  readonly slug: string;
  readonly path: string;
}

/** The slugs one directory's files carry, by their extension; none for a directory that is not there. */
function slugsIn({ dir, extension }: { dir: string; extension: string }): readonly string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith(extension))
    .map((name) => name.slice(0, -extension.length));
}

/** Whether a thrown write failed only because the file was already there. */
function alreadyThere({ cause }: { cause: unknown }): boolean {
  return cause instanceof Error && "code" in cause && cause.code === "EEXIST";
}

/**
 * Write the next successor doc into the home's handover directory.
 *
 * @param home the state home
 * @param repo the checkout the chair runs in
 * @param predecessor the chair it replaces, when one was pinned
 * @param writtenAtIso when Recovery wrote it
 * @returns the slug and path written, or the failure
 */
export function writeRecoverySuccessor({
  home,
  repo,
  predecessor,
  writtenAtIso,
}: {
  home: string;
  repo: string;
  predecessor: RecoveryPredecessor | undefined;
  writtenAtIso: string;
}): Result<RecoverySuccessorFile, FleetError> {
  const { handovers, runs } = stateHomePaths({ home });
  for (let tried = 0; tried < CREATE_TRIES; tried += 1) {
    let path = handovers;
    try {
      const occupied = [
        ...slugsIn({ dir: handovers, extension: ".md" }),
        ...slugsIn({ dir: runs, extension: ".jsonl" }),
      ];
      const slug = nextSuccessorSlug({ occupied });
      path = join(handovers, `${slug}.md`);
      const text = recoverySuccessorDoc({ handoversDir: handovers, predecessor, repo, slug, writtenAtIso });
      createFileExclusive({ contents: text, path });
      return ok({ path, slug });
    } catch (cause: unknown) {
      if (!alreadyThere({ cause })) {
        return err(FleetErrors.io({ cause, path }));
      }
    }
  }
  return err(
    FleetErrors.io({
      cause: new Error(`another writer took each of the next ${String(CREATE_TRIES)} successor numbers first`),
      path: handovers,
    }),
  );
}
