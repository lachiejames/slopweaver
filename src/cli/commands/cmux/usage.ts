/**
 * `slopweaver cmux usage --harness app` — what each session the desktop app hosts has spent in this run of the app,
 * read live over its socket, each session named by the plan it spends and each plan summed
 * (`../../../sessionHarness/appUsage.ts`). Read-only: it asks the app one question and the plans register for the
 * aliases. Spend lands at each turn's end, so a session mid-turn has not counted that turn yet; poll until idle.
 *
 * Only the app harness has this: cmux hosts no session worker to count a turn, so `--harness cmux` is refused.
 */
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { readStoredPlanRegister } from "../../../plans/storePort.js";
import { productionPlanRegisterSeams } from "../../../plans/storeRows.js";
import type { AppHarnessResponse } from "../../../sessionHarness/appProtocol.js";
import {
  APP_SOCKET_ROOT,
  type AppTransportFailure,
  socketAppTransport,
} from "../../../sessionHarness/appSocketTransport.js";
import { recordedPlanChoices, type UsagePlanEntry, usageViewOf } from "../../../sessionHarness/appUsage.js";
import { parseHarnessFlag } from "../../../sessionHarness/harnessChoice.js";
import type { AppUsageReport } from "../../../sessionHarness/usageWire.js";
import { foldSessions, parseSessionLog } from "../../../sessions/session.js";
import { readSessionLogText } from "../../../sessions/sessionStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { cmuxUsage, parseCmuxArgs, stringFlag, VERB_ARG_OFFSET } from "./core.js";
import { redactedUsageView, usageLines } from "./usageOutput.js";

/** A usage read is one in-memory fold in the app; anything near this is an app that is not answering. */
const USAGE_TIMEOUT_MS = 30_000;

/**
 * What `cmux usage`'s flags ask for, or the lines refusing them.
 *
 * @param rest the argv after the verb
 * @returns the store to read the plans register from and whether to print JSON, or the refusal's lines
 * @internal exported for its unit test
 */
export function usageAskOf({
  rest,
}: {
  rest: readonly string[];
}):
  | { readonly kind: "ask"; readonly home: string | undefined; readonly json: boolean }
  | { readonly kind: "refused"; readonly lines: readonly string[] } {
  const parsed = parseCmuxArgs({ rest, verb: "usage" });
  if (parsed.isErr()) {
    return { kind: "refused", lines: [...parsed.error, cmuxUsage({ verb: "usage" })] };
  }
  const harnessName = parseHarnessFlag({ value: stringFlag({ name: "harness", parsed: parsed.value }) });
  if (harnessName.isErr()) {
    return { kind: "refused", lines: [`cmux usage: ${harnessName.error}`] };
  }
  if (harnessName.value !== "app") {
    return {
      kind: "refused",
      lines: ["cmux usage: only --harness app counts a session's turns; cmux hosts no worker to read"],
    };
  }
  return {
    home: stringFlag({ name: "home", parsed: parsed.value }),
    json: parsed.value.values["json"] === true,
    kind: "ask",
  };
}

/**
 * The usage report the app answered, or the one line saying why there is none.
 *
 * @param answered what the socket transport returned for `usage.read`
 * @returns the report, or the failure line naming an app that predates usage apart from any other
 * @internal exported for its unit test
 */
export function answeredReportOf({
  answered,
}: {
  answered: Result<AppHarnessResponse, AppTransportFailure>;
}): { readonly kind: "report"; readonly report: AppUsageReport } | { readonly kind: "failed"; readonly line: string } {
  if (answered.isErr()) {
    if (answered.error.kind === "refused" && answered.error.code === "BAD_REQUEST") {
      return { kind: "failed", line: "cmux usage: this app predates usage; update the Slopweaver desktop app" };
    }
    return { kind: "failed", line: `cmux usage: ${answered.error.message}` };
  }
  if (answered.value.kind !== "usage") {
    return { kind: "failed", line: `cmux usage: the desktop app answered ${answered.value.kind}, not usage` };
  }
  return { kind: "report", report: answered.value.report };
}

/**
 * Run `cmux usage`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runCmuxUsage(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: cmuxUsage({ verb: "usage" }) });
    return EXIT_OK;
  }
  const ask = usageAskOf({ rest });
  if (ask.kind === "refused") {
    ask.lines.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_USAGE;
  }
  const answered = answeredReportOf({
    answered: await socketAppTransport({ root: APP_SOCKET_ROOT })({
      request: { kind: "usage.read" },
      timeoutMs: USAGE_TIMEOUT_MS,
    }),
  });
  if (answered.kind === "failed") {
    logger.error({ msg: answered.line });
    return EXIT_ERROR;
  }
  let home = slopweaverHome();
  if (ask.home !== undefined) {
    home = ask.home;
  }
  const register = await readStoredPlanRegister({ home, seams: productionPlanRegisterSeams() });
  if (register.isErr()) {
    logger.error({ msg: `cmux usage: could not read the plans register: ${register.error.message}` });
    return EXIT_ERROR;
  }
  let plans: readonly UsagePlanEntry[] = [];
  if (register.value !== undefined) {
    plans = register.value.plans;
  }
  // Each session's recorded plan choice comes off its ledger row: the app's session id is the row's `sessionId`.
  // A line the ledger could not read just leaves its session without one; `session list` is where that is reported.
  const { events } = parseSessionLog({ text: readSessionLogText({ home }) });
  const recorded = recordedPlanChoices({ items: foldSessions({ events }) });
  const view = redactedUsageView({ view: usageViewOf({ plans, recorded, report: answered.report }) });
  if (ask.json) {
    logger.out({ line: JSON.stringify(view) });
    return EXIT_OK;
  }
  for (const line of usageLines({ view })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

export const cmuxUsageCommand = defineCommand({ run: runCmuxUsage });
