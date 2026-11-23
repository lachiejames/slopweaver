/**
 * `slopweaver linear project` — the effectful shell. Every decision lives in `./projectCore.ts`; this file
 * resolves the home and token, routes the effect through the admit door, and performs the mutation.
 *
 * Same ordered contract `./run.ts` documents for `linear issue` — parse → validate → [dry-run stops here] →
 * token → ownership → door → reserve → mutate → read back → confirm → report — minus the description-hash
 * conflict guard: a project write is patch-shaped end to end, so there is no replace-body hazard to check.
 */
import { readFileSync } from "node:fs";
import { DEFAULT_GATES } from "../../../admit/door.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { linearToken } from "../../../config.js";
import { type LinearWriteApi, makeLinearWriteApi, type ReadProject } from "../../../corpus/linear/write.js";
import { logger } from "../../../lib/logger.js";
import { linkifyProjectFields } from "../../../outbound/linear/bareRefLinks.js";
import { compareStoredBody } from "../../../outbound/linear/fidelity.js";
import {
  confirmProject,
  ownershipOfProject,
  releaseObjectReservation,
  reserveProject,
} from "../../../outbound/linear/projectLedger.js";
import type { LinearProjectFields, LinearProjectForm } from "../../../outbound/linear/projectTypes.js";
import { retiredTeamGate } from "../../../outbound/linear/retiredTeams.js";
import { settledBeforeWire } from "../../../outbound/linear/sendFailure.js";
import { linearWritePrivacy } from "../../../outbound/linear/writePrivacy.js";
import type { BareRefContext } from "../../../outbound/linkify/bareRefs.js";
import { bareRefContext as bareRefContextFor } from "../../bareRefContext.js";
import { bareRefGateRefused } from "../../bareRefDoor.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { linearVerbErrorLines } from "./errors.js";
import {
  type LinearProjectArgs,
  type LinearProjectOutcome,
  parseLinearProjectArgs,
  parseLinearProjectForm,
  projectDoorRequestFor,
  projectDryRunLines,
  projectInputFor,
  projectOutcomeLines,
  projectWriteId,
} from "./projectCore.js";

/** Same offset `./run.ts` documents: node, script, noun, verb. */
const VERB_ARG_OFFSET = 4;

/** The injectable edges. A test supplies plain functions; nothing here is a mock. */
export interface LinearProjectWriteDeps {
  readonly readForm: (args: { source: string }) => string;
  /**
   * One environment variable, injected rather than read at the point of use — the bare-reference override
   * is a DECISION, and a decision reached through ambient state is one no test can make.
   */
  readonly env: (args: { name: string }) => string | undefined;
  /** What this write's bare `#N`/`SUP-123` references can resolve against — see `../../bareRefContext.js`. */
  readonly bareRefContext: (args: { home: string }) => BareRefContext;
  readonly resolveToken: (args: { home: string }) => string | undefined;
  readonly makeApi: (args: { home: string; token: string }) => LinearWriteApi;
  readonly nowIso: () => string;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  /** The door ledger the write's admit decision is recorded through. */
  readonly doorLedger: DoorLedgerPort;
}

/**
 * The live edges.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function productionLinearProjectWriteDeps(): LinearProjectWriteDeps {
  return {
    bareRefContext: ({ home }) => bareRefContextFor({ home }),
    doorLedger: doorLedgerPort(),
    env: ({ name }) => process.env[name],
    err: (line) => process.stderr.write(`linear project: ${line}\n`),
    makeApi: ({ home, token }) => makeLinearWriteApi({ privacy: linearWritePrivacy({ home }), token }),
    nowIso: () => new Date().toISOString(),
    out: (line) => {
      logger.out({ line });
    },
    readForm: ({ source }) => (source === "-" ? readFileSync(0, "utf8") : source),
    resolveToken: ({ home }) => linearToken({ home }),
  };
}

/** Print each line to stderr and return the code. */
function refuse({
  deps,
  lines,
  code,
}: {
  deps: LinearProjectWriteDeps;
  lines: readonly string[];
  code: number;
}): number {
  for (const line of lines) {
    deps.err(line);
  }
  return code;
}

/** Everything the effect phase needs, once the cheap checks have passed. */
interface ProjectWriteContext {
  readonly api: LinearWriteApi;
  readonly deps: LinearProjectWriteDeps;
  readonly home: string;
  readonly id: string;
  readonly fields: LinearProjectFields;
  readonly args: LinearProjectArgs;
}

/**
 * Ownership only — a project update sends nothing that could silently clobber prose, so there is no
 * description-hash comparison here the way `./issueWrite.ts`'s `updatePrecheck` needs for an issue.
 */
function updateBlocked({ ctx }: { ctx: ProjectWriteContext }): string | undefined {
  if (ctx.args.verb !== "update") {
    return undefined;
  }
  const ownership = ownershipOfProject({ home: ctx.home, id: ctx.id });
  return ownership.owned ? undefined : ownership.reason;
}

