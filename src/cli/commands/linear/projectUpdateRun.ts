/**
 * `slopweaver linear project-update create` — the effectful shell. Every decision lives in
 * `./projectUpdateCore.ts`; this file resolves the home and token, routes the effect through the admit door,
 * and performs the create.
 *
 * Create-only, so there is no ownership gate and no read-before-write safety check: reserve → mutate → read
 * back → confirm → report, the same at-most-once shape `./commentRun.ts` proves. A project update is never
 * edited by this door — everyone watching the project has already been notified, and a correction is a NEW
 * update, which is also how a human does it in Linear's own UI.
 */
import { readFileSync } from "node:fs";
import { DEFAULT_GATES } from "../../../admit/door.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { linearToken } from "../../../config.js";
import { type LinearWriteApi, makeLinearWriteApi } from "../../../corpus/linear/write.js";
import { logger } from "../../../lib/logger.js";
import { linearProjectUpdateAboveFoldCells } from "../../../outbound/linear/aboveFold.js";
import { linkifyProjectUpdateArtifact } from "../../../outbound/linear/bareRefLinks.js";
import { confirmAppend, releaseAppendReservation, reserveAppend } from "../../../outbound/linear/commentLedger.js";
import type { LinearProjectUpdateForm } from "../../../outbound/linear/projectUpdateTypes.js";
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
  type LinearProjectUpdateArgs,
  type LinearProjectUpdateOutcome,
  parseLinearProjectUpdateArgs,
  parseLinearProjectUpdateForm,
  projectUpdateDoorRequestFor,
  projectUpdateDryRunLines,
  projectUpdateInputFor,
  projectUpdateIntentId,
  projectUpdateOutcomeLines,
} from "./projectUpdateCore.js";
import { summaryAboveFoldRefused } from "./summaryAboveFold.js";

/** Same offset `./run.ts` documents: node, script, noun, verb. */
const VERB_ARG_OFFSET = 4;

/** The ledger family this verb reserves in — shared machinery, its own directory. */
const LEDGER_KIND = "linear-project-updates";

/** The injectable edges. A test supplies plain functions; nothing here is a mock. */
export interface LinearProjectUpdateWriteDeps {
  readonly readForm: (args: { source: string }) => string;
  /** One environment variable, injected rather than read at the point of use — see `./commentRun.ts`. */
  readonly env: (args: { name: string }) => string | undefined;
  /** What this update's bare `#N`/`SUP-123` references can resolve against. */
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
export function productionLinearProjectUpdateWriteDeps(): LinearProjectUpdateWriteDeps {
  return {
    bareRefContext: ({ home }) => bareRefContextFor({ home }),
    doorLedger: doorLedgerPort(),
    env: ({ name }) => process.env[name],
    err: (line) => process.stderr.write(`linear project-update: ${line}\n`),
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
  deps: LinearProjectUpdateWriteDeps;
  lines: readonly string[];
  code: number;
}): number {
  for (const line of lines) {
    deps.err(line);
  }
  return code;
}

/** Everything the effect phase needs, once the cheap checks have passed. */
interface ProjectUpdateWriteContext {
  readonly api: LinearWriteApi;
  readonly deps: LinearProjectUpdateWriteDeps;
  readonly home: string;
  readonly id: string;
  readonly form: LinearProjectUpdateForm;
}

/**
 * A mutation that returned an error. The freshly-reserved id proves a genuine create, so anything found
 * there is what we asked for — same reasoning `./commentRun.ts`'s `afterLostResponse` applies.
 *
 * @param ctx the write context
 * @param reason the transport error the mutation returned
 * @returns what is actually known about the write
 */
async function afterLostResponse({
  ctx,
  reason,
}: {
  ctx: ProjectUpdateWriteContext;
  reason: string;
}): Promise<LinearProjectUpdateOutcome> {
  const readBack = await ctx.api.readProjectUpdate({ id: ctx.id });
  if (readBack.isErr()) {
    return { kind: "indeterminate", reason };
  }
  const found = readBack._unsafeUnwrap();
  if (found === undefined) {
    return { kind: "failed", reason };
  }
  confirmAppend({
    home: ctx.home,
    id: ctx.id,
    kind: LEDGER_KIND,
    nowIso: ctx.deps.nowIso(),
    subject: ctx.form.fields.projectId,
  });
  return { kind: "landed", reason, update: found };
}

/** Reserve, mutate, read back, confirm. Runs ONLY when the door passed. */
async function performWrite({ ctx }: { ctx: ProjectUpdateWriteContext }): Promise<LinearProjectUpdateOutcome> {
  const reservedIso = ctx.deps.nowIso();
  const claim = reserveAppend({
    home: ctx.home,
    id: ctx.id,
    kind: LEDGER_KIND,
    nowIso: reservedIso,
    subject: ctx.form.fields.projectId,
  });
  if (claim.kind === "taken") {
    return { kind: "duplicate", reservedIso: claim.record.reservedIso };
  }
  const mutation = await ctx.api.createProjectUpdate({
    id: ctx.id,
    input: projectUpdateInputFor({ form: ctx.form }),
  });
  // Refused before the wire: nothing was sent, so this create's own reservation is released for the retry.
  const release = () => releaseAppendReservation({ home: ctx.home, id: ctx.id, kind: LEDGER_KIND, reservedIso });
  if (mutation.isErr() && settledBeforeWire({ error: mutation.error, release })) {
    return { kind: "failed", reason: mutation.error.message };
  }
  if (mutation.isErr()) {
    return afterLostResponse({ ctx, reason: mutation._unsafeUnwrapErr().message });
  }
  const written = mutation._unsafeUnwrap();
  // The mutation's own response is not proof — the same posture every other create here takes — so the
  // update is established by reading it back.
  const readBack = await ctx.api.readProjectUpdate({ id: ctx.id });
  if (readBack.isErr() || readBack._unsafeUnwrap() === undefined) {
    return { kind: "unconfirmed", update: written };
  }
  const found = readBack._unsafeUnwrap()!;
  confirmAppend({
    home: ctx.home,
    id: ctx.id,
    kind: LEDGER_KIND,
    nowIso: ctx.deps.nowIso(),
    subject: ctx.form.fields.projectId,
  });
  return { kind: "written", update: found };
}

/** The exit code for an outcome. */
function codeFor({ outcome }: { outcome: LinearProjectUpdateOutcome }): number {
  if (outcome.kind === "written" || outcome.kind === "landed") {
    return EXIT_OK;
  }
  return outcome.kind === "failed" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY;
}

/** The effect phase: token, door, write. */
async function runLive({
  deps,
  id,
  form,
  home: homeArg,
}: {
  deps: LinearProjectUpdateWriteDeps;
  id: string;
  form: LinearProjectUpdateForm;
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
  const ctx: ProjectUpdateWriteContext = { api: deps.makeApi({ home, token }), deps, form, home, id };
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    // Passed EXPLICITLY, for the reason `./run.ts` records.
    home,
    ledger: deps.doorLedger,
    perform: () => performWrite({ ctx }),
    request: projectUpdateDoorRequestFor({
      health: form.fields.health,
      home,
      id,
      projectId: form.fields.projectId,
    }),
  });
  if (!routed.performed) {
    return refuse({
      code: routed.kind === "recording-refused" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY,
      deps,
      lines: [...notPerformedLines({ command: "slopweaver linear project-update", through: routed })],
    });
  }
  for (const line of projectUpdateOutcomeLines({ outcome: routed.result })) {
    deps.out(line);
  }
  return codeFor({ outcome: routed.result });
}

