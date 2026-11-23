/**
 * `slopweaver linear milestone create` — the effectful shell. Every decision lives in `./milestoneCore.ts`;
 * this file resolves the home and token, routes the effect through the admit door, and performs the create.
 *
 * Simplest of the three write shells: create-only, so there is no ownership gate, no read-before-write
 * safety check — just reserve → mutate → read back → confirm → report, the same at-most-once shape
 * `./run.ts` and `./projectRun.ts` both prove.
 */
import { readFileSync } from "node:fs";
import { DEFAULT_GATES } from "../../../admit/door.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { linearToken } from "../../../config.js";
import { type LinearWriteApi, makeLinearWriteApi } from "../../../corpus/linear/write.js";
import { logger } from "../../../lib/logger.js";
import { linkifyMilestoneFields } from "../../../outbound/linear/bareRefLinks.js";
import { confirmMilestone, reserveMilestone } from "../../../outbound/linear/milestoneLedger.js";
import { releaseObjectReservation } from "../../../outbound/linear/projectLedger.js";
import type { LinearMilestoneFields, LinearMilestoneForm } from "../../../outbound/linear/projectTypes.js";
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
  type LinearMilestoneArgs,
  type LinearMilestoneOutcome,
  milestoneDoorRequestFor,
  milestoneDryRunLines,
  milestoneInputFor,
  milestoneIntentId,
  milestoneOutcomeLines,
  parseLinearMilestoneArgs,
  parseLinearMilestoneForm,
} from "./milestoneCore.js";

/** Same offset `./run.ts` documents: node, script, noun, verb. */
const VERB_ARG_OFFSET = 4;

/** The injectable edges. A test supplies plain functions; nothing here is a mock. */
export interface LinearMilestoneWriteDeps {
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
export function productionLinearMilestoneWriteDeps(): LinearMilestoneWriteDeps {
  return {
    bareRefContext: ({ home }) => bareRefContextFor({ home }),
    doorLedger: doorLedgerPort(),
    env: ({ name }) => process.env[name],
    err: (line) => process.stderr.write(`linear milestone: ${line}\n`),
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
  deps: LinearMilestoneWriteDeps;
  lines: readonly string[];
  code: number;
}): number {
  for (const line of lines) {
    deps.err(line);
  }
  return code;
}

/** Everything the effect phase needs, once the cheap checks have passed. */
interface MilestoneWriteContext {
  readonly api: LinearWriteApi;
  readonly deps: LinearMilestoneWriteDeps;
  readonly home: string;
  readonly id: string;
  readonly fields: LinearMilestoneFields;
}

/**
 * A mutation that returned an error. The freshly-reserved id proves a genuine create; anything found there
 * is what we asked for, same reasoning `./issueWrite.ts`'s `afterLostResponse` applies for an issue create.
 *
 * @param ctx the write context
 * @param reason the transport error the mutation returned
 * @returns what is actually known about the write
 */
async function afterLostResponse({
  ctx,
  reason,
}: {
  ctx: MilestoneWriteContext;
  reason: string;
}): Promise<LinearMilestoneOutcome> {
  const readBack = await ctx.api.readMilestone({ id: ctx.id });
  if (readBack.isErr()) {
    return { kind: "indeterminate", reason };
  }
  const found = readBack._unsafeUnwrap();
  if (found === undefined) {
    return { kind: "failed", reason };
  }
  confirmMilestone({ home: ctx.home, id: ctx.id, name: found.name, nowIso: ctx.deps.nowIso() });
  return { kind: "landed", milestone: found, reason };
}

/** Reserve, mutate, read back, confirm. Runs ONLY when the door passed. */
async function performWrite({ ctx }: { ctx: MilestoneWriteContext }): Promise<LinearMilestoneOutcome> {
  const reservedIso = ctx.deps.nowIso();
  const claim = reserveMilestone({ home: ctx.home, id: ctx.id, nowIso: reservedIso });
  if (claim.kind === "taken") {
    return { kind: "duplicate", reservedIso: claim.record.reservedIso };
  }
  const mutation = await ctx.api.createMilestone({ id: ctx.id, input: milestoneInputFor({ fields: ctx.fields }) });
  // Refused before the wire: nothing was sent, so this create's own reservation is released for the retry.
  const release = () =>
    releaseObjectReservation({ home: ctx.home, id: ctx.id, kind: "linear-milestones", reservedIso });
  if (mutation.isErr() && settledBeforeWire({ error: mutation.error, release })) {
    return { kind: "failed", reason: mutation.error.message };
  }
  if (mutation.isErr()) {
    return afterLostResponse({ ctx, reason: mutation._unsafeUnwrapErr().message });
  }
  const written = mutation._unsafeUnwrap();
  // The mutation's own response is not proof — same rigor `./run.ts` applies to an issue create — so the
  // milestone is established by reading it back at the id we chose.
  const readBack = await ctx.api.readMilestone({ id: ctx.id });
  if (readBack.isErr() || readBack._unsafeUnwrap() === undefined) {
    return { kind: "unconfirmed", milestone: written };
  }
  const found = readBack._unsafeUnwrap()!;
  confirmMilestone({ home: ctx.home, id: ctx.id, name: found.name, nowIso: ctx.deps.nowIso() });
  return { kind: "written", milestone: found };
}

/** The exit code for an outcome. */
function codeFor({ outcome }: { outcome: LinearMilestoneOutcome }): number {
  if (outcome.kind === "written" || outcome.kind === "landed") {
    return EXIT_OK;
  }
  return outcome.kind === "failed" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY;
}

/** The effect phase: token, door, write. */
async function runLive({
  deps,
  id,
  fields,
  home: homeArg,
}: {
  deps: LinearMilestoneWriteDeps;
  id: string;
  fields: LinearMilestoneFields;
  home: string | undefined;
}): Promise<number> {
  const home = resolveHome({ named: homeArg });
  const token = deps.resolveToken({ home });
  if (token === undefined) {
    return refuse({
      code: EXIT_EXPECTED_EMPTY,
      deps,
      lines: [`no Linear token for this home. Set LINEAR_API_KEY, or write ${home}/secrets/linear-token`],
    });
  }
  const ctx: MilestoneWriteContext = { api: deps.makeApi({ home, token }), deps, fields, home, id };
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: () => performWrite({ ctx }),
    request: milestoneDoorRequestFor({ home, id, projectId: fields.projectId }),
  });
  if (!routed.performed) {
    return refuse({
      code: routed.kind === "recording-refused" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY,
      deps,
      lines: [...notPerformedLines({ command: "slopweaver linear milestone", through: routed })],
    });
  }
  for (const line of milestoneOutcomeLines({ outcome: routed.result })) {
    deps.out(line);
  }
  return codeFor({ outcome: routed.result });
}

