/**
 * `slopweaver cmux send` — type one line into a session's surface and submit it.
 *
 * This is the verb that closes the last raw-`cmux` gap the supervisor genuinely needed, and it is worth
 * two sentences on why it is not merely a wrapper:
 *
 * - **It addresses by id.** `surface.send_text` given a `workspace:N` ref that names nothing does NOT fail —
 *   it silently types into whatever surface is FOCUSED (measured: it typed into the owner's own
 *   supervisor session and answered `ok`). Refs go stale because cmux renumbers them as workspaces close, so
 *   the raw call's foot-gun is not hypothetical. This resolves the ref first and refuses if it names nothing.
 * - **It submits, and it CHECKS that the submit took.** A paste alone is swallowed by bracketed paste on
 *   anything that wraps, and a `send-key enter` fired immediately after is absorbed by the paste still being
 *   processed. `skills/supervisor/SKILL.md` carried that as a remembered two-step ("a separate `send-key
 *   enter` after it is mandatory"); it is a property of the verb, delay included. The delay alone was not
 *   enough — 2 of 20 live composers held an unsent line — so the verb now reads the composer
 *   back, presses one bare Enter on a line that never left it, and answers `resubmitted` or `stranded`
 *   rather than `submitted`. `cmux/reach.ts` carries the measurement and why the criterion is the composer's
 *   attribute rather than its text.
 * - **It says whether the line was ACCEPTED or merely QUEUED**, and `--interrupt` makes it arrive either way.
 *   A session parked on a long wait is mid-turn, so a line sent to it queues; this verb used to answer
 *   `submitted` regardless, and that cost the owner an hour on a thirty-second job. See
 *   `cmux/reach.ts` for the incident and `cmux/turnBusy.ts` for why neither delivery witness in this
 *   repository can see a queued line at all.
 * - **It refuses the pinned supervisor**, unless the caller IS that workspace. That box is the one the owner
 *   types into, and a spawned session once delivered its report there with this exact verb, a class of problem the owner should never have to ask about twice. See
 *   `cmux/supervisorWorkspace.ts` — the same message is what `admit/cmuxSendSupervisorGuard.ts` refuses the
 *   shell command with, before this verb's own process even starts.
 * - **It never pastes a relay long enough to lose its middle.** When its paste would pass `RELAY_INLINE_MAX_CHARS` the text is
 *   written to `$SLOPWEAVER_HOME/cmux-relays/`, read back byte for byte, and the session is sent one short
 *   line naming the file. A paste of 1,418 characters reached a seat with 922 of them gone
 *   from the middle and this verb answering `submitted`; `cmux/relayFile.ts` carries the measurement.
 */
import { readFileSync } from "node:fs";

import { err, ok, type Result } from "#lib/result.js";
import { safeFs } from "#lib/safeBoundary.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";
import {
  pastesWhole,
  planRelay,
  type RelayFileError,
  RelayFileErrors,
  relayFilePath,
  relayPointerLine,
} from "../../../cmux/relayFile.js";
import { supervisorSendRefusal } from "../../../cmux/supervisorWorkspace.js";
import { describeSendDisposition } from "../../../cmux/turnBusy.js";
import { logger } from "../../../lib/logger.js";
import { parseDeliveryFlag } from "../../../sessionHarness/delivery.js";
import { parseHarnessFlag, withNamedSessionHarness } from "../../../sessionHarness/harnessChoice.js";
import type { SessionDelivery, SessionHarness } from "../../../sessionHarness/sessionHarness.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { cmuxUsage, parseCmuxArgs, stringFlag, VERB_ARG_OFFSET } from "./core.js";

/** What is actually pasted: the text itself, or the pointer line to the file that holds it. */
interface StagedRelay {
  readonly line: string;
  readonly file?: { readonly path: string; readonly chars: number };
}

/**
 * Turn the caller's text into the line that is actually pasted — itself when it is short enough, otherwise a
 * file written and READ BACK byte for byte, and a pointer line naming it.
 *
 * A file that does not read back identical is a refusal, never a fall back to pasting: the paste is the path
 * that loses text silently, and a refusal cannot lose anything. The home is only consulted on the file branch,
 * so a broken relay directory can never block a short send.
 *
 * @param home the `--home` override, when one was passed
 * @returns the line to paste, or why the long relay could not be staged
 */
function stageRelay({ home, text }: { home: string | undefined; text: string }): Result<StagedRelay, RelayFileError> {
  const plan = planRelay({ text });
  if (plan.kind === "inline") {
    return ok({ line: text });
  }
  const { chars, sha256 } = plan;
  const relaysDir = stateHomePaths(home === undefined ? {} : { home }).cmuxRelays;
  const path = relayFilePath({ nowIso: new Date().toISOString(), relaysDir, sha256 });
  const line = relayPointerLine({ chars, path, sha256 });
  if (!pastesWhole({ line })) {
    return err(RelayFileErrors.pointerTooLong({ chars, path, pointerChars: line.length }));
  }
  const readBack = safeFs({
    execute: () => {
      writeFileAtomic({ contents: text, dirMode: 0o700, fileMode: 0o600, path });
      return readFileSync(path);
    },
    operation: "cmux send relay file",
    path,
  });
  if (readBack.isErr()) {
    return err(RelayFileErrors.io({ chars, detail: readBack.error.message, path }));
  }
  if (!readBack.value.equals(Buffer.from(text, "utf8"))) {
    return err(RelayFileErrors.mismatch({ chars, path }));
  }
  return ok({ file: { chars, path }, line });
}

