/**
 * The doc's spawn plan for `cmux spawn`: every field the pure planner needs, read first — the pinned credential
 * store, the doc's model pin, the resolved launch template and the repository's worktrees.
 *
 * A leaf of `./run.ts` for the reason `./spawnPins.ts` and `./spawnTemplate.ts` are: `run.ts` is the verb's
 * decision tree, and this is the one call that gathers the planner's inputs, with no decision of its own.
 */
import { err, ok, type Result } from "#lib/result.js";

import { pinnedAccountAlias } from "../../../claude/config.js";
import type { ClaudeRotationError } from "../../../claude/errors.js";
import { seatForRole, storeDirForSeat } from "../../../claude/seatPinning.js";
import { readSpawnAccounts } from "../../../claude/spawnAccounts.js";
import type { LaunchTemplate } from "../../../cmux/launchTemplate.js";
import { planSpawn, type SpawnPlan } from "../../../cmux/plan.js";
import { classifySessionRole, type SessionRole } from "../../../cmux/role.js";
import type { CodexSeatRoute } from "../../../cmux/seatRoute.js";
import { listWorktrees } from "../../../cmux/worktree.js";
import { slopweaverHome } from "../../../config.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import type { RunEvent } from "../../../handover/ledger.js";
import type { PlanRegisterPort } from "../../../plans/port.js";
import { type AppContinuationPlan, continuingSessionOf } from "../../../sessionHarness/appContinuation.js";
import type { ParsedFlags } from "../../parseFlags.js";

import { spawnPickupLocation } from "./core.js";
import { resolveSpawnModel, type SpawnPins } from "./spawnPins.js";

/**
 * The credential store a spawning session should boot against, or undefined when it routes. Only a publisher
 * seat pins (`seatPinning.ts`): a supervisor handoff carries no store, so the spawn gate routes it as Fable.
 *
 * Reads the REGISTER and resolves the pinned destination, through the same `readSpawnAccounts` a spawn uses:
 * a second reader of the generated accounts file would pin against whatever projection was last written,
 * which is the disagreement the one register exists to end.
 *
 * Only an install with nothing Claude configured answers `ok(undefined)`, and the spawn then boots exactly as
 * it did before pinning existed. A register that could not be read — a store outage, an unreadable or invalid
 * configuration — is an `err`, and the caller STOPS before launch: answering undefined there would drop a
 * pinned seat's store and let it fall through to routing or the ambient credential, which is the collapse the
 * plan register's store move closes (the PR 1b plan, § Claude, `pinnedStoreDir`).
 *
 * @param home the Slopweaver home whose plan register is read — the one the seat boots under
 * @param role the spawning session's role
 * @param port where the plan register is read
 * @returns the store directory to pin to, `ok(undefined)` when this role is not pinned or nothing is
 *   configured, or why the configuration could not be read
 */
export async function pinnedStoreDir({
  home,
  port,
  role,
}: {
  home: string;
  port: PlanRegisterPort;
  role: SessionRole;
}): Promise<Result<string | undefined, ClaudeRotationError>> {
  const read = await readSpawnAccounts({ home, port });
  if (read.isErr()) {
    return err(read.error);
  }
  const accounts = read.value;
  if (accounts === undefined) {
    return ok(undefined);
  }
  const pinnedAlias = pinnedAccountAlias({ accounts });
  return ok(
    storeDirForSeat({
      accounts,
      seat: seatForRole({ role }),
      ...(pinnedAlias === undefined ? {} : { pinnedAlias }),
    }),
  );
}

/**
 * The store a claude seat boots against: an operator-named plan outranks the role's pin, the one choice routing and
 * pinning cannot overrule. The pin is read only when no plan was named, so a `--plan` spawn reads the register once.
 *
 * @param namedStore the store `--plan` named, or undefined to let the role's pin decide
 * @param port where the plan register is read, only when no plan was named
 * @returns the store directory, `ok(undefined)` when neither names one, or why the register could not be read
 */
async function chosenStoreDir({
  namedStore,
  port,
  role,
}: {
  namedStore: string | undefined;
  port: PlanRegisterPort;
  role: SessionRole;
}): Promise<Result<string | undefined, ClaudeRotationError>> {
  if (namedStore !== undefined) {
    return ok(namedStore);
  }
  return pinnedStoreDir({ home: slopweaverHome(), port, role });
}