/**
 * The above-the-fold gate on the update's summary, which is its whole report above the fold.
 *
 * @param args the parsed invocation, for the dry-run flag and the state home
 * @param artifact the validated update
 * @param deps the injected environment reader and output sink
 * @returns true when the write must refuse
 */
async function aboveFoldRefused({
  args,
  artifact,
  deps,
}: {
  args: LinearProjectUpdateArgs;
  artifact: LinearProjectUpdateForm["artifact"];
  deps: LinearProjectUpdateWriteDeps;
}): Promise<boolean> {
  return summaryAboveFoldRefused({ args, cells: linearProjectUpdateAboveFoldCells({ artifact }), deps });
}

/**
 * Resolve every bare reference in the update into a real link, then refuse whatever still can't resolve.
 *
 * @param args the parsed invocation, for the dry-run flag and the state home
 * @param issues the residue `linkifyProjectUpdateArtifact` already computed
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
  args: LinearProjectUpdateArgs;
  issues: readonly { readonly path: readonly (string | number)[]; readonly message: string }[];
  deps: LinearProjectUpdateWriteDeps;
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
 * Run `linear project-update create`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export async function runLinearProjectUpdate({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: LinearProjectUpdateWriteDeps;
}): Promise<number> {
  const parsed = parseLinearProjectUpdateArgs({ argv: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: linearVerbErrorLines({ error: parsed.error }) });
  }
  const args = parsed.value;
  const form = parseLinearProjectUpdateForm({ raw: deps.readForm({ source: args.formSource }) });
  if (form.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: linearVerbErrorLines({ error: form.error }) });
  }
  const home = resolveHome({ named: args.home });
  const linkified = linkifyProjectUpdateArtifact({
    artifact: form.value.artifact,
    context: deps.bareRefContext({ home }),
  });
  const linkedForm = { ...form.value, artifact: linkified.artifact };
  // The id is computed from the LINKIFIED body, so the same source form always maps to the same id in a home
  // whose resolution context has not changed — and a form whose references now resolve differently is a
  // different report, which is correct.
  const id = projectUpdateIntentId({ form: linkedForm });
  if (args.dryRun) {
    // Stops here, before every effect. Nothing resolved, nothing recorded, nothing reserved, nothing sent.
    for (const line of projectUpdateDryRunLines({ form: linkedForm, id })) {
      deps.out(line);
    }
    const aboveFold = await aboveFoldRefused({ args, artifact: linkedForm.artifact, deps });
    const bareRefs = bareRefRefused({ args, deps, home, issues: linkified.issues });
    return aboveFold || bareRefs ? EXIT_ERROR : EXIT_OK;
  }
  if (await aboveFoldRefused({ args, artifact: linkedForm.artifact, deps })) {
    return EXIT_ERROR;
  }
  if (bareRefRefused({ args, deps, home, issues: linkified.issues })) {
    return EXIT_ERROR;
  }
  return runLive({ deps, form: linkedForm, home: args.home, id });
}

/** `slopweaver linear project-update` — post one project status update from a typed form, through the door. */
export const linearProjectUpdateCommand = defineCommand({
  run: (argv: readonly string[]) => runLinearProjectUpdate({ argv, deps: productionLinearProjectUpdateWriteDeps() }),
});