/** Reserve, mutate, read back, confirm. Runs ONLY when the door passed. */
async function performWrite({ ctx }: { ctx: ProjectWriteContext }): Promise<LinearProjectOutcome> {
  const reservedIso = ctx.args.verb === "create" ? ctx.deps.nowIso() : undefined;
  if (reservedIso !== undefined) {
    const claim = reserveProject({ home: ctx.home, id: ctx.id, nowIso: reservedIso });
    if (claim.kind === "taken") {
      return { kind: "duplicate", reservedIso: claim.record.reservedIso };
    }
  }
  const mutation =
    ctx.args.verb === "create"
      ? await ctx.api.createProject({ id: ctx.id, input: projectInputFor({ fields: ctx.fields }) })
      : await ctx.api.updateProject({ id: ctx.id, input: projectInputFor({ fields: ctx.fields }) });
  // Refused before the wire: nothing was sent, so a create's own reservation is released for the retry.
  const release = () => releaseObjectReservation({ home: ctx.home, id: ctx.id, kind: "linear-projects", reservedIso });
  if (mutation.isErr() && settledBeforeWire({ error: mutation.error, release })) {
    return { kind: "failed", reason: mutation.error.message };
  }
  if (mutation.isErr()) {
    return afterLostResponse({ ctx, reason: mutation._unsafeUnwrapErr().message });
  }
  const written = mutation._unsafeUnwrap();
  // The mutation's own response is not proof — `success: true` with a null project is a real API shape — so
  // the project is established by reading it back at the id we chose, same rigor `./issueWrite.ts` applies to issues.
  const readBack = await ctx.api.readProject({ id: ctx.id });
  if (readBack.isErr() || readBack._unsafeUnwrap() === undefined) {
    return { kind: "unconfirmed", project: written };
  }
  const found = readBack._unsafeUnwrap()!;
  confirmProject({ home: ctx.home, id: ctx.id, name: found.name, nowIso: ctx.deps.nowIso(), url: found.url });
  return {
    fidelity:
      ctx.fields.description === undefined
        ? undefined
        : compareStoredBody({ sent: ctx.fields.description, stored: found.description }),
    kind: "written",
    project: found,
  };
}

/**
 * A mutation that returned an error, settled the same way `./issueWrite.ts`'s `afterLostResponse` settles an issue:
 * a create's freshly-reserved id proves landing on its own; an update's pre-existing project proves nothing
 * by merely existing, so it needs the description to match what was sent.
 */
async function afterLostResponse({
  ctx,
  reason,
}: {
  ctx: ProjectWriteContext;
  reason: string;
}): Promise<LinearProjectOutcome> {
  const readBack = await ctx.api.readProject({ id: ctx.id });
  if (readBack.isErr()) {
    return { kind: "indeterminate", reason };
  }
  const found = readBack._unsafeUnwrap();
  if (found === undefined) {
    return ctx.args.verb === "create" ? { kind: "failed", reason } : { kind: "indeterminate", reason };
  }
  const landed = ctx.args.verb === "create" || updateProvenBy({ ctx, found });
  if (!landed) {
    return { kind: "indeterminate", reason };
  }
  confirmProject({ home: ctx.home, id: ctx.id, name: found.name, nowIso: ctx.deps.nowIso(), url: found.url });
  return {
    fidelity:
      ctx.fields.description === undefined
        ? undefined
        : compareStoredBody({ sent: ctx.fields.description, stored: found.description }),
    kind: "landedAfterError",
    project: found,
    reason,
  };
}

/** Whether a read-back PROVES an update applied. Deliberately strict, same posture as `./run.ts`. */
function updateProvenBy({ ctx, found }: { ctx: ProjectWriteContext; found: ReadProject }): boolean {
  const { leadId, statusId, targetDate, priority, labelIds, description } = ctx.fields;
  const unverifiable = [leadId, statusId, targetDate, priority, labelIds].some((value) => value !== undefined);
  if (unverifiable) {
    return false;
  }
  if (description !== undefined && found.description !== description) {
    return false;
  }
  return found.name === ctx.fields.name;
}

/** The exit code for an outcome. */
function codeFor({ outcome }: { outcome: LinearProjectOutcome }): number {
  if (outcome.kind === "written" || outcome.kind === "landedAfterError") {
    return EXIT_OK;
  }
  return outcome.kind === "failed" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY;
}

/** The retired-team gate over a project write's team set; the live write and the dry run both ask it. */
function projectRetiredTeamRefusals({
  args,
  deps,
  fields,
  home,
}: {
  args: LinearProjectArgs;
  deps: LinearProjectWriteDeps;
  fields: LinearProjectFields;
  home: string;
}): readonly string[] {
  return retiredTeamGate({
    command: `slopweaver linear project ${args.verb}`,
    env: deps.env,
    home,
    teamIds: fields.teamIds,
  });
}

