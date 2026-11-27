/**
 * The past-the-cap refusal — the CLI shell's half of the two-pass cap, whose pure decision is
 * `../../../codex/reviewPassCap.ts`.
 *
 * Asked by BOTH ways a review can be taken, before anything is spent: `codex review` before its fan-out reads a
 * fleet, and `codex review-fallback prepare` before it writes a request that would send a visible Claude
 * session to review the diff. The cap is on review, never on a provider, so the two read one fold — Codex rows
 * and Claude fallback receipts together, through `./branchLedgerRead.ts`, the fold `codex status` and the
 * landing floor read.
 *
 * The caller names the review's LANE, and the count is that lane's alone (`../../../codex/reviewLane.ts`):
 * `codex review` learns it from `./reviewLaneRead.ts` before asking here, and a fallback review is always
 * general. A witness is announced and refused in its own words, never as a general pass.
 *
 * ## A fold it cannot read refuses, as the landing floor does
 *
 * Unlike the duplicate gate (`../../../codex/passAdmission.ts`), which lets a pass run on an unreadable record,
 * this one fails closed. An unreadable fold cannot say this diff is within the cap. Refusing costs nothing a
 * fail-open would have bought: `../../../codex/landingGateRun.ts` reads the same three sources and refuses to land
 * on any one it cannot read, so a review run then could not land the change either.
 * `SLOPWEAVER_ALLOW_CODEX_REVIEW_PASS_CAP=1` runs it anyway, and says so — that unreadable fold is the ONLY thing the
 * hatch opens.
 *
 * ## Past the cap: the pinned supervisor's extension, never the owner's card
 *
 * A pass past the cap is a supervisor-approved extension, and reaches the owner only when the approach itself
 * carries a big trade-off. A diff past the cap runs only when the pinned supervisor recorded `codex extend` for
 * THAT diff, in this lane, on this branch of this repository (`../../../codex/passExtension.ts`), and the row's
 * grantor is the session holding the pin in this same home; the refusal prints the diff's full sha256 so a seat
 * can name it in its one line to the supervisor, and the admitted line names the row it ran on, by id. The
 * register is read fail-SAFE: a row that will not decode, a register that will not read, a pin that is absent or
 * will not read, or a row whose grantor does not hold the pin approves nothing — that only ever refuses a pass a
 * row would have allowed — and the refusal says so. A grant made under one chair stops approving once the pin
 * moves, and the successor grants again. Past the cap is a HOLD: no variable opens it.
 *
 * ## What it does not close
 *
 * The check is a read before the spend with no lock, so two sessions starting reviews of two DIFFERENT new
 * diffs on one branch at the same instant can both see one pass and both run. A branch is one seat's, so that
 * is two seats on one branch, which the board already refuses; the residue is stated, not closed.
 */

import type { FallbackRegisterPort } from "../../../codex/fallbackPort.js";
import { resolveGitCommonDir } from "../../../codex/gitDiff.js";
import { approvalFor, type CodexPassExtension } from "../../../codex/passExtension.js";
import { readPassExtensions } from "../../../codex/passExtensionStore.js";
import type { ReviewLane } from "../../../codex/reviewLane.js";
import { LANE_PASS_CAP, reviewCapDecision } from "../../../codex/reviewPassCap.js";
import type { SupersessionPort } from "../../../codex/supersessionPort.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import { logger } from "../../../lib/logger.js";
import { isRegisteredSupervisor, supervisorPinLabel } from "../../../sessions/supervisorPin.js";
import { readSupervisorPinDisposition } from "../../../sessions/supervisorPinStore.js";
import { readBranchLedger } from "./branchLedgerRead.js";

/** The break-glass variable that runs a review past its cap anyway — named in the refusal, asserted by its test. */
export const ALLOW_CODEX_REVIEW_PASS_CAP_ENV = "SLOPWEAVER_ALLOW_CODEX_REVIEW_PASS_CAP";

/** What the cap says about one review about to run: whether it is refused, and the lines to print on stderr. */
export interface ReviewCapVerdict {
  readonly refused: boolean;
  readonly lines: readonly string[];
}

