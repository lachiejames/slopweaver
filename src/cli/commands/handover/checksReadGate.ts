/**
 * The checks-read question, asked at the one moment a session is about to walk away: as a run ends.
 *
 * ## What it refuses, and why it is a gate rather than a habit
 *
 * A pull request can sit as a draft with two red checks because the session that pushed it moved straight on to
 * building proof artifacts and never read the pull request's checks once. Nothing watches it, and the owner
 * finds the reds themselves; PRs are not raised with red checks and then left red. The failure analysis is why "just run the linters locally" would not have caught it either: unit tests and oxlint
 * ran, typecheck never did, and the tests passed against a field name TypeScript would have refused (TS2561,
 * `longMessage` for `long_message`), because the predicate under test only reads `code`. CI knew. Nobody
 * asked it.
 *
 * So the rule is mechanical: **a pull request is not RAISED until its checks have been read once.**
 * `github stack push` leaves the obligation behind (`../../../outbound/github/checksReadLedger.ts`),
 * `github checks` discharges it, and this gate refuses to let `handover finish` or `handover settle` close a
 * run that still owes one. AGENTS.md rule 2 bans the resident watcher that would otherwise be the obvious
 * answer, and every act in this chain is a visible session doing something.
 *
 * ## Scoped to THIS run's branch, which is what makes it safe to share a register
 *
 * The register is install-wide and several fleet sessions push at once, so an unscoped gate would refuse one
 * session's settle over another session's pull request. The run's own `started` event carries `branch`, and
 * only raises on that branch are asked about.
 *
 * ## When the gate does NOT fire, and why none of those is a hole
 *
 * Only a run that was actually STARTED is asked, exactly as `./lessonsGate.ts` is: a journal with no
 * `started` event belongs to a row settled as bookkeeping, and no push happened inside it. A branch that
 * raised nothing owes nothing. And a register that has never been written is EMPTY rather than a failure —
 * while one that exists and cannot be READ is a refusal, because an unreadable register must never be
 * indistinguishable from a branch with nothing outstanding.
 *
 * ## A dry run journals nothing and still refuses
 *
 * This gate writes no event at all, so `--dry-run` needs no special case here — but the refusal path is
 * deliberately unchanged by it, since previewing a success that would not happen is worse than the write it
 * avoids.
 */
import { readRunJournal } from "../../../handover/runStore.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import { hatchEnvVar } from "../../../hatch/types.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import {
  type ChecksRaisedRecord,
  type ChecksReadError,
  type ChecksReadRow,
  checksReadCommand,
  readChecksReadLedger,
  unreadRaises,
} from "../../../outbound/github/checksReadLedger.js";

/**
 * This gate's own hatch, resolved once so the refusal text and the variable name cannot drift apart. The key is
 * `SLOPWEAVER_ALLOW_UNREAD_CHECKS`, spelled here so the row in `../../../hatch/registry.ts` naming this file as
 * its reader is checkable by `escape-hatch` rather than taken on trust.
 */
const UNREAD_CHECKS_HATCH = hatchFor({ id: "unread-checks" });

/**
 * How the gate reads the register.
 *
 * A seam rather than a direct call so a unit test can exercise every branch — the unreadable register
 * included — without a state home. `.claude/rules/testing.md` bans the mock that would otherwise be needed,
 * and a plain function passed in is not one.
 */
export type ChecksReadReader = ({ home }: { home: string }) => Result<readonly ChecksReadRow[], ChecksReadError>;

/**
 * The default reader: this install's own `ledgers/pr-checks-read.jsonl`.
 *
 * @returns every row on the register, or why it could not be read
 */
const registerRows: ChecksReadReader = ({ home }) => readChecksReadLedger({ home });

/** The branch a run is executing on, or `undefined` when the run was never started. */
function startedBranch({ runsDir, slug, verb }: { runsDir: string; slug: string; verb: string }): string | undefined {
  const journal = readRunJournal({ runsDir, slug });
  if (journal.isErr()) {
    logger.error({ msg: `handover ${verb}: ${journal.error.message}` });
    return undefined;
  }
  const started = journal.value.events.findLast((event) => event.kind === "started");
  if (started === undefined) {
    return undefined;
  }
  return started.branch;
}

/** Print the refusal: what is outstanding, the exact command that clears it, then the four required lines. */
function reportRefusal({ outstanding, verb }: { outstanding: readonly ChecksRaisedRecord[]; verb: string }): void {
  logger.error({
    msg: `handover ${verb}: ${String(outstanding.length)} pull request(s) raised on this branch have never had their checks read.`,
  });
  for (const row of outstanding) {
    logger.error({ msg: `  ${row.repo}#${String(row.number)} at ${row.headSha}` });
    logger.error({ msg: `    ${checksReadCommand({ row })}` });
  }
  for (const line of hatchRefusalLines({ hatch: UNREAD_CHECKS_HATCH })) {
    logger.error({ msg: line });
  }
}

/**
 * Ask whether this run still owes a read, and say whether the calling verb must refuse.
 *
 * @param slug the doc's slug, whose journal names the branch
 * @param verb the verb being gated, interpolated into every line so the message names what was typed
 * @param runsDir where the journal lives
 * @param home the state home the register is read from
 * @param readRegister how to read the register; defaults to this install's own
 * @returns true when the caller must stop and print nothing further
 */
export function checksReadGateRefuses({
  slug,
  verb,
  runsDir,
  home,
  readRegister = registerRows,
}: {
  slug: string;
  verb: string;
  runsDir: string;
  home: string;
  readRegister?: ChecksReadReader | undefined;
}): boolean {
  const branch = startedBranch({ runsDir, slug, verb });
  if (branch === undefined) {
    return false;
  }
  const forced = process.env[hatchEnvVar({ suffix: "UNREAD_CHECKS" })] === "1";
  const rows = readRegister({ home });
  if (rows.isErr()) {
    // A register that exists and cannot be read is a refusal, never an empty one: the whole point of the
    // gate is that nobody looked, and an outage that silently answers "nothing outstanding" reproduces
    // exactly the failure it exists to catch.
    logger.error({ msg: `handover ${verb}: ${rows.error.message}` });
    return !announceForced({ forced, verb });
  }
  const outstanding = unreadRaises({ branch, rows: rows.value });
  if (outstanding.length === 0) {
    return false;
  }
  if (announceForced({ forced, verb })) {
    return false;
  }
  reportRefusal({ outstanding, verb });
  return true;
}

/**
 * Say loudly that the hatch was used, so a forced close is never a quiet one.
 *
 * @param forced whether this session set the hatch's variable
 * @param verb the verb being gated
 * @returns true when the caller may proceed because the hatch is open
 */
function announceForced({ forced, verb }: { forced: boolean; verb: string }): boolean {
  if (!forced) {
    return false;
  }
  logger.error({
    msg: `handover ${verb}: FORCED past the unread-checks gate by ${hatchEnvVar({ suffix: "UNREAD_CHECKS" })}=1 — say so in the pull request`,
  });
  return true;
}
