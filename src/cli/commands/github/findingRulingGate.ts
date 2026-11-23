/**
 * The team-facing doors' finding gate — the effectful shell around `../../../handover/findingGate.js`.
 *
 * Reads the board and each finding row's run journal from the state home, so the two doors that reach a
 * teammate (`github stack push` on a team-reviewed base, `github pr request-review`) can refuse a branch
 * whose row is a fleet finding the owner has not yet ruled on. The board is read from `home` directly rather than
 * through an injected dep: it is plain filesystem state, a test supplies a temp home with a real row in it,
 * and an empty or absent handovers directory is an empty board — never an error — so a home with no rows
 * leaves every door exactly as open as it was before this gate existed.
 *
 * The one failure that is NOT silent: a board that exists but cannot be read. That is reported and refused,
 * because "could not read the board" and "no finding claims this branch" must never print the same thing.
 */
import { createHash } from "node:crypto";

import { err, ok, type Result } from "#lib/result.js";

import type { AutonomyError } from "../../../autonomy/errors.js";
import { isAutonomyActionId } from "../../../autonomy/fields.js";
import type { AutonomyLedgerPort } from "../../../autonomy/port.js";
import { findAutonomyAction, foldAutonomy } from "../../../autonomy/query.js";
import { buildAutonomyAction } from "../../../autonomy/row.js";
import { AUTONOMY_ACTION_ID_MAX, type AutonomyActionRow } from "../../../autonomy/types.js";
import { actOwnContext, qualifyActProse } from "../../../briefing/qualifyActRefs.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import { findingGateLines, findingGateVerdict } from "../../../handover/findingGate.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { currentSessionIds } from "../../../handover/runOwner.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { scanBoard } from "../../../handover/store.js";
import { resolveSelfRepository } from "../../../organisation/read.js";
import { stateHomePaths } from "../../../stateHome.js";

/**
 * Every row on the board, and each finding row's whole run journal, read from the state home.
 *
 * The whole journal, not the branch it names: the owner's ruling lives in the same register, so reducing a journal to
 * a string here would discard the evidence the finding gate reads. A finding row whose journal will not read keeps
 * only its declared branch and slug to match on, exactly as the gate has always read it.
 *
 * @param home the state home the board lives under
 * @returns the rows and journals, or the board directory that could not be read and why
 */
export function readFindingBoard({ home }: { home: string }): Result<
  {
    readonly docs: readonly HandoverDoc[];
    readonly journals: ReadonlyMap<string, readonly RunEvent[]>;
  },
  { readonly handovers: string; readonly why: string }
> {
  const paths = stateHomePaths({ home });
  const scan = scanBoard({ handoverDir: paths.handovers });
  if (scan.isErr()) {
    return err({ handovers: paths.handovers, why: scan.error.message });
  }
  const journals = new Map<string, readonly RunEvent[]>();
  for (const doc of scan.value.docs.filter((row) => row.origin === "finding")) {
    const journal = readRunJournal({ runsDir: paths.runs, slug: doc.slug });
    if (journal.isOk()) {
      journals.set(doc.slug, journal.value.events);
    }
  }
  return ok({ docs: scan.value.docs, journals });
}

/**
 * Whether a team-facing door must refuse this head branch, printing why.
 *
 * @param home the state home the board lives under
 * @param head the head branch the door is about to act on
 * @param action what the door was about to do, in its own words, for the refusal line
 * @param out where to print each line
 * @param internal whether this door reaches nobody but the owner — see {@link createFindingGateRefused}
 * @returns `true` when the caller must refuse, `false` when it may proceed
 */
export async function findingRulingGateRefused({
  autonomy,
  home,
  head,
  action,
  out,
  internal = false,
}: {
  autonomy: AutonomyLedgerPort;
  home: string;
  head: string;
  action: string;
  out: (args: { line: string }) => void;
  internal?: boolean;
}): Promise<boolean> {
  const board = readFindingBoard({ home });
  if (board.isErr()) {
    out({ line: `refused: finding gate could not read the board at ${board.error.handovers}: ${board.error.why}` });
    return true;
  }
  const { docs, journals } = board.value;
  const verdict = findingGateVerdict({ branch: head, docs, internal, journals });
  const printed = findingGateLines({ action, verdict });
  for (const line of printed.lines) {
    out({ line });
  }
  if (verdict.kind !== "internal") {
    return printed.refused;
  }
  return internalRecordRefused({ action, autonomy, home, out, printed: printed.lines, row: verdict.row });
}