/** Say where a long relay went, so the sender can point at the file if the seat asks what it was sent. */
function reportRelayFile({ file }: { file: StagedRelay["file"] }): void {
  if (file === undefined) {
    return;
  }
  logger.out({
    line: `relay: ${file.chars} characters went as a file, read back byte for byte, and the line sent names it — ${file.path}`,
  });
}

/**
 * Resolve the target, refuse the pinned supervisor, deliver the line through the session harness, and report
 * what really happened to it.
 *
 * Split out of {@link runCmuxSend} so that the argv half stays readable: everything here needs an open
 * harness and nothing here needs argv. The supervisor refusal and the relay file stay HERE, outside the
 * harness: the first is policy about the owner's own input box, the second this verb's own answer to a paste
 * losing its middle (`docs/session-harness.md`).
 */
async function sendThroughHarness({
  delivery,
  harness,
  home,
  ref,
  surfaceId,
  text,
}: {
  delivery: SessionDelivery;
  harness: SessionHarness;
  home: string | undefined;
  ref: string;
  surfaceId: string | undefined;
  text: string;
}): Promise<number> {
  const resolved = await harness.resolve({
    handle: ref,
    ...(surfaceId === undefined ? {} : { endpointId: surfaceId }),
  });
  if (resolved.isErr()) {
    logger.error({ msg: `cmux send: ${resolved.error.message}` });
    return EXIT_ERROR;
  }
  const { session } = resolved.value;
  const refused = supervisorSendRefusal({
    callerWorkspaceId: process.env["CMUX_WORKSPACE_ID"],
    target: { pinned: session.pinned, title: session.title, workspaceId: session.id, workspaceRef: session.handle },
  });
  if (refused !== undefined) {
    logger.error({ msg: `cmux send: ${refused.message}` });
    return EXIT_ERROR;
  }
  const staged = stageRelay({ home, text });
  if (staged.isErr()) {
    logger.error({ msg: `cmux send: REFUSED — ${staged.error.message}` });
    return EXIT_ERROR;
  }
  const sent = await harness.message({
    delivery,
    target: resolved.value,
    text: staged.value.line,
  });
  if (sent.isErr()) {
    logger.error({ msg: `cmux send: ${sent.error.message}` });
    return EXIT_ERROR;
  }
  const { disposition, inputDetail, interrupted } = sent.value;
  logger.out({ line: describeSendDisposition({ disposition, interrupted, workspaceRef: session.handle }) });
  reportRelayFile({ file: staged.value.file });
  // On a strand the operator's next question is always "what is stuck in there", and the disposition line
  // deliberately does not interpolate it — a stranded composer can hold a whole peer message.
  if (disposition === "stranded" && inputDetail !== undefined) {
    logger.out({ line: inputDetail });
  }
  return EXIT_OK;
}

/**
 * Run `cmux send`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runCmuxSend(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: cmuxUsage({ verb: "send" }) });
    return EXIT_OK;
  }
  const parsed = parseCmuxArgs({ rest, verb: "send" });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: cmuxUsage({ verb: "send" }) });
    return EXIT_USAGE;
  }
  const ref = stringFlag({ name: "workspace", parsed: parsed.value });
  const text = parsed.value.positionals.join(" ");
  if (ref === undefined || text.length === 0) {
    logger.error({ msg: "cmux send: --workspace and the text to send are both required" });
    logger.error({ msg: cmuxUsage({ verb: "send" }) });
    return EXIT_USAGE;
  }
  const surfaceId = stringFlag({ name: "surface", parsed: parsed.value });
  const delivery = parseDeliveryFlag({
    interrupt: parsed.value.values["interrupt"] === true,
    value: stringFlag({ name: "delivery", parsed: parsed.value }),
  });
  const harnessName = parseHarnessFlag({ value: stringFlag({ name: "harness", parsed: parsed.value }) });
  const flagErrors = [
    ...(delivery.isErr() ? [delivery.error] : []),
    ...(harnessName.isErr() ? [harnessName.error] : []),
  ];
  if (delivery.isErr() || harnessName.isErr()) {
    flagErrors.forEach((error) => {
      logger.error({ msg: `cmux send: ${error}` });
    });
    logger.error({ msg: cmuxUsage({ verb: "send" }) });
    return EXIT_USAGE;
  }
  const home = stringFlag({ name: "home", parsed: parsed.value });
  return withNamedSessionHarness({
    body: ({ harness }) => sendThroughHarness({ delivery: delivery.value, harness, home, ref, surfaceId, text }),
    name: harnessName.value,
  });
}

export const cmuxSendCommand = defineCommand({ run: runCmuxSend });
