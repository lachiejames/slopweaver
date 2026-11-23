/**
 * `slopweaver linear team-membership join|leave` — the effectful shell. Every decision lives in
 * `./teamMembershipCore.ts`; this file resolves the home and token, reads where the viewer stands, and, only
 * under `--apply`, routes the write through the admit door, reads the memberships back and journals the act.
 *
 * Read → preview → (apply) door → mutate → read back → report → journal. There is no reservation: the
 * pre-write read IS the idempotence, because joining a team the viewer is on, or leaving one it is not on,
 * sends nothing.
 */
import { DEFAULT_GATES } from "../../../admit/door.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { type AutonomyLedgerPort, autonomyLedgerPort } from "../../../autonomy/port.js";
import { linearToken } from "../../../config.js";
import {
  type LinearTeamMembershipWriteApi,
  makeLinearTeamMembershipWriteApi,
} from "../../../corpus/linear/writeTeamMembership.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import type { LinearLiveError } from "../../../live/linear/errors.js";
import { linearStatesRequest } from "../../../live/linear/states.js";
import {
  type LinearMembershipState,
  readLinearMembershipState,
  readViewerMembershipId,
} from "../../../live/linear/teamMembership.js";
import { linearWritePrivacy } from "../../../outbound/linear/writePrivacy.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { linearVerbErrorLines } from "./errors.js";
import {
  type MembershipOutcome,
  membershipDoorRequestFor,
  membershipOutcomeLines,
  membershipPreviewLines,
  membershipRow,
  membershipWouldChange,
  parseTeamMembershipArgs,
  type TeamMembershipArgs,
} from "./teamMembershipCore.js";
import { unaskedNoteRefusal } from "./unasked.js";

/** Same offset `./run.ts` documents: node, script, noun, verb. */
const VERB_ARG_OFFSET = 4;

/** The injectable edges. A test supplies plain functions; nothing here is a mock. */
export interface TeamMembershipDeps {
  readonly resolveToken: (args: { home: string }) => string | undefined;
  readonly readState: (args: {
    token: string;
    teamKey: string;
  }) => Promise<Result<LinearMembershipState, LinearLiveError>>;
  readonly readMembershipId: (args: {
    token: string;
    teamId: string;
  }) => Promise<Result<string | undefined, LinearLiveError>>;
  readonly makeApi: (args: { home: string; token: string }) => LinearTeamMembershipWriteApi;
  readonly nowIso: () => string;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  /** The autonomy ledger an `--unasked` act records its row in. */
  readonly autonomy: AutonomyLedgerPort;
  /** The door ledger the write's admit decision is recorded through. */
  readonly doorLedger: DoorLedgerPort;
}

/**
 * The live edges.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function productionTeamMembershipDeps(): TeamMembershipDeps {
  return {
    autonomy: autonomyLedgerPort(),
    doorLedger: doorLedgerPort(),
    err: (line) => process.stderr.write(`linear team-membership: ${line}\n`),
    makeApi: ({ home, token }) => makeLinearTeamMembershipWriteApi({ privacy: linearWritePrivacy({ home }), token }),
    nowIso: () => new Date().toISOString(),
    out: (line) => {
      logger.out({ line });
    },
    readMembershipId: ({ token, teamId }) =>
      readViewerMembershipId({ request: linearStatesRequest({ token }), teamId }),
    readState: ({ token, teamKey }) => readLinearMembershipState({ request: linearStatesRequest({ token }), teamKey }),
    resolveToken: ({ home }) => linearToken({ home }),
  };
}

/** Everything the write needs once the door has passed. */
interface MembershipWrite {
  readonly args: TeamMembershipArgs;
  readonly deps: TeamMembershipDeps;
  readonly state: LinearMembershipState;
  readonly token: string;
}

/**
 * Send the join or leave, then judge it by reading the viewer's memberships back. Runs ONLY when the door
 * passed.
 *
 * @param write the write's arguments, edges and the state it was previewed from
 * @param home the resolved state home, whose privacy policy judges the mutation
 * @returns what the read-back established
 */
async function performMembership({
  write,
  home,
}: {
  write: MembershipWrite;
  home: string;
}): Promise<MembershipOutcome> {
  const { args, deps, state, token } = write;
  const api = deps.makeApi({ home, token });
  const mutation =
    args.action === "join"
      ? (await api.join({ teamId: state.team.id, userId: state.viewer.id })).map(() => true)
      : await api.leave({ membershipId: state.membershipId! });
  const readBack = await deps.readMembershipId({ teamId: state.team.id, token });
  const changed = readBack.map((id) => (args.action === "join" ? id !== undefined : id === undefined));
  if (mutation.isOk()) {
    if (readBack.isErr()) {
      return { kind: "unconfirmed", reason: `the read-back failed: ${readBack.error.message}` };
    }
    return changed._unsafeUnwrap()
      ? { kind: "written" }
      : { kind: "unconfirmed", reason: "the viewer's memberships still read unchanged" };
  }
  const reason = mutation.error.message;
  if (readBack.isErr()) {
    return { kind: "indeterminate", reason };
  }
  return changed._unsafeUnwrap() ? { kind: "landed", reason } : { kind: "failed", reason };
}