/**
 * The plain-words line the internal finding door records, written for the owner rather than for the next session.
 *
 * Deliberately says nothing the row's own slug already says. A line built out of the `why` below would name
 * the board slug, the doctrine rule and the observing session's id, none of which are words the owner
 * reads, and the drawer already prints the subject beside this line, so repeating the slug here would put an
 * unparsable half back. What is left is what the owner actually has to judge: the fleet acted on its own idea,
 * on a change only the owner ever sees, and undoing it costs a close.
 */
export const INTERNAL_FINDING_SAID =
  "I opened a pull request for a problem the fleet found itself, rather than one you asked about. " +
  "It only touches this repository and nobody outside this machine sees it, so if it was not worth " +
  "doing, say so and I will close it.";

/**
 * Write the autonomy-ledger row an internal door owes, and say whether the door must stay shut.
 *
 * THE RECORD IS THE CONDITION, not a side effect of having proceeded. What replaces the owner's
 * word here is this row, so a door that opened without writing one has removed the gate and put nothing in
 * its place. An unwritable register therefore refuses, which is recoverable — bring the store back, run it
 * again — where a silent pass is not.
 *
 * One row per finding, not one per push. The act the owner steers against is "this finding reached a pull request
 * on the owner's word never given"; a second `stack push` of the same branch — a rebase, a review round — is the same
 * act, so the id is derived from the row's slug and a register already holding it leaves the door open with
 * nothing written. Going through the autonomy ledger port rather than a private write is what makes the row
 * one `slopweaver autonomy list` shows and one the owner can `autonomy steer`.
 *
 * @param autonomy the autonomy ledger the row is written to
 * @param home the state home the register answers for
 * @param out where to print each line
 * @param row the finding row being acted on without the owner's word
 * @param action what the door was about to do, in its own words
 * @param printed the lines the gate printed, which are the row's witness
 * @returns `true` when the row could not be written and the caller must refuse
 */
async function internalRecordRefused({
  autonomy,
  home,
  out,
  row,
  action,
  printed,
}: {
  autonomy: AutonomyLedgerPort;
  home: string;
  out: (args: { line: string }) => void;
  row: HandoverDoc;
  action: string;
  printed: readonly string[];
}): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const actionId = internalFindingActionId({ slug: row.slug });
  const held = (await autonomy.readRecords({ home })).andThen((records) => foldAutonomy({ records }));
  if (held.isErr()) {
    return ledgerRefusal({ out, why: held.error.message });
  }
  if (findAutonomyAction({ actionId, actions: held.value }) !== undefined) {
    out({ line: `  already recorded as ${actionId} — nothing written` });
    return false;
  }
  const sessions = currentSessionIds({ env: process.env });
  let observedBy = "an unrecorded session";
  if (row.observedBy !== undefined) {
    observedBy = row.observedBy;
  }
  let evidence = "unrecorded evidence";
  if (row.evidence.length > 0) {
    evidence = row.evidence.join(", ");
  }
  const qualified = buildAutonomyAction({
    actionId,
    bySession: sessions.length === 0 ? "an unrecorded session" : sessions.join(", "),
    doneIso: nowIso,
    kind: "open-internal-finding-pull-request",
    run: row.slug,
    said: INTERNAL_FINDING_SAID,
    steer: undefined,
    subject: row.slug,
    why:
      `${row.slug} is an unruled fleet finding whose work reaches nobody but the owner, so rule 10 hands it to ` +
      `this session's judgement. Observed by ${observedBy} from ${evidence}.`,
    witness: `${action}: ${printed.map((line) => line.trim()).join(" · ")}`,
  }).andThen((act) => qualifyOwnReferences({ action: act }));
  if (qualified.isErr()) {
    return ledgerRefusal({ out, why: qualified.error.message });
  }
  const written = await autonomy.appendRecord({ home, record: qualified.value });
  if (written.isErr()) {
    return ledgerRefusal({ out, why: written.error.message });
  }
  out({ line: `  recorded as ${actionId} in the autonomy ledger` });
  return false;
}

/**
 * The act with every bare GitHub reference its own links resolve written as `owner/repo#N`, or the briefing's
 * own refusal for one that still renders as text.
 *
 * The `why` quotes the board row's evidence verbatim, which a session wrote for the board rather than for this
 * page — MEASURED, a bare reference beside a qualified `owner/repo#N` one reached the register this way and `briefing
 * check` refused every chair page on it, where `autonomy record` would have refused the act at its door. The
 * repository comes from the act's OWN rendered links, never a guess: a reference they cannot resolve shuts the
 * door, naming it, and the fix is to write that reference whole in the row's evidence.
 */
