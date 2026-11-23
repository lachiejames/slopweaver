/**
 * `slopweaver linear initiative` — the effectful shell. Every decision lives in `./initiativeCore.ts`; this
 * file resolves the home and token and routes the effect through the admit door, and `./initiativeWrite.ts`
 * performs the mutation once the door passed.
 *
 * Same ordered contract `./projectRun.ts` documents — parse → validate → [dry-run stops here] → token →
 * ownership → door → reserve → mutate → read back → confirm → report, the reserve-to-confirm steps living in
 * `./initiativeWrite.ts`. The `link` sub-verb runs the same sequence over a different object: it is
 * append-shaped, so it reserves in the shared append ledger and has no ownership gate, exactly as
 * `./relationRun.ts` handles an issue relation.
 */
import { DEFAULT_GATES } from "../../../admit/door.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { linkifyInitiativeFields } from "../../../outbound/linear/bareRefLinks.js";
import type {
  LinearInitiativeFields,
  LinearInitiativeForm,
  LinearInitiativeLinkForm,
} from "../../../outbound/linear/initiativeTypes.js";
import { ownershipOfInitiative } from "../../../outbound/linear/projectLedger.js";
import { bareRefGateRefused } from "../../bareRefDoor.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { linearVerbErrorLines } from "./errors.js";
import {
  initiativeDoorRequestFor,
  initiativeDryRunLines,
  initiativeLinkDryRunLines,
  initiativeLinkIntentId,
  initiativeLinkOutcomeLines,
  initiativeOutcomeLines,
  initiativeWriteId,
  type LinearInitiativeArgs,
  type LinearInitiativeOutcome,
  parseLinearInitiativeArgs,
  parseLinearInitiativeForm,
  parseLinearInitiativeLinkForm,
} from "./initiativeCore.js";
import { type LinearInitiativeWriteDeps, productionLinearInitiativeWriteDeps } from "./initiativeDeps.js";
import { type InitiativeWriteContext, performLink, performWrite } from "./initiativeWrite.js";

/** Same offset `./run.ts` documents: node, script, noun, verb. */
const VERB_ARG_OFFSET = 4;

/** Print each line to stderr and return the code. */
function refuse({
  deps,
  lines,
  code,
}: {
  deps: LinearInitiativeWriteDeps;
  lines: readonly string[];
  code: number;
}): number {
  for (const line of lines) {
    deps.err(line);
  }
  return code;
}

/** Refuse a write this home holds no Linear token for — both effect phases open on it. */
function refuseNoToken({ deps, home }: { deps: LinearInitiativeWriteDeps; home: string }): number {
  const line = `no Linear token for this home. Set LINEAR_API_KEY, or write ${home}/secrets/linear-token`;
  return refuse({ code: EXIT_EXPECTED_EMPTY, deps, lines: [line] });
}

/** Ownership only — an initiative write sends scalars, so there is no prose to clobber. */
function updateBlocked({ ctx }: { ctx: InitiativeWriteContext }): string | undefined {
  if (ctx.verb !== "update") {
    return undefined;
  }
  const ownership = ownershipOfInitiative({ home: ctx.home, id: ctx.id });
  return ownership.owned ? undefined : ownership.reason;
}

/**
 * The exit code for either outcome.
 *
 * One parameter, typed on the initiative outcome's discriminants alone: the LINK outcome carries exactly the
 * same six, so a union of the two would be a duplicate rather than a wider type. If they ever diverge this
 * stops compiling at the call site, which is the right place to notice.
 */
function codeFor({ kind }: { kind: LinearInitiativeOutcome["kind"] }): number {
  if (kind === "written" || kind === "landed") {
    return EXIT_OK;
  }
  return kind === "failed" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY;
}

/** Resolve the home and token, or say which is missing. */
function tokenFor({ deps, home }: { deps: LinearInitiativeWriteDeps; home: string }): string | undefined {
  return deps.resolveToken({ home });
}

/** The effect phase for `create`/`update`, in the invocation's resolved home: token, ownership, door, write. */
async function runLive({
  deps,
  fields,
  home,
  id,
  verb,
}: {
  deps: LinearInitiativeWriteDeps;
  fields: LinearInitiativeFields;
  home: string;
  id: string;
  verb: "create" | "update";
}): Promise<number> {
  const token = tokenFor({ deps, home });
  if (token === undefined) {
    return refuseNoToken({ deps, home });
  }
  const ctx: InitiativeWriteContext = { api: deps.makeApi({ home, token }), deps, fields, home, id, verb };
  const blocked = updateBlocked({ ctx });
  if (blocked !== undefined) {
    return refuse({ code: EXIT_EXPECTED_EMPTY, deps, lines: [blocked] });
  }
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: () => performWrite({ ctx }),
    request: initiativeDoorRequestFor({ home, id, verb }),
  });
  if (!routed.performed) {
    return refuse({
      code: routed.kind === "recording-refused" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY,
      deps,
      lines: [...notPerformedLines({ command: "slopweaver linear initiative", through: routed })],
    });
  }
  for (const line of initiativeOutcomeLines({ outcome: routed.result, verb })) {
    deps.out(line);
  }
  return codeFor({ kind: routed.result.kind });
}

