/**
 * The filesystem tail of an install's proposal destination: one JSON file at
 * `stateHomePaths().proposalsDestinationJson`.
 *
 * Thin by design; `./destination.ts` decides what a destination is. Absence is its own typed failure
 * (`DESTINATION_UNSET`) rather than a default, because there is no destination this repository could assume
 * on an install's behalf — a silent Notion default is exactly the coupling this file exists to remove.
 */
import { existsSync, readFileSync } from "node:fs";

import { writeFileAtomicStream } from "#lib/writeAtomic.js";

import { err, ok, type Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import { PROPOSAL_DESTINATION_SET_HINT, type ProposalDestination, parseProposalDestination } from "./destination.js";
import { type ProposalDestinationError, ProposalDestinationErrors } from "./destinationErrors.js";

/**
 * Where this install's destination is stored.
 *
 * @param home the state home
 * @returns the absolute path to `destination.json`
 */
export function proposalDestinationPath({ home }: { home: string }): string {
  return stateHomePaths({ home }).proposalsDestinationJson;
}

/**
 * Read this install's proposal destination.
 *
 * @param home the state home
 * @returns the destination; `DESTINATION_UNSET` when none was set, never a default
 */
export function readProposalDestination({
  home,
}: {
  home: string;
}): Result<ProposalDestination, ProposalDestinationError> {
  const path = proposalDestinationPath({ home });
  if (!existsSync(path)) {
    return err(ProposalDestinationErrors.unset({ hint: PROPOSAL_DESTINATION_SET_HINT, path }));
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error: unknown) {
    return err(ProposalDestinationErrors.unreadable({ cause: error, path }));
  }
  return parseProposalDestination({ path, raw });
}

/** `destination.json`'s mode: owner read-write, whatever the process umask. */
const DESTINATION_FILE_MODE = 0o600;

/**
 * Write this install's proposal destination atomically, replacing any earlier one.
 *
 * @param home the state home
 * @param destination the destination to persist, already validated by its schema
 * @returns the path written and read back, or `DESTINATION_WRITE_FAILED` when either half failed
 */
export function writeProposalDestination({
  home,
  destination,
}: {
  home: string;
  destination: ProposalDestination;
}): Result<string, ProposalDestinationError> {
  const path = proposalDestinationPath({ home });
  try {
    const contents = `${JSON.stringify(destination, null, 2)}\n`;
    // An EXACT owner read-write mode, set on the staged file before the rename: a restrictive process umask
    // would otherwise let `set` succeed on a file that `show` and `publish` then cannot read.
    writeFileAtomicStream({
      exactMode: true,
      fileMode: DESTINATION_FILE_MODE,
      path,
      produce: ({ write }) => {
        write({ text: contents });
      },
    });
  } catch (error: unknown) {
    return err(ProposalDestinationErrors.writeFailed({ cause: error, path }));
  }
  // Read it back through the SAME reader `show` and `publish` use: a mode bit is one way a written file can be
  // unreadable, not the only one (an inherited deny ACL is another), so success means "readable", not "written".
  const readBack = readProposalDestination({ home });
  if (readBack.isErr()) {
    return err(
      ProposalDestinationErrors.writeFailed({
        cause: new Error(`written, but reading it back failed: ${readBack.error.message}`),
        path,
      }),
    );
  }
  return ok(path);
}