/**
 * A spawn plan and the app session it continues: decided once, before routing, and carried to the launch so the act
 * it calls and the session a `launch.resume` names are the ones the Codex seat was routed for — never a second ledger
 * read at launch time, which could name a session the seat decision never saw.
 */
export type ContinuingSpawnPlan = SpawnPlan & {
  /** The app session a `launch.resume` names, or undefined when this spawn opens a new session. */
  readonly continuingAppSessionId: string | undefined;
};

/**
 * The doc's spawn plan, with every field the pure planner needs read first.
 *
 * Split out of `./spawnTarget.ts`'s `resolveSpawnTarget` purely to keep that function under the repo's max-function-lines
 * ratchet — the argument list here IS the planner's, not a second decision.
 *
 * @param codexSeat the routed codex seat, whose `$CODEX_HOME` the plan carries; undefined on a claude spawn. On a
 *   continuing Codex app seat it is the home the session opened on (`./codexSeat.ts`'s `resolveContinuingCodexSeat`)
 * @param continuation what the spawn decided about the slug's open app session, whose resumed id the plan carries
 * @param doc the handover doc being spawned
 * @param namedStore the store `--plan` named for a claude seat, which wins over the role's pin; undefined lets the
 * role pin or routing decide
 * @param pins the already-refused-or-not boot pins, carrying the driver and the optional `--effort` level
 * @param parsed the verb's parsed flags, for the `--model` pin and the `--dir`/`--home` the pickup line carries
 * @param port where the plan register is read for the role's pin
 * @param preflight the declared repo (the main checkout the worktree belongs to) and the doc's run journal, already read
 * @param template the launch template the seat boots from, already resolved and printed
 * @returns the plan, or why the role's pinned store could not be established — the caller stops before launch
 */
export async function buildSpawnPlan({
  codexSeat,
  continuation,
  doc,
  namedStore,
  parsed,
  pins,
  port,
  preflight,
  template,
}: {
  codexSeat: CodexSeatRoute | undefined;
  continuation: AppContinuationPlan;
  doc: HandoverDoc;
  namedStore: string | undefined;
  pins: SpawnPins;
  parsed: ParsedFlags;
  port: PlanRegisterPort;
  preflight: { readonly repo: string; readonly runEvents: readonly RunEvent[] };
  template: LaunchTemplate;
}): Promise<Result<ContinuingSpawnPlan, ClaudeRotationError>> {
  const role = classifySessionRole({ docRole: doc.role });
  const chosen = await chosenStoreDir({ namedStore, port, role });
  if (chosen.isErr()) {
    return err(chosen.error);
  }
  const credentialStoreDir = chosen.value;
  const plan = planSpawn({
    baseBranch: doc.baseBranch,
    // The routed Codex home travels as a plan field for the same reason `credentialStoreDir` does: the boot
    // line is built in one place, and only this caller reads the register.
    ...(codexSeat === undefined ? {} : { codexHome: codexSeat.destination.codexHome }),
    // A `--plan` (or a publisher pin) boots against a fixed credential store; any other seat, the supervisor
    // chair included, gets undefined and routes. Resolved here rather than in `planSpawn`, because only the
    // caller reads configuration.
    ...(credentialStoreDir === undefined ? {} : { credentialStoreDir }),
    declaredBranch: doc.branch,
    docPath: doc.path,
    docRole: role,
    driver: pins.driver,
    // Spread rather than assigned, so a spawn with no effort (passed or defaulted) sets no key at all and its
    // boot line stays byte-identical to the one this repo has always sent.
    ...(pins.effort === undefined ? {} : { effort: pins.effort }),
    model: resolveSpawnModel({ doc, parsed }),
    pickupLocation: spawnPickupLocation({ parsed }),
    repoRoot: preflight.repo,
    runEvents: preflight.runEvents,
    slug: doc.slug,
    spawnedAt: new Date().toISOString(),
    template,
    worktrees: listWorktrees({ repoRoot: preflight.repo }),
  });
  // A Codex seat's routed choice rides the plan to its ledger row; a Claude seat's is set later, by its credential gate.
  const seatChoice = codexSeat?.choice;
  return ok({
    ...plan,
    continuingAppSessionId: continuingSessionOf({ continuation }),
    ...(seatChoice === undefined ? {} : { planChoice: seatChoice }),
  });
}
