/**
 * `slopweaver linear label create` — the effectful shell. Every decision lives in `./labelCore.ts`; this
 * file resolves the home and token, routes the effect through the admit door, and performs the create.
 *
 * Create-only, the same at-most-once shape as `./relationRun.ts`: reserve → mutate → read back → confirm →
 * report. There is no update or delete arm: renaming or retiring a label the whole team picks from is a
 * change to everyone's vocabulary, and nothing has asked for one.
 */
import { readFileSync } from "node:fs";

import { DEFAULT_GATES } from "../../../admit/door.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { linearToken } from "../../../config.js";
import { type LinearLabelWriteApi, makeLinearLabelWriteApi } from "../../../corpus/linear/writeLabels.js";
import { logger } from "../../../lib/logger.js";
import { confirmAppend, releaseAppendReservation, reserveAppend } from "../../../outbound/linear/commentLedger.js";
import type { LinearLabelCreateForm } from "../../../outbound/linear/labelTypes.js";
import { settledBeforeWire } from "../../../outbound/linear/sendFailure.js";
import { linearWritePrivacy } from "../../../outbound/linear/writePrivacy.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { linearVerbErrorLines } from "./errors.js";
import {
  type LinearLabelOutcome,
  labelDoorRequestFor,
  labelDryRunLines,
  labelInputFor,
  labelIntentId,
  labelOutcomeJson,
  labelOutcomeLines,
  labelSubject,
  parseLinearLabelArgs,
  parseLinearLabelForm,
} from "./labelCore.js";
import { LINEAR_LABEL_USAGE } from "./labelUsage.js";

/** Same offset `./run.ts` documents: node, script, noun, verb. */
const VERB_ARG_OFFSET = 4;

/** The injectable edges. A test supplies plain functions; nothing here is a mock. */
export interface LinearLabelWriteDeps {
  readonly readForm: (args: { source: string }) => string;
  readonly resolveToken: (args: { home: string }) => string | undefined;
  readonly makeApi: (args: { home: string; token: string }) => LinearLabelWriteApi;
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
export function productionLinearLabelWriteDeps(): LinearLabelWriteDeps {
  return {
    doorLedger: doorLedgerPort(),
    err: (line) => process.stderr.write(`linear label:${line}\n`),
    makeApi: ({ home, token }) => makeLinearLabelWriteApi({ privacy: linearWritePrivacy({ home }), token }),
    nowIso: () => new Date().toISOString(),
    out: (line) => {
      logger.out({ line });
    },
    readForm: ({ source }) => (source === "-" ? readFileSync(0, "utf8") : source),
    resolveToken: ({ home }) => linearToken({ home }),
  };
}

/** Print each line to stderr and return the code. */
function refuse({ deps, lines, code }: { deps: LinearLabelWriteDeps; lines: readonly string[]; code: number }): number {
  for (const line of lines) {
    deps.err(line);
  }
  return code;
}

/** Everything the effect phase needs, once the cheap checks have passed. */
interface LabelWriteContext {
  readonly api: LinearLabelWriteApi;
  readonly deps: LinearLabelWriteDeps;
  readonly home: string;
  readonly id: string;
  readonly form: LinearLabelCreateForm;
}

/** Read the label back from whichever vocabulary the form named. */
function readBack({ ctx }: { ctx: LabelWriteContext }): ReturnType<LinearLabelWriteApi["readIssueLabel"]> {
  if (ctx.form.kind === "issue") {
    return ctx.api.readIssueLabel({ id: ctx.id });
  }
  return ctx.api.readProjectLabel({ id: ctx.id });
}

/** Mark the reservation confirmed, once a read-back has found the label. */
function confirm({ ctx }: { ctx: LabelWriteContext }): void {
  confirmAppend({
    home: ctx.home,
    id: ctx.id,
    kind: "linear-labels",
    nowIso: ctx.deps.nowIso(),
    subject: labelSubject({ form: ctx.form }),
  });
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
  ctx: LabelWriteContext;
  reason: string;
}): Promise<LinearLabelOutcome> {
  const found = await readBack({ ctx });
  if (found.isErr()) {
    return { kind: "indeterminate", reason };
  }
  if (found.value === undefined) {
    return { kind: "failed", reason };
  }
  confirm({ ctx });
  return { kind: "landed", label: found.value, reason };
}

