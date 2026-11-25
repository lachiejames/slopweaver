/**
 * `slopweaver cmux picture <handle> --harness app` — what one session the desktop app hosts has DONE in this run of
 * the app: its tool calls counted by kind, the ones in flight and the last ended, read live over the app's socket
 * (`../../../sessionHarness/pictureWire.ts`). Read-only: one question to the app, nothing written anywhere.
 *
 * It is the picture's FACTS layer and never its words: no tool's input, output or title crosses the wire, and a tool
 * is named only when its vendor gave a bare identifier. Only the app harness has it: cmux hosts no session worker to
 * observe a tool call, so `--harness cmux` is refused.
 */
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import type { AppHarnessResponse } from "../../../sessionHarness/appProtocol.js";
import {
  APP_SOCKET_ROOT,
  type AppTransportFailure,
  socketAppTransport,
} from "../../../sessionHarness/appSocketTransport.js";
import { parseHarnessFlag } from "../../../sessionHarness/harnessChoice.js";
import type { AppSessionPicture } from "../../../sessionHarness/pictureWire.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { cmuxUsage, parseCmuxArgs, stringFlag, VERB_ARG_OFFSET } from "./core.js";
import { pictureLines } from "./pictureOutput.js";

/** A picture read is one registry lookup in the app; anything near this is an app that is not answering. */
const PICTURE_TIMEOUT_MS = 30_000;

/**
 * What `cmux picture`'s arguments ask for, or the lines refusing them.
 *
 * @param rest the argv after the verb
 * @returns the one handle to read and whether to print JSON, or the refusal's lines
 * @internal exported for its unit test
 */
export function pictureAskOf({
  rest,
}: {
  rest: readonly string[];
}):
  | { readonly kind: "ask"; readonly handle: string; readonly json: boolean }
  | { readonly kind: "refused"; readonly lines: readonly string[] } {
  const parsed = parseCmuxArgs({ rest, verb: "picture" });
  if (parsed.isErr()) {
    return { kind: "refused", lines: [...parsed.error, cmuxUsage({ verb: "picture" })] };
  }
  const harnessName = parseHarnessFlag({ value: stringFlag({ name: "harness", parsed: parsed.value }) });
  if (harnessName.isErr()) {
    return { kind: "refused", lines: [`cmux picture: ${harnessName.error}`] };
  }
  if (harnessName.value !== "app") {
    return {
      kind: "refused",
      lines: ["cmux picture: only --harness app has a worker that observes tool calls; cmux hosts none to read"],
    };
  }
  const [handle, ...extra] = parsed.value.positionals;
  if (handle === undefined || handle.length === 0 || extra.length > 0) {
    return {
      kind: "refused",
      lines: ["cmux picture: name exactly one app session handle", cmuxUsage({ verb: "picture" })],
    };
  }
  return { handle, json: parsed.value.values["json"] === true, kind: "ask" };
}

/**
 * The picture the app answered, or the one line saying why there is none.
 *
 * @param answered what the socket transport returned for `picture.read`
 * @returns the picture, or the failure line naming an app that predates picture reads apart from any other
 * @internal exported for its unit test
 */
export function answeredPictureOf({
  answered,
}: {
  answered: Result<AppHarnessResponse, AppTransportFailure>;
}):
  | { readonly kind: "picture"; readonly picture: AppSessionPicture }
  | { readonly kind: "failed"; readonly line: string } {
  if (answered.isErr()) {
    if (answered.error.kind === "refused" && answered.error.code === "BAD_REQUEST") {
      return {
        kind: "failed",
        line: "cmux picture: this app predates picture reads; update the Slopweaver desktop app",
      };
    }
    return { kind: "failed", line: `cmux picture: ${answered.error.message}` };
  }
  if (answered.value.kind !== "picture") {
    return { kind: "failed", line: `cmux picture: the desktop app answered ${answered.value.kind}, not picture` };
  }
  return { kind: "picture", picture: answered.value.picture };
}

/**
 * Run `cmux picture`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runCmuxPicture(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: cmuxUsage({ verb: "picture" }) });
    return EXIT_OK;
  }
  const ask = pictureAskOf({ rest });
  if (ask.kind === "refused") {
    ask.lines.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_USAGE;
  }
  const answered = answeredPictureOf({
    answered: await socketAppTransport({ root: APP_SOCKET_ROOT })({
      request: { handle: ask.handle, kind: "picture.read" },
      timeoutMs: PICTURE_TIMEOUT_MS,
    }),
  });
  if (answered.kind === "failed") {
    logger.error({ msg: answered.line });
    return EXIT_ERROR;
  }
  if (ask.json) {
    logger.out({ line: JSON.stringify(answered.picture) });
    return EXIT_OK;
  }
  for (const line of pictureLines({ picture: answered.picture })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

export const cmuxPictureCommand = defineCommand({ run: runCmuxPicture });
