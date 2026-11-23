/**
 * The effectful shells for the Gmail verbs that CHANGE a mailbox — `gmail label`, `gmail mark`,
 * `gmail archive` — and for `gmail labels`, the read that makes the first of those usable.
 *
 * ## One shell, three names
 *
 * All three mutations are the same five steps: parse (pure), plan against current state, stop here on
 * `--dry-run`, route the one mutating call through the door, and report. They differ only in the label
 * change their parser produced and the word it put in `intent`, so they share {@link runGmailModify} rather
 * than being three copies that drift apart. The verbs stay separate at the CLI because "archive this" and
 * "add a label" are different things to a person, even when they are one call to Google.
 *
 * ## Why `--dry-run` returns before the door
 *
 * A dry run performs no external write, so routing it through the door would record a decision in the
 * ledger for something that never happened — the ledger would then over-count mutations, which is the one
 * thing a record of external writes must not do. It returns after planning, and says so in its output.
 *
 * Every edge is injected, so the shells are unit tested with plain fakes and no mailbox.
 */
import { DEFAULT_GATES } from "../../../admit/door.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, type Result } from "../../../lib/result.js";
import { makeGmailApi } from "../../../live/gmail/api.js";
import { resolveGmailClient } from "../../../live/gmail/client.js";
import type { GmailError } from "../../../live/gmail/errors.js";
import {
  applyGmailLabelChange,
  type GmailModifyOutcome,
  type GmailModifyPlan,
  type GmailModifyScope,
  planGmailLabelChange,
} from "../../../live/gmail/modify.js";
import { type GmailLabelsResult, readGmailLabels } from "../../../live/gmail/read.js";
import { renderGmailLabelsText, renderGmailOutcomeText, renderGmailPlanText } from "../../../live/gmail/render.js";
import { renderProviderReadJson } from "../../../live/providerRead.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { refuseRunnerOnStandingRuling } from "../../rulingGateDoor.js";
import { parseGmailArchiveArgs } from "./archiveArgs.js";
import type { GmailModifyArgs } from "./core.js";
import { parseGmailLabelArgs, parseGmailLabelsArgs, parseGmailMarkArgs } from "./core.js";
import { type GmailArgsError, gmailArgsErrorLines } from "./errors.js";
import { modifyDoorRequest } from "./modifyDoor.js";

const VERB_ARG_OFFSET = 4;

/**
 * The verb a mutation was invoked as, which a door refusal prints as the line to re-run. Threaded from each
 * verb's own shell as a literal, never derived from `intent`: `gmail archive --restore` plans the intent
 * "restore to inbox", whose first word is no verb at all.
 */
type GmailModifyCommand = "slopweaver gmail archive" | "slopweaver gmail label" | "slopweaver gmail mark";

/** The seams the mutation and label shells perform their effects through. */
export interface GmailModifyDeps {
  readonly plan: (args: {
    home: string | undefined;
    address: string;
    scope: GmailModifyScope;
    intent: string;
    addRefs: readonly string[];
    removeRefs: readonly string[];
  }) => Promise<Result<GmailModifyPlan, GmailError>>;
  readonly apply: (args: {
    home: string | undefined;
    plan: GmailModifyPlan;
  }) => Promise<Result<GmailModifyOutcome, GmailError>>;
  readonly labels: (args: { home: string | undefined }) => Promise<Result<GmailLabelsResult, GmailError>>;
  readonly home: () => string;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** The door ledger every mutation's admit decision is recorded through. */
  readonly doorLedger: DoorLedgerPort;
}

/** The home the mutation's door journals into: `--home` when given, else the ambient one the seam resolves. */
function modifyDoorHome({ args, deps }: { args: GmailModifyArgs; deps: GmailModifyDeps }): string {
  if (args.home === undefined) {
    return deps.home();
  }
  return args.home;
}

/**
 * Plan, and unless dry-running apply through the door, ONE id. With several ids a failure line names the id it
 * belongs to and `--json` prints one compact line per id, so the whole run stays one parseable stream; with one id
 * every byte is what the verb always printed.
 */
