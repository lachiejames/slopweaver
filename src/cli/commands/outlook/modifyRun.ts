/**
 * The effectful shells for the `outlook` verbs that CHANGE a mailbox — `category`, `mark`, `archive`.
 *
 * All three are one shape: parse (pure), read every target and plan against what was read, stop on `--dry-run`,
 * route the writes through the door as ONE request, and report message by message. They differ only in how a
 * plan is built, which is {@link planChange}'s one switch.
 *
 * `--dry-run` returns BEFORE the door, as Gmail's shells do: a dry run performs no external write, and a ledger
 * row for one would over-count the mutations the ledger exists to record.
 *
 * Archiving resolves the Archive folder through Graph rather than assuming one: a personal mailbox can have
 * none, and that is a refusal naming the folder, never a move into somewhere else.
 */
import { DEFAULT_GATES } from "../../../admit/door.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { OutlookApi } from "../../../live/outlook/apiCore.js";
import { listOutlookCategories, resolveCategoryChange } from "../../../live/outlook/categories.js";
import type { OutlookError } from "../../../live/outlook/errors.js";
import type { OutlookMessageSummary } from "../../../live/outlook/messages.js";
import {
  applyOutlookChange,
  type OutlookChangePlan,
  planCategory,
  planMark,
  planMove,
  resolveTargets,
} from "../../../live/outlook/mutations.js";
import { renderOutlookChangeOutcomeText, renderOutlookChangePlanText } from "../../../live/outlook/render.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import type { OutlookArgsError } from "./errors.js";
import { jsonOut, type OutlookShellDeps, productionOutlookShellDeps, refuseUsage, shellHome } from "./shell.js";
import {
  type OutlookChangeArgs,
  type OutlookChangeRequest,
  parseOutlookArchiveArgs,
  parseOutlookCategoryArgs,
  parseOutlookMarkArgs,
} from "./writeCore.js";

const VERB_ARG_OFFSET = 4;

/** Plans a change over the targets once they are read. */
type Planner = (args: { targets: readonly OutlookMessageSummary[] }) => OutlookChangePlan;

/**
 * Resolve what a change NAMES — the destination folder, the categories — into a planner. Run before any message
 * is read, so a typo in a category or a mailbox with no Archive folder is refused before a read is spent.
 */
async function resolvePlanner({
  api,
  request,
  thread,
}: {
  api: OutlookApi;
  request: OutlookChangeRequest;
  thread: boolean;
}): Promise<Result<Planner, OutlookError>> {
  if (request.kind === "mark") {
    return ok(({ targets }) => planMark({ read: request.read, targets, thread }));
  }
  if (request.kind === "archive") {
    const destination = await api.getFolder({ reference: request.restore ? "inbox" : "archive" });
    return destination.map(
      (folder): Planner =>
        ({ targets }) =>
          planMove({ destinationId: folder.id, targets, thread }),
    );
  }
  const master = await listOutlookCategories({ api });
  if (master.isErr()) {
    return err(master.error);
  }
  return resolveCategoryChange({ add: request.add, master: master.value, remove: request.remove }).map(
    (change): Planner =>
      ({ targets }) =>
        planCategory({ change, targets, thread }),
  );
}

/**
 * Read every target and plan the change the request asks for. Nothing is written here.
 *
 * @param args the parsed change
 * @returns the plan, or the first read or resolution that failed
 */
export async function planChange({
  api,
  args,
}: {
  api: OutlookApi;
  args: OutlookChangeArgs;
}): Promise<Result<OutlookChangePlan, OutlookError>> {
  const planner = await resolvePlanner({ api, request: args.request, thread: args.thread });
  if (planner.isErr()) {
    return err(planner.error);
  }
  const targets = await resolveTargets({ api, ids: args.ids, thread: args.thread });
  return targets.map((read) => planner.value({ targets: read }));
}

/**
 * The door request one change makes: the verb and COUNTS only, never a subject, a sender or an id list.
 *
 * @returns the request
 */
function changeDoorRequest({
  plan,
  home,
}: {
  plan: OutlookChangePlan;
  home: string;
}): Parameters<typeof throughDoor>[0]["request"] {
  return {
    action: { kind: "verb", noun: "outlook", verb: plan.intent },
    artifact: {
      messages: plan.steps.length,
      thread: plan.thread,
      writes: plan.steps.filter((step) => step.kind !== "unchanged").length,
    },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}

/**
 * Run one change verb: plan, stop on `--dry-run`, else apply through the door and report.
 *
 * @param verb the verb, which names the capabilities its session must carry
 * @param parse the verb's pure parser
 * @returns the process exit code — 1 when any write failed
 */
export async function runOutlookChange({
  rest,
  deps,
  verb,
  parse,
}: {
  rest: readonly string[];
  deps: OutlookShellDeps;
  verb: string;
  parse: (args: { rest: readonly string[] }) => Result<OutlookChangeArgs, OutlookArgsError>;
}): Promise<number> {
  const parsed = parse({ rest });
  if (parsed.isErr()) {
    return refuseUsage({ deps, error: parsed.error });
  }
  const args = parsed.value;
  const home = shellHome({ deps, named: args.home });
  const session = await deps.session({ home, verb });
  if (session.isErr()) {
    deps.warn(session.error.message);
    return EXIT_ERROR;
  }
  const { api } = session.value;
  const planned = await planChange({ api, args });
  if (planned.isErr()) {
    deps.warn(planned.error.message);
    return EXIT_ERROR;
  }
  const plan = planned.value;
  if (args.dryRun) {
    deps.out(args.json ? jsonOut({ value: { applied: false, plan } }) : renderOutlookChangePlanText({ plan }));
    return EXIT_OK;
  }
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: () => applyOutlookChange({ api, plan }),
    request: changeDoorRequest({ home, plan }),
  });
  if (!routed.performed) {
    for (const line of notPerformedLines({ command: `slopweaver outlook ${verb}`, through: routed })) {
      deps.warn(line);
    }
    return EXIT_ERROR;
  }
  const outcome = routed.result;
  deps.out(args.json ? jsonOut({ value: { applied: true, outcome } }) : renderOutlookChangeOutcomeText({ outcome }));
  return outcome.failed === undefined ? EXIT_OK : EXIT_ERROR;
}

/** `slopweaver outlook category`. */
export const outlookCategoryCommand = defineCommand({
  run: (argv) =>
    runOutlookChange({
      deps: productionOutlookShellDeps(),
      parse: parseOutlookCategoryArgs,
      rest: argv.slice(VERB_ARG_OFFSET),
      verb: "category",
    }),
});

/** `slopweaver outlook mark`. */
export const outlookMarkCommand = defineCommand({
  run: (argv) =>
    runOutlookChange({
      deps: productionOutlookShellDeps(),
      parse: parseOutlookMarkArgs,
      rest: argv.slice(VERB_ARG_OFFSET),
      verb: "mark",
    }),
});

/** `slopweaver outlook archive`. */
export const outlookArchiveCommand = defineCommand({
  run: (argv) =>
    runOutlookChange({
      deps: productionOutlookShellDeps(),
      parse: parseOutlookArchiveArgs,
      rest: argv.slice(VERB_ARG_OFFSET),
      verb: "archive",
    }),
});