function qualifyOwnReferences({ action }: { action: AutonomyActionRow }): Result<AutonomyActionRow, AutonomyError> {
  return qualifyActProse({ action, context: actOwnContext({ action }) }).map((qualified) => qualified.action);
}

/** Print why the register refused the row, and the consequence: the door stays shut. */
function ledgerRefusal({ out, why }: { out: (args: { line: string }) => void; why: string }): boolean {
  out({ line: `refused: could not record the judgement in the autonomy ledger: ${why}` });
  out({ line: "  the ledger row IS what replaces the owner's word here, so a door that cannot write one stays shut" });
  return true;
}

/**
 * The act id an internal finding door records under — stable per row, so a retry is the same occurrence.
 *
 * A board slug may run to the register's whole id budget on its own, so a slug that will not fit behind the
 * prefix is cut to a slug boundary and suffixed with a digest of the full slug, which keeps two long rows
 * sharing a prefix apart. A slug may also carry capitals the register's id refuses — MEASURED,
 * `a-killed-doneWhen-probe-…` shut the door on its own pull request — so it is folded to the register's
 * alphabet first, and the digest is still taken over the slug as written.
 *
 * @param slug the finding row's slug
 * @returns an id `isAutonomyActionId` accepts
 */
export function internalFindingActionId({ slug }: { slug: string }): string {
  const prefix = "finding-pr.";
  const folded = slug
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/gu, "-")
    .replace(/([-.])[-.]+/gu, "$1")
    .replace(/^[-.]+/u, "");
  const candidate = `${prefix}${folded}`;
  if (candidate === `${prefix}${slug}` && isAutonomyActionId({ actionId: candidate })) {
    return candidate;
  }
  const digest = createHash("sha256").update(slug).digest("hex").slice(0, 8);
  const budget = AUTONOMY_ACTION_ID_MAX - prefix.length - digest.length - 1;
  const cut = folded.slice(0, budget).replace(/[-.]+$/u, "");
  if (cut === "") {
    return `${prefix}${digest}`;
  }
  return `${prefix}${cut}.${digest}`;
}

/**
 * The creation door's own use of the gate: a pull request on any base can reach a teammate, so every
 * creation is checked, and the board row is where the owner reads the finding.
 *
 * @param home the state home the board lives under
 * @param base the pull request's base branch
 * @param head the pull request's head branch
 * @param out where to print each line
 * @returns `true` when the caller must refuse, `false` when it may proceed
 */
export async function createFindingGateRefused({
  autonomy,
  home,
  base,
  head,
  out,
  owner,
  repo,
}: {
  autonomy: AutonomyLedgerPort;
  home: string;
  base: string;
  head: string;
  out: (args: { line: string }) => void;
  /** The pull request's repository owner, for the internal test. */
  owner?: string;
  /** The pull request's repository name, for the internal test. */
  repo?: string;
}): Promise<boolean> {
  const internal = owner !== undefined && repo !== undefined && isThisInstallsOwnRepository({ home, owner, repo });
  return findingRulingGateRefused({
    action: `open a pull request on ${base}`,
    autonomy,
    head,
    home,
    internal,
    out,
  });
}

/**
 * Whether a pull request's repository is the one THIS build of Slopweaver lives in.
 *
 * Resolved at runtime from the installed tree's own git remote rather than written into a constant: a
 * per-install slug belongs outside the codebase (`AGENTS.md`, "Tools in the codebase, state outside it"),
 * and a constant would also be wrong for anyone who forks this.
 *
 * An unresolvable remote answers FALSE, which keeps the team-facing behaviour — the honest failure
 * direction, since the cost of being wrong that way is one recorded ruling and the cost of being wrong the
 * other way is a finding reaching a teammate unseen.
 *
 * @param home the state home whose declared checkouts the self repository is judged against
 * @param owner the pull request's repository owner
 * @param repo the pull request's repository name
 * @returns whether it is this install's own repository
 */
function isThisInstallsOwnRepository({ home, owner, repo }: { home: string; owner: string; repo: string }): boolean {
  const mine = resolveSelfRepository({ home });
  if (mine.isErr()) {
    return false;
  }
  return mine.value === `${owner}/${repo}`.toLowerCase();
}