async function modifyOne({
  address,
  args,
  command,
  deps,
  many,
}: {
  address: string;
  args: GmailModifyArgs;
  command: GmailModifyCommand;
  deps: GmailModifyDeps;
  many: boolean;
}): Promise<number> {
  const diagnose = ({ line }: { line: string }): void => {
    deps.writeDiagnostic(many ? `${address}: ${line}` : line);
  };
  const json = (value: Record<string, unknown>): string =>
    many ? JSON.stringify({ address, ...value }) : JSON.stringify(value, undefined, 2);
  const planned = await deps.plan({
    addRefs: args.addRefs,
    address,
    home: args.home,
    intent: args.intent,
    removeRefs: args.removeRefs,
    scope: args.thread ? "thread" : "message",
  });
  if (planned.isErr()) {
    diagnose({ line: planned.error.message });
    return EXIT_ERROR;
  }
  if (args.dryRun) {
    deps.writeOut(
      args.json ? json({ applied: false, plan: planned.value }) : renderGmailPlanText({ plan: planned.value }),
    );
    return EXIT_OK;
  }
  return applyThroughDoor({ args, command, deps, diagnose, json, plan: planned.value });
}

/** Apply one id's plan through the door and report what happened; each failure line names the id when several ran. */
async function applyThroughDoor({
  args,
  command,
  deps,
  diagnose,
  json,
  plan,
}: {
  args: GmailModifyArgs;
  command: GmailModifyCommand;
  deps: GmailModifyDeps;
  diagnose: (args: { line: string }) => void;
  json: (value: Record<string, unknown>) => string;
  plan: GmailModifyPlan;
}): Promise<number> {
  const home = modifyDoorHome({ args, deps });
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: () => deps.apply({ home: args.home, plan }),
    request: modifyDoorRequest({ home, plan }),
  });
  if (!routed.performed) {
    // Either not-performed arm lands here: nothing was applied for THIS id, and the line names the id when
    // there are several. `runGmailModify` carries on to the next id exactly as it does after any item failure.
    for (const line of notPerformedLines({ command, through: routed })) {
      diagnose({ line });
    }
    return EXIT_ERROR;
  }
  if (routed.result.isErr()) {
    diagnose({ line: routed.result.error.message });
    return EXIT_ERROR;
  }
  deps.writeOut(
    args.json
      ? json({ applied: true, outcome: routed.result.value })
      : renderGmailOutcomeText({ outcome: routed.result.value }),
  );
  return EXIT_OK;
}

/**
 * Run one Gmail mutation against injected edges. The three mutating verbs all land here. Each id is its own plan,
 * its own door request and its own report, in the order given; one id failing does not stop the rest, and makes
 * the exit 1.
 *
 * @param args the parsed request, whichever verb produced it
 * @param command the verb the caller typed, which a door refusal names as the line to re-run
 * @param deps the plan, apply and output seams
 * @returns the process exit code
 */
export async function runGmailModify({
  args,
  command,
  deps,
}: {
  args: GmailModifyArgs;
  command: GmailModifyCommand;
  deps: GmailModifyDeps;
}): Promise<number> {
  const many = args.addresses.length > 1;
  let exit = EXIT_OK;
  for (const address of args.addresses) {
    const code = await modifyOne({ address, args, command, deps, many });
    if (code !== EXIT_OK) {
      exit = code;
    }
  }
  return exit;
}

/** Parse with one verb's parser, then run the shared mutation shell. */
async function dispatchModify({
  command,
  rest,
  deps,
  parse,
}: {
  command: GmailModifyCommand;
  rest: readonly string[];
  deps: GmailModifyDeps;
  parse: (args: { rest: readonly string[] }) => Result<GmailModifyArgs, GmailArgsError>;
}): Promise<number> {
  const parsed = parse({ rest });
  if (parsed.isErr()) {
    for (const line of [...gmailArgsErrorLines({ error: parsed.error }), parsed.error.usage]) {
      deps.writeDiagnostic(line);
    }
    return EXIT_USAGE;
  }
  return runGmailModify({ args: parsed.value, command, deps });
}

/**
 * Run `gmail label` against injected edges.
 *
 * @param rest argv after `gmail label`
 * @param deps the plan, apply and output seams
 * @returns the process exit code
 */
export async function runGmailLabel({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GmailModifyDeps;
}): Promise<number> {
  return dispatchModify({ command: "slopweaver gmail label", deps, parse: parseGmailLabelArgs, rest });
}