/** The effect phase: token, ownership, door, write. */
async function runLive({
  args,
  deps,
  id,
  fields,
}: {
  args: LinearProjectArgs;
  deps: LinearProjectWriteDeps;
  id: string;
  fields: LinearProjectFields;
}): Promise<number> {
  const home = resolveHome({ named: args.home });
  const token = deps.resolveToken({ home });
  if (token === undefined) {
    return refuse({
      code: EXIT_EXPECTED_EMPTY,
      deps,
      lines: [`no Linear token for this home. Set LINEAR_API_KEY, or write ${home}/secrets/linear-token`],
    });
  }
  const retired = projectRetiredTeamRefusals({ args, deps, fields, home });
  if (retired.length > 0) {
    return refuse({ code: EXIT_EXPECTED_EMPTY, deps, lines: retired });
  }
  const ctx: ProjectWriteContext = { api: deps.makeApi({ home, token }), args, deps, fields, home, id };
  const blocked = updateBlocked({ ctx });
  if (blocked !== undefined) {
    return refuse({ code: EXIT_EXPECTED_EMPTY, deps, lines: [blocked] });
  }
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: () => performWrite({ ctx }),
    request: projectDoorRequestFor({ home, id, teamIds: fields.teamIds, verb: args.verb }),
  });
  if (!routed.performed) {
    return refuse({
      code: routed.kind === "recording-refused" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY,
      deps,
      lines: [...notPerformedLines({ command: "slopweaver linear project", through: routed })],
    });
  }
  for (const line of projectOutcomeLines({ outcome: routed.result, verb: args.verb })) {
    deps.out(line);
  }
  return codeFor({ outcome: routed.result });
}

/**
 * Resolve every `#N`/`owner/repo#N`/`SUP-123` in the project's own `description` into its bare URL —
 * `description` is plain text, never markdown, see `../../../outbound/linear/bareRefLinks.ts`'s
 * `linkifyProjectFields` — then refuse whatever still can't resolve. Same rule `./run.ts` enforces for an
 * issue body, see `../../bareRefDoor.ts`.
 *
 * @param args the parsed invocation, for the dry-run flag
 * @param issues the residue `linkifyProjectFields` already computed
 * @param deps the injected environment reader and output sink
 * @param home the state home this invocation resolved, whose grant journal decides the hatch
 * @returns true when the write must refuse
 */
function bareRefRefused({
  args,
  issues,
  deps,
  home,
}: {
  args: LinearProjectArgs;
  issues: readonly { readonly path: readonly (string | number)[]; readonly message: string }[];
  deps: LinearProjectWriteDeps;
  home: string;
}): boolean {
  return bareRefGateRefused({
    dryRun: args.dryRun,
    env: deps.env,
    home,
    issues: issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    out: ({ line }) => {
      deps.out(line);
    },
  });
}

/**
 * Run `linear project <create|update>`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export async function runLinearProject({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: LinearProjectWriteDeps;
}): Promise<number> {
  const parsed = parseLinearProjectArgs({ argv: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: linearVerbErrorLines({ error: parsed.error }) });
  }
  const args = parsed.value;
  const form = parseLinearProjectForm({ raw: deps.readForm({ source: args.formSource }) });
  if (form.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: linearVerbErrorLines({ error: form.error }) });
  }
  // The id is computed from the ORIGINAL form — mirroring `./run.ts`'s issue path, not `./projectUpdateRun.ts`'s
  // report path — so the same authored content always maps to the same project id regardless of whether the
  // invoking checkout happens to have a resolvable git remote right now.
  const id = projectWriteId({ args, form: form.value });
  const home = resolveHome({ named: args.home });
  const linkified = linkifyProjectFields({ context: deps.bareRefContext({ home }), fields: form.value.fields });
  const linkedForm: LinearProjectForm = { fields: linkified.fields };
  if (args.dryRun) {
    // The live write's retired-team gate, previewed, so a dry run says what the write would be told.
    const retired = projectRetiredTeamRefusals({ args, deps, fields: linkedForm.fields, home });
    for (const line of [...projectDryRunLines({ form: linkedForm, id }), ...retired]) {
      deps.out(line);
    }
    const bareRefs = bareRefRefused({ args, deps, home, issues: linkified.issues });
    return bareRefs || retired.length > 0 ? EXIT_ERROR : EXIT_OK;
  }
  if (bareRefRefused({ args, deps, home, issues: linkified.issues })) {
    return EXIT_ERROR;
  }
  return runLive({ args, deps, fields: linkedForm.fields, id });
}

/** `slopweaver linear project` — create or update a Linear project through the door-gated pattern. */
export const linearProjectCommand = defineCommand({
  run: (argv: readonly string[]) => runLinearProject({ argv, deps: productionLinearProjectWriteDeps() }),
});