/** The effect phase for `link`: token, door, write. No ownership gate — an edge is append-shaped. */
async function runLinkLive({
  args,
  deps,
  form,
  id,
}: {
  args: LinearInitiativeArgs;
  deps: LinearInitiativeWriteDeps;
  form: LinearInitiativeLinkForm;
  id: string;
}): Promise<number> {
  const home = resolveHome({ named: args.home });
  const token = tokenFor({ deps, home });
  if (token === undefined) {
    return refuseNoToken({ deps, home });
  }
  const api = deps.makeApi({ home, token });
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: () => performLink({ api, deps, form, home, id }),
    request: initiativeDoorRequestFor({ home, id, verb: "link" }),
  });
  if (!routed.performed) {
    return refuse({
      code: routed.kind === "recording-refused" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY,
      deps,
      lines: [...notPerformedLines({ command: "slopweaver linear initiative", through: routed })],
    });
  }
  for (const line of initiativeLinkOutcomeLines({ outcome: routed.result })) {
    deps.out(line);
  }
  return codeFor({ kind: routed.result.kind });
}

/**
 * Resolve every bare reference in the initiative's own `description`, then refuse whatever stays bare.
 *
 * @param args the parsed invocation, for the dry-run flag
 * @param issues the residue `linkifyInitiativeFields` already computed
 * @param deps the injected environment reader and output sink
 * @param home the state home this invocation resolved, whose grant journal decides the hatch
 * @returns true when the write must refuse
 */
function bareRefRefused(gate: {
  args: LinearInitiativeArgs;
  issues: readonly { readonly path: readonly (string | number)[]; readonly message: string }[];
  deps: LinearInitiativeWriteDeps;
  home: string;
}): boolean {
  return bareRefGateRefused({
    dryRun: gate.args.dryRun,
    env: gate.deps.env,
    home: gate.home,
    issues: gate.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    out: ({ line }) => {
      gate.deps.out(line);
    },
  });
}

/** The whole `link` branch, from its raw form to an exit code. */
async function runLink({
  args,
  deps,
  raw,
}: {
  args: LinearInitiativeArgs;
  deps: LinearInitiativeWriteDeps;
  raw: string;
}): Promise<number> {
  const form = parseLinearInitiativeLinkForm({ raw });
  if (form.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: linearVerbErrorLines({ error: form.error }) });
  }
  const id = initiativeLinkIntentId({ form: form.value });
  if (args.dryRun) {
    // Stops here, before every effect. A link carries no prose, so there is no bare-reference gate to run.
    for (const line of initiativeLinkDryRunLines({ form: form.value, id })) {
      deps.out(line);
    }
    return EXIT_OK;
  }
  return runLinkLive({ args, deps, form: form.value, id });
}

/**
 * Run `linear initiative <create|update|link>`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export async function runLinearInitiative({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: LinearInitiativeWriteDeps;
}): Promise<number> {
  const parsed = parseLinearInitiativeArgs({ argv: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: linearVerbErrorLines({ error: parsed.error }) });
  }
  const args = parsed.value;
  const raw = deps.readForm({ source: args.formSource });
  if (args.verb === "link") {
    return runLink({ args, deps, raw });
  }
  const form = parseLinearInitiativeForm({ raw });
  if (form.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: linearVerbErrorLines({ error: form.error }) });
  }
  // The id is computed from the ORIGINAL form, mirroring `./projectRun.ts`: the same authored content maps
  // to the same initiative id regardless of what the invoking checkout's reference context happens to be.
  const id = initiativeWriteId({ args, form: form.value });
  const home = resolveHome({ named: args.home });
  const linkified = linkifyInitiativeFields({ context: deps.bareRefContext({ home }), fields: form.value.fields });
  const linkedForm: LinearInitiativeForm = { fields: linkified.fields };
  if (args.dryRun) {
    for (const line of initiativeDryRunLines({ form: linkedForm, id })) {
      deps.out(line);
    }
    return bareRefRefused({ args, deps, home, issues: linkified.issues }) ? EXIT_ERROR : EXIT_OK;
  }
  if (bareRefRefused({ args, deps, home, issues: linkified.issues })) {
    return EXIT_ERROR;
  }
  return runLive({ deps, fields: linkedForm.fields, home, id, verb: args.verb });
}

/** `slopweaver linear initiative` — create, edit or attach a project to a Linear initiative, through the door. */
export const linearInitiativeCommand = defineCommand({
  run: (argv: readonly string[]) => runLinearInitiative({ argv, deps: productionLinearInitiativeWriteDeps() }),
});