/** The leading digits of a sha256, enough for a reader to tell two diffs apart. */
const SHORT = 12;

/** What one pass in each lane is called, so a witness is never announced as a general pass. */
const PASS_NOUN: Readonly<Record<ReviewLane, string>> = {
  "baseline-bump-witness": "baseline-bump witness pass",
  general: "review pass",
};

/**
 * Whether a review of this diff would be past its lane's cap on its branch with no extension approving it.
 *
 * @param lane the lane admission put the review in (`./reviewLaneRead.ts`); a fallback review is always general
 * @param branch the branch the diff's tree was captured on — `null` on a detached HEAD and `undefined` when the
 *   checkout moved mid-capture; either way the review lands on no branch's count, so nothing is refused
 * @param diff the frozen diff about to be reviewed, and the checkout it came from
 * @param env the environment {@link ALLOW_CODEX_REVIEW_PASS_CAP_ENV} is read from — `process.env` in the verbs
 * @param fallbackPort where the Claude fallback receipts are read — they spend the same two passes
 * @param home the state home holding the pass records and the supervisor-approved extensions
 * @param supersessions the register of retired passes, read with the fold (a retirement spends no pass back)
 * @param verb the verb asking, so every line it prints names it
 * @returns refused with the four-line refusal, or allowed with the line saying which pass this is
 */
export async function reviewCapVerdict({
  branch,
  diff,
  env,
  fallbackPort,
  home,
  lane,
  supersessions,
  verb,
}: {
  branch: string | null | undefined;
  diff: { readonly repoRoot: string; readonly sha256: string };
  env: Readonly<Record<string, string | undefined>>;
  fallbackPort: FallbackRegisterPort;
  home: string;
  lane: ReviewLane;
  supersessions: SupersessionPort;
  verb: string;
}): Promise<ReviewCapVerdict> {
  if (branch == null) {
    return { lines: [], refused: false };
  }
  const ledger = await readBranchLedger({ branch, fallbackPort, home, repoRoot: diff.repoRoot, supersessions });
  const hatchOpen = env[ALLOW_CODEX_REVIEW_PASS_CAP_ENV] === "1";
  if (ledger.isErr()) {
    return unreadableFoldVerdict({ branch, hatchOpen, reason: ledger.error.message, verb });
  }
  const approval = readApproval({ branch, diffSha256: diff.sha256, home, lane, repoRoot: diff.repoRoot });
  const decision = reviewCapDecision({
    approvedPastCap: approval.row !== undefined,
    candidateDiffSha256: diff.sha256,
    entries: ledger.value,
    lane,
  });
  if (decision.kind === "capped") {
    return pastCapVerdict({
      branch,
      diffSha256: diff.sha256,
      extensionNote: approval.note,
      lane,
      reviewed: decision.reviewed,
      verb,
    });
  }
  return admittedVerdict({ branch, lane, pass: decision.pass, pastCap: decision.pastCap, row: approval.row, verb });
}

/**
 * The one line an admitted review prints: which pass it is, and past the cap, the extension that approved it.
 *
 * @param pass the pass number this review takes on its branch's lane
 * @param pastCap whether that pass is beyond the lane's cap
 * @param row the extension approving this exact diff — absent past the cap only for a diff already reviewed
 * @returns the allowed verdict carrying that line
 */
function admittedVerdict({
  branch,
  lane,
  pass,
  pastCap,
  row,
  verb,
}: {
  branch: string;
  lane: ReviewLane;
  pass: number;
  pastCap: boolean;
  row: CodexPassExtension | undefined;
  verb: string;
}): ReviewCapVerdict {
  const base = LANE_PASS_CAP[lane];
  if (!pastCap) {
    return { lines: [`${verb}: ${PASS_NOUN[lane]} ${String(pass)} of ${String(base)} on ${branch}`], refused: false };
  }
  const extendedBy =
    row === undefined
      ? ", a diff already reviewed past the cap"
      : `, extension ${row.id} by the pinned supervisor for run ${row.run}: ${row.reason}`;
  return {
    lines: [`${verb}: ${PASS_NOUN[lane]} ${String(pass)} on ${branch}, past its cap of ${String(base)}${extendedBy}`],
    refused: false,
  };
}