/**
 * Reserve, mutate, read back, confirm. Runs ONLY when the door passed.
 *
 * The reservation is one STATE HOME's, like every append kind's: a retry under a second `--home` finds it
 * fresh and sends the create again. That request still cannot make a second label, because the id it carries
 * is derived from the form and Linear refuses an id it already holds; the ledger closes the request, the id
 * closes the label.
 */
async function performWrite({ ctx }: { ctx: LabelWriteContext }): Promise<LinearLabelOutcome> {
  const reservedIso = ctx.deps.nowIso();
  const claim = reserveAppend({
    home: ctx.home,
    id: ctx.id,
    kind: "linear-labels",
    nowIso: reservedIso,
    subject: labelSubject({ form: ctx.form }),
  });
  if (claim.kind === "taken") {
    return { kind: "duplicate", reservedIso: claim.record.reservedIso };
  }
  const input = labelInputFor({ form: ctx.form });
  const mutation =
    ctx.form.kind === "issue"
      ? await ctx.api.createIssueLabel({ id: ctx.id, input })
      : await ctx.api.createProjectLabel({ id: ctx.id, input });
  // Refused before the wire: nothing was sent, so this create's own reservation is released for the retry.
  const release = () => releaseAppendReservation({ home: ctx.home, id: ctx.id, kind: "linear-labels", reservedIso });
  if (mutation.isErr() && settledBeforeWire({ error: mutation.error, release })) {
    return { kind: "failed", reason: mutation.error.message };
  }
  if (mutation.isErr()) {
    return afterLostResponse({ ctx, reason: mutation.error.message });
  }
  // The name, team and group a label actually got come from the read-back, and only from there: both create
  // payloads echo `{ id }`.
  const found = await readBack({ ctx });
  if (found.isErr() || found.value === undefined) {
    return { kind: "unconfirmed", labelId: mutation.value.id };
  }
  confirm({ ctx });
  return { kind: "written", label: found.value };
}

/** The exit code for an outcome. */
function codeFor({ outcome }: { outcome: LinearLabelOutcome }): number {
  if (outcome.kind === "written" || outcome.kind === "landed") {
    return EXIT_OK;
  }
  if (outcome.kind === "failed") {
    return EXIT_ERROR;
  }
  return EXIT_EXPECTED_EMPTY;
}

/** Print an outcome in the shape the caller asked for. */
function report({
  deps,
  outcome,
  id,
  json,
}: {
  deps: LinearLabelWriteDeps;
  outcome: LinearLabelOutcome;
  id: string;
  json: boolean;
}): void {
  if (json) {
    deps.out(labelOutcomeJson({ id, outcome }));
    return;
  }
  for (const line of labelOutcomeLines({ outcome })) {
    deps.out(line);
  }
}

/** The effect phase: token, door, write. */
async function runLive({
  deps,
  id,
  form,
  home: homeArg,
  json,
}: {
  deps: LinearLabelWriteDeps;
  id: string;
  form: LinearLabelCreateForm;
  home: string | undefined;
  json: boolean;
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
  const ctx: LabelWriteContext = { api: deps.makeApi({ home, token }), deps, form, home, id };
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: () => performWrite({ ctx }),
    request: labelDoorRequestFor({ form, home, id }),
  });
  if (!routed.performed) {
    return refuse({
      code: routed.kind === "recording-refused" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY,
      deps,
      lines: [...notPerformedLines({ command: "slopweaver linear label", through: routed })],
    });
  }
  report({ deps, id, json, outcome: routed.result });
  return codeFor({ outcome: routed.result });
}

/**
 * Run `linear label create`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export async function runLinearLabel({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: LinearLabelWriteDeps;
}): Promise<number> {
  const parsed = parseLinearLabelArgs({ argv: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuse({
      code: EXIT_USAGE,
      deps,
      lines: [...linearVerbErrorLines({ error: parsed.error }), LINEAR_LABEL_USAGE],
    });
  }
  const args = parsed.value;
  const form = parseLinearLabelForm({ raw: deps.readForm({ source: args.formSource }) });
  if (form.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: linearVerbErrorLines({ error: form.error }) });
  }
  const id = labelIntentId({ form: form.value });
  if (args.dryRun) {
    for (const line of labelDryRunLines({ form: form.value, id })) {
      deps.out(line);
    }
    return EXIT_OK;
  }
  return runLive({ deps, form: form.value, home: args.home, id, json: args.json });
}

/** `slopweaver linear label` — add one issue label or project label, through the door. */
export const linearLabelCommand = defineCommand({
  run: (argv: readonly string[]) => runLinearLabel({ argv, deps: productionLinearLabelWriteDeps() }),
});
