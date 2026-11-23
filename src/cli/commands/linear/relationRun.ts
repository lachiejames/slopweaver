/**
 * `slopweaver linear relation create` — the effectful shell. Every decision lives in `./relationCore.ts`;
 * this file resolves the home and token, routes the effect through the admit door, and performs the create.
 *
 * Create-only, same at-most-once shape as `./commentRun.ts`: reserve → mutate → read back → confirm →
 * report. There is no update arm because a relation has nothing to update — its identity IS its two
 * endpoints and its type.
 */
import { readFileSync } from "node:fs";
import { DEFAULT_GATES } from "../../../admit/door.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { linearToken } from "../../../config.js";
import { type LinearWriteApi, makeLinearWriteApi } from "../../../corpus/linear/write.js";
import { logger } from "../../../lib/logger.js";
import { confirmAppend, releaseAppendReservation, reserveAppend } from "../../../outbound/linear/commentLedger.js";
import type { LinearRelationForm } from "../../../outbound/linear/commentTypes.js";
import { settledBeforeWire } from "../../../outbound/linear/sendFailure.js";
import { linearWritePrivacy } from "../../../outbound/linear/writePrivacy.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { linearVerbErrorLines } from "./errors.js";
import {
  type LinearRelationOutcome,
  parseLinearRelationArgs,
  parseLinearRelationForm,
  relationDoorRequestFor,
  relationDryRunLines,
  relationInputFor,
  relationIntentId,
  relationOutcomeLines,
} from "./relationCore.js";

/** Same offset `./run.ts` documents: node, script, noun, verb. */
const VERB_ARG_OFFSET = 4;

/** The injectable edges. A test supplies plain functions; nothing here is a mock. */
export interface LinearRelationWriteDeps {
  readonly readForm: (args: { source: string }) => string;
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
export function productionLinearRelationWriteDeps(): LinearRelationWriteDeps {
  return {
    doorLedger: doorLedgerPort(),
    err: (line) => process.stderr.write(`linear relation:${line}\n`),
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
  deps: LinearRelationWriteDeps;
  lines: readonly string[];
  code: number;
}): number {
  for (const line of lines) {
    deps.err(line);
  }
  return code;
}

/** Everything the effect phase needs, once the cheap checks have passed. */
interface RelationWriteContext {
  readonly api: LinearWriteApi;
  readonly deps: LinearRelationWriteDeps;
  readonly home: string;
  readonly id: string;
  readonly form: LinearRelationForm;
}

/**
 * A mutation that returned an error. The freshly-reserved id proves a genuine create, so anything found
 * there is what we asked for.
 *
 * @param ctx the write context
 * @param reason the transport error the mutation returned
 * @returns what is actually known about the write
 */
async function afterLostResponse({
  ctx,
  reason,
}: {
  ctx: RelationWriteContext;
  reason: string;
}): Promise<LinearRelationOutcome> {
  const readBack = await ctx.api.readRelation({ id: ctx.id });
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
    kind: "linear-relations",
    nowIso: ctx.deps.nowIso(),
    subject: ctx.form.fields.issueId,
  });
  return { kind: "landed", reason, relation: found };
}

/** Reserve, mutate, read back, confirm. Runs ONLY when the door passed. */
async function performWrite({ ctx }: { ctx: RelationWriteContext }): Promise<LinearRelationOutcome> {
  const reservedIso = ctx.deps.nowIso();
  const claim = reserveAppend({
    home: ctx.home,
    id: ctx.id,
    kind: "linear-relations",
    nowIso: reservedIso,
    subject: ctx.form.fields.issueId,
  });
  if (claim.kind === "taken") {
    return { kind: "duplicate", reservedIso: claim.record.reservedIso };
  }
  const mutation = await ctx.api.createRelation({ id: ctx.id, input: relationInputFor({ form: ctx.form }) });
  // Refused before the wire: nothing was sent, so this create's own reservation is released for the retry.
  const release = () => releaseAppendReservation({ home: ctx.home, id: ctx.id, kind: "linear-relations", reservedIso });
  if (mutation.isErr() && settledBeforeWire({ error: mutation.error, release })) {
    return { kind: "failed", reason: mutation.error.message };
  }
  if (mutation.isErr()) {
    return afterLostResponse({ ctx, reason: mutation._unsafeUnwrapErr().message });
  }
  const written = mutation._unsafeUnwrap();
  // Both endpoints come from the read-back, and only from there: the SDK's `IssueRelationPayload` echoes
  // `issueRelation { id }`, so a relation that joined nothing is invisible in the create's own response.
  const readBack = await ctx.api.readRelation({ id: ctx.id });
  if (readBack.isErr() || readBack._unsafeUnwrap() === undefined) {
    return { kind: "unconfirmed", relationId: written.id };
  }
  const found = readBack._unsafeUnwrap()!;
  confirmAppend({
    home: ctx.home,
    id: ctx.id,
    kind: "linear-relations",
    nowIso: ctx.deps.nowIso(),
    subject: ctx.form.fields.issueId,
  });
  return { kind: "written", relation: found };
}

/** The exit code for an outcome. */
function codeFor({ outcome }: { outcome: LinearRelationOutcome }): number {
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
  deps: LinearRelationWriteDeps;
  id: string;
  form: LinearRelationForm;
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
  const ctx: RelationWriteContext = { api: deps.makeApi({ home, token }), deps, form, home, id };
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: () => performWrite({ ctx }),
    request: relationDoorRequestFor({ home, id, issueId: form.fields.issueId }),
  });
  if (!routed.performed) {
    return refuse({
      code: routed.kind === "recording-refused" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY,
      deps,
      lines: [...notPerformedLines({ command: "slopweaver linear relation", through: routed })],
    });
  }
  for (const line of relationOutcomeLines({ outcome: routed.result })) {
    deps.out(line);
  }
  return codeFor({ outcome: routed.result });
}

/**
 * Run `linear relation create`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export async function runLinearRelation({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: LinearRelationWriteDeps;
}): Promise<number> {
  const parsed = parseLinearRelationArgs({ argv: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: linearVerbErrorLines({ error: parsed.error }) });
  }
  const args = parsed.value;
  const form = parseLinearRelationForm({ raw: deps.readForm({ source: args.formSource }) });
  if (form.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: linearVerbErrorLines({ error: form.error }) });
  }
  const id = relationIntentId({ form: form.value });
  if (args.dryRun) {
    for (const line of relationDryRunLines({ form: form.value, id })) {
      deps.out(line);
    }
    return EXIT_OK;
  }
  return runLive({ deps, form: form.value, home: args.home, id });
}

/** `slopweaver linear relation` — assert one edge between two Linear issues, through the door. */
export const linearRelationCommand = defineCommand({
  run: (argv: readonly string[]) => runLinearRelation({ argv, deps: productionLinearRelationWriteDeps() }),
});