/** The extension approving one diff, if any, and a sentence when some of the register went unread. */
interface DiffApproval {
  readonly row: CodexPassExtension | undefined;
  /** Set when the register or the repository could not be fully read, so an approval may have been missed. */
  readonly note: string | undefined;
}

/**
 * Read the supervisor-approved extension for this exact diff in one lane on one branch of the diff's repository.
 *
 * Fail-safe: whatever cannot be read approves nothing, and the note says so for the refusal to carry.
 *
 * @param repoRoot the checkout the diff came from, whose repository the row must name
 * @param diffSha256 the full sha256 of the diff about to be reviewed
 * @returns the approving row, or none, and the note when anything was unread
 */
function readApproval({
  branch,
  diffSha256,
  home,
  lane,
  repoRoot,
}: {
  branch: string;
  diffSha256: string;
  home: string;
  lane: ReviewLane;
  repoRoot: string;
}): DiffApproval {
  const register = readPassExtensions({ home });
  if (register.isErr()) {
    return { note: `${register.error.message}, so no extension was read`, row: undefined };
  }
  const { unreadable } = register.value;
  const unreadNote =
    unreadable.length === 0
      ? undefined
      : `${String(unreadable.length)} pass-extension row(s) would not decode and approve nothing (${unreadable.map((line) => line.detail).join("; ")})`;
  const named = register.value.rows.filter(
    (row) => row.branch === branch && row.lane === lane && row.diffSha256 === diffSha256,
  );
  if (named.length === 0) {
    return { note: unreadNote, row: undefined };
  }
  const granted = grantedByThePin({ home, rows: named });
  if (granted.rows.length === 0) {
    return { note: granted.note, row: undefined };
  }
  const candidates = granted.rows;
  // Only a diff some row names pays for the git call that says which repository this checkout is.
  const gitCommonDir = resolveGitCommonDir({ cwd: repoRoot });
  if (gitCommonDir.isErr()) {
    return { note: `which repository ${repoRoot} is could not be read, so no extension was read`, row: undefined };
  }
  return {
    note: unreadNote,
    row: approvalFor({ branch, diffSha256, gitCommonDir: gitCommonDir.value, lane, rows: candidates }),
  };
}

/**
 * The rows the session holding the supervisor pin — in THIS home, the one the gate reads — granted. A row is only as
 * good as its grantor: one minted under a caller-chosen `--home` whose pin named the caller, and carried into this
 * register some other way, names a grantor this pin does not, and approves nothing. A pin that is absent or will
 * not read approves no row at all.
 *
 * @param rows the rows naming this diff on this branch and lane
 * @returns the rows the pinned supervisor granted, and a note when any were set aside
 */
function grantedByThePin({ home, rows }: { home: string; rows: readonly CodexPassExtension[] }): {
  readonly rows: readonly CodexPassExtension[];
  readonly note: string | undefined;
} {
  const pin = readSupervisorPinDisposition({ home });
  if (pin.kind === "absent") {
    return { note: "no supervisor pin is recorded, so no extension's grantor can be shown to hold it", rows: [] };
  }
  if (pin.kind === "unreadable") {
    return { note: `${pin.why}, so no extension's grantor can be shown to hold it`, rows: [] };
  }
  const kept = rows.filter((row) => isRegisteredSupervisor({ record: pin.record, session: row.grantedBy }));
  if (kept.length === rows.length) {
    return { note: undefined, rows: kept };
  }
  return {
    note:
      `${String(rows.length - kept.length)} extension row(s) naming this diff were granted by a session that does ` +
      `not hold the supervisor pin (${supervisorPinLabel({ pin: pin.record })}) and approve nothing`,
    rows: kept,
  };
}

/**
 * The verdict when the branch's fold could not be read: refused, since an unreadable fold cannot say this diff is
 * within the cap, unless the hatch runs it anyway.
 *
 * @param reason why the fold could not be read
 * @returns the verdict and its lines
 */