/** The exit code for an outcome. */
function codeFor({ outcome }: { outcome: MembershipOutcome }): number {
  if (outcome.kind === "written" || outcome.kind === "landed") {
    return EXIT_OK;
  }
  return outcome.kind === "failed" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY;
}

/**
 * Write the autonomy row for an `--unasked` act, or say why it could not be written.
 *
 * @param write the write that was attempted
 * @param home the resolved state home
 * @param outcome what the read-back established
 * @returns an exit code that overrides the write's own, or undefined when the write's own stands
 */
async function journal({
  write,
  home,
  outcome,
}: {
  write: MembershipWrite;
  home: string;
  outcome: MembershipOutcome;
}): Promise<number | undefined> {
  const note = write.args.unasked;
  if (note === undefined || outcome.kind === "failed") {
    return undefined;
  }
  const doneIso = write.deps.nowIso();
  const built = membershipRow({ action: write.args.action, doneIso, note, outcome, state: write.state });
  if (built.isErr()) {
    return unrecorded({ message: built.error.message, write });
  }
  const row = built.value;
  const written = await write.deps.autonomy.appendRecord({ home, record: row });
  if (written.isErr()) {
    return unrecorded({ message: written.error.message, write });
  }
  write.deps.out(`autonomy: ${row.actionId} ${written.value.appended ? "recorded" : "already recorded"} (${row.kind})`);
  return undefined;
}

/**
 * Say that the act stands with no ledger row, and print the command that records it by hand.
 *
 * @param write the write that was attempted
 * @param message why the row did not record
 * @returns the exit code that overrides the write's own
 */
function unrecorded({ write, message }: { write: MembershipWrite; message: string }): number {
  write.deps.err(`autonomy: the ${write.args.action} stands but its ledger row did NOT record: ${message}`);
  write.deps.err(
    `record it by hand: slopweaver autonomy record --action-id <id> --kind linear-team-${write.args.action} ` +
      `--subject ${write.state.viewer.url} --by-session <session> --why <why> --said <said> --witness <what happened>`,
  );
  return EXIT_ERROR;
}

/**
 * Run `linear team-membership join|leave`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export async function runLinearTeamMembership({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: TeamMembershipDeps;
}): Promise<number> {
  const parsed = parseTeamMembershipArgs({ argv: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    for (const line of linearVerbErrorLines({ error: parsed.error })) {
      deps.err(line);
    }
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const noteRefusal =
    args.unasked === undefined
      ? undefined
      : unaskedNoteRefusal({ doneIso: deps.nowIso(), kind: `linear-team-${args.action}`, note: args.unasked });
  if (noteRefusal !== undefined) {
    deps.err(noteRefusal);
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: args.home });
  const token = deps.resolveToken({ home });
  if (token === undefined) {
    deps.err(`no Linear token for this home. Set LINEAR_API_KEY, or write ${home}/secrets/linear-token`);
    return EXIT_EXPECTED_EMPTY;
  }
  const state = await deps.readState({ teamKey: args.teamKey, token });
  if (state.isErr()) {
    deps.err(state.error.message);
    return EXIT_ERROR;
  }
  for (const line of membershipPreviewLines({ action: args.action, apply: args.apply, state: state.value })) {
    deps.out(line);
  }
  if (!membershipWouldChange({ action: args.action, state: state.value })) {
    return EXIT_EXPECTED_EMPTY;
  }
  if (!args.apply) {
    return EXIT_OK;
  }
  return applyMembership({ home, write: { args, deps, state: state.value, token } });
}

/**
 * The `--apply` phase: route the write through the door, print what the read-back established, journal it.
 *
 * @param write the previewed write that would change something
 * @param home the resolved state home
 * @returns the process exit code
 */
async function applyMembership({ write, home }: { write: MembershipWrite; home: string }): Promise<number> {
  const { args, deps, state } = write;
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: () => performMembership({ home, write }),
    request: membershipDoorRequestFor({ action: args.action, home, state }),
  });
  if (!routed.performed) {
    for (const line of notPerformedLines({ command: "slopweaver linear team-membership", through: routed })) {
      deps.err(line);
    }
    return routed.kind === "recording-refused" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY;
  }
  for (const line of membershipOutcomeLines({ action: args.action, outcome: routed.result, teamKey: args.teamKey })) {
    deps.out(line);
  }
  const journalled = await journal({ home, outcome: routed.result, write });
  if (journalled !== undefined) {
    return journalled;
  }
  return codeFor({ outcome: routed.result });
}

/** `slopweaver linear team-membership` — join or leave a team as the token's own user, preview by default. */
export const linearTeamMembershipCommand = defineCommand({
  run: (argv: readonly string[]) => runLinearTeamMembership({ argv, deps: productionTeamMembershipDeps() }),
});