/**
 * Resolve every `#N`/`owner/repo#N`/`SUP-123` in the milestone's own markdown `description` into a real
 * link, then refuse whatever still can't resolve — same rule `./run.ts` enforces for an issue body, see
 * `../../bareRefDoor.ts`.
 *
 * @param args the parsed invocation, for the dry-run flag
 * @param issues the residue `linkifyMilestoneFields` already computed
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
  args: LinearMilestoneArgs;
  issues: readonly { readonly path: readonly (string | number)[]; readonly message: string }[];
  deps: LinearMilestoneWriteDeps;
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
 * Run `linear milestone create`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export async function runLinearMilestone({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: LinearMilestoneWriteDeps;
}): Promise<number> {
  const parsed = parseLinearMilestoneArgs({ argv: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: linearVerbErrorLines({ error: parsed.error }) });
  }
  const args = parsed.value;
  const form = parseLinearMilestoneForm({ raw: deps.readForm({ source: args.formSource }) });
  if (form.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: linearVerbErrorLines({ error: form.error }) });
  }
  // The id is computed from the ORIGINAL form, same reasoning `./projectRun.ts` documents at its own call.
  const id = milestoneIntentId({ form: form.value });
  const home = resolveHome({ named: args.home });
  const linkified = linkifyMilestoneFields({ context: deps.bareRefContext({ home }), fields: form.value.fields });
  const linkedForm: LinearMilestoneForm = { fields: linkified.fields };
  if (args.dryRun) {
    for (const line of milestoneDryRunLines({ form: linkedForm, id })) {
      deps.out(line);
    }
    return bareRefRefused({ args, deps, home, issues: linkified.issues }) ? EXIT_ERROR : EXIT_OK;
  }
  if (bareRefRefused({ args, deps, home, issues: linkified.issues })) {
    return EXIT_ERROR;
  }
  return runLive({ deps, fields: linkedForm.fields, home: args.home, id });
}

/** `slopweaver linear milestone` — create a Linear project milestone through the door-gated pattern. */
export const linearMilestoneCommand = defineCommand({
  run: (argv: readonly string[]) => runLinearMilestone({ argv, deps: productionLinearMilestoneWriteDeps() }),
});