function unreadableFoldVerdict({
  branch,
  hatchOpen,
  reason,
  verb,
}: {
  branch: string;
  hatchOpen: boolean;
  reason: string;
  verb: string;
}): ReviewCapVerdict {
  if (hatchOpen) {
    return {
      lines: [
        `${verb}: the two-pass review cap could not be checked (${reason}), and ${ALLOW_CODEX_REVIEW_PASS_CAP_ENV}=1 runs this review anyway — say why in the pull request`,
      ],
      refused: false,
    };
  }
  return {
    lines: hatchRefusalLines({
      detail:
        `which review pass this diff would be on ${branch} cannot be told, so it might be past the cap: ` +
        `${reason} — the landing floor refuses on the same read, so repair it first`,
      hatch: hatchFor({ id: "codex-review-pass-cap" }),
    }),
    refused: true,
  };
}

/**
 * The verdict on a review past its lane's cap that no extension approves: a HOLD. No variable opens it — a pass past
 * the cap is the pinned supervisor's to approve, so a hatch any session could set would be the self-grant the
 * extension exists to refuse — and the lines say so rather than leave the absence to read as a forgotten hatch.
 *
 * @internal exported so its test can pin the witness lane's refusal, which no fallback receipt can reach.
 * @param reviewed the diffs the lane's passes already reviewed, oldest first
 * @param extensionNote set when some of the register went unread, so an approval may have been missed
 * @returns the verdict and its lines
 */
export function pastCapVerdict({
  branch,
  diffSha256,
  extensionNote,
  lane,
  reviewed,
  verb,
}: {
  branch: string;
  diffSha256: string;
  extensionNote: string | undefined;
  lane: ReviewLane;
  reviewed: readonly string[];
  verb: string;
}): ReviewCapVerdict {
  const base = String(LANE_PASS_CAP[lane]);
  const diffs = reviewed.map((digest) => `${digest.slice(0, SHORT)}…`).join(", ");
  const unread = extensionNote === undefined ? "" : ` (${extensionNote})`;
  return {
    lines: [
      `${verb}: PAST THE CAP — ${branch} has had ${String(reviewed.length)} ${PASS_NOUN[lane]}es (diffs ${diffs}) ` +
        `against a cap of ${base}, and no extension by the pinned supervisor approves this diff, ${diffSha256}${unread}.`,
      `The way on: ${PAST_CAP_WAY_ON[lane]}.`,
      "This hold has no escape hatch: a pass past the cap is the pinned supervisor's to approve, and a variable any " +
        `session could set would be a seat granting itself one. ${ALLOW_CODEX_REVIEW_PASS_CAP_ENV} opens only a ` +
        "fold that cannot be read.",
    ],
    refused: true,
  };
}

/** The supervisor's way past the cap, which every lane's refusal names first. */
const SUPERVISOR_EXTENSION =
  "send the pinned supervisor one line naming the run, this diff and why; only it records " +
  "`slopweaver codex extend --run <slug> --diff <sha256> --lane";

/** What a capped lane's refusal tells the session to do next. */
const PAST_CAP_WAY_ON: Readonly<Record<ReviewLane, string>> = {
  "baseline-bump-witness":
    `${SUPERVISOR_EXTENSION} baseline-bump-witness --reason "<why>"\`, since baseline-bump-unwitnessed has no ` +
    "landing acknowledgement",
  general:
    `${SUPERVISOR_EXTENSION} general --reason "<why>"\`, or land it with every finding still standing ` +
    "acknowledged as codex-loop-incomplete with a --reason (`codex status --check` prints each one)",
};

/**
 * {@link reviewCapVerdict}, printed — the one call each review verb makes before it spends.
 *
 * @returns true when the review is refused and must not run
 */
export async function refusedByReviewCap(args: Parameters<typeof reviewCapVerdict>[0]): Promise<boolean> {
  const verdict = await reviewCapVerdict(args);
  for (const line of verdict.lines) {
    if (verdict.refused) {
      logger.error({ msg: line });
    } else {
      logger.info({ msg: line });
    }
  }
  return verdict.refused;
}