/**
 * Run `gmail mark` against injected edges.
 *
 * @param rest argv after `gmail mark`
 * @param deps the plan, apply and output seams
 * @returns the process exit code
 */
export async function runGmailMark({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GmailModifyDeps;
}): Promise<number> {
  return dispatchModify({ command: "slopweaver gmail mark", deps, parse: parseGmailMarkArgs, rest });
}

/**
 * Run `gmail archive` against injected edges.
 *
 * @param rest argv after `gmail archive`
 * @param deps the plan, apply and output seams
 * @returns the process exit code
 */
export async function runGmailArchive({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GmailModifyDeps;
}): Promise<number> {
  const gated = refuseRunnerOnStandingRuling({ noun: "gmail", rest, verb: "archive" });
  if (gated !== undefined) {
    return gated;
  }
  return dispatchModify({ command: "slopweaver gmail archive", deps, parse: parseGmailArchiveArgs, rest });
}

/**
 * Run `gmail labels` against injected edges.
 *
 * @param rest argv after `gmail labels`
 * @param deps the label read and output seams
 * @returns the process exit code
 */
export async function runGmailLabels({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GmailModifyDeps;
}): Promise<number> {
  const parsed = parseGmailLabelsArgs({ rest });
  if (parsed.isErr()) {
    for (const line of [...gmailArgsErrorLines({ error: parsed.error }), parsed.error.usage]) {
      deps.writeDiagnostic(line);
    }
    return EXIT_USAGE;
  }
  const result = await deps.labels({ home: parsed.value.home });
  if (result.isErr()) {
    deps.writeDiagnostic(result.error.message);
    return EXIT_ERROR;
  }
  deps.writeOut(
    parsed.value.json
      ? renderProviderReadJson({ document: result.value.document })
      : renderGmailLabelsText(result.value),
  );
  return EXIT_OK;
}

/**
 * The production mutation seams.
 *
 * `plan` and `labels` need only the `read` capability — planning reads label state and resolves names, and
 * neither changes anything. Only `apply` asks for `modify`, so a `--grant read` install can dry-run every
 * mutation verb and see exactly what it WOULD do before deciding whether to widen its grant. That is the
 * useful half of separating the two capabilities, rather than a technicality.
 *
 * @returns the grant-aware plan/apply/label edges and output sinks
 */
export function productionGmailModifyDeps(): GmailModifyDeps {
  const nowIso = (): string => new Date().toISOString();
  return {
    apply: async ({ home, plan }) => {
      const bound = resolveGmailClient({ capabilities: ["modify"], home: resolveHome({ named: home }) });
      if (bound.isErr()) {
        return err(bound.error);
      }
      return applyGmailLabelChange({
        api: makeGmailApi({ account: bound.value.account, client: bound.value.client }),
        plan,
      });
    },
    doorLedger: doorLedgerPort(),
    home: slopweaverHome,
    labels: async ({ home }) => {
      const bound = resolveGmailClient({ capabilities: ["read"], home: resolveHome({ named: home }) });
      if (bound.isErr()) {
        return err(bound.error);
      }
      return readGmailLabels({
        account: bound.value.account,
        api: makeGmailApi({ account: bound.value.account, client: bound.value.client }),
        nowIso,
      });
    },
    plan: async ({ home, address, scope, intent, addRefs, removeRefs }) => {
      const bound = resolveGmailClient({ capabilities: ["read"], home: resolveHome({ named: home }) });
      if (bound.isErr()) {
        return err(bound.error);
      }
      return planGmailLabelChange({
        account: bound.value.account,
        addRefs,
        address,
        api: makeGmailApi({ account: bound.value.account, client: bound.value.client }),
        intent,
        removeRefs,
        scope,
      });
    },
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver gmail label`. */
export const gmailLabelCommand = defineCommand({
  run: (argv) => runGmailLabel({ deps: productionGmailModifyDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});

/** `slopweaver gmail mark`. */
export const gmailMarkCommand = defineCommand({
  run: (argv) => runGmailMark({ deps: productionGmailModifyDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});

/** `slopweaver gmail archive`. */
export const gmailArchiveCommand = defineCommand({
  run: (argv) => runGmailArchive({ deps: productionGmailModifyDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});

/** `slopweaver gmail labels`. */
export const gmailLabelsCommand = defineCommand({
  run: (argv) => runGmailLabels({ deps: productionGmailModifyDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
