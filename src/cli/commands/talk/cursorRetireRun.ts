/**
 * `slopweaver talk cursor-retire` — retire a reader's `talk unread` cursor that can no longer be trusted, so the next
 * chair starts on the first-read path instead of being refused on every read forever.
 *
 * Bare, it PREVIEWS and writes nothing: it runs the ordinary `talk unread` read over the cursor and is eligible only
 * when that read refuses with `CALL_PREFIX_CHANGED` or `CURSOR_MALFORMED`, counting every call whose read bytes
 * changed and printing the cursor file's sha256 and the exact apply command. `--apply` re-checks both under the
 * cursor's lock and moves the unchanged file into `talk/unread-cursors/retired/` beside a receipt
 * (`src/talk/cursorRetireStore.ts`). A healthy cursor stays; a gone call file is `talk quarantine`'s. MEASURED on
 * first need: a home carried through a sanitiser that rewrote 64 of the 129 call files its supervisor cursor named.
 */
import { grantSessionId } from "../../../hatch/grantSession.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { isBlank } from "../../../talk/callQuarantineLedger.js";
import {
  type CursorRetireAssessment,
  cursorRetireApplyCommand,
  cursorRetireNextSteps,
} from "../../../talk/cursorRetire.js";
import type { CursorRetireError } from "../../../talk/cursorRetireErrors.js";
import { applyCursorRetire, assessCursorRetire, type CursorRetireApplied } from "../../../talk/cursorRetireStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { talkHomeOf } from "./args.js";
import { parseCursorRetireArgs } from "./cursorRetireArgs.js";
import { TALK_CURSOR_RETIRE_USAGE } from "./usage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "cursor-retire", ...]`. */
const VERB_ARG_OFFSET = 4;

/** How many failing call ids the text preview names before it counts the rest. */
const NAMED_FAILING_CALLS = 5;

/**
 * The exit code a refusal means: nothing to retire is a legitimate empty status, a held lock is not yet, and
 * everything else is an error.
 *
 * @internal — {@link runTalkCursorRetire} is this module's public surface; exported for its own unit test.
 * @param error the refusal
 * @returns the exit code
 */
export function cursorRetireExit({ error }: { error: CursorRetireError }): number {
  if (error.code === "CURSOR_RETIRE_ABSENT" || error.code === "CURSOR_RETIRE_HEALTHY") {
    return EXIT_EXPECTED_EMPTY;
  }
  if (error.code === "CURSOR_RETIRE_LOCK_HELD") {
    return EXIT_DEFERRED;
  }
  return EXIT_ERROR;
}

/**
 * The text a preview prints: why the cursor is retirable, how many of its calls fail, its digest, and what to run.
 *
 * @internal — {@link runTalkCursorRetire} is this module's public surface; exported for its own unit test.
 * @param assessment what the preview found
 * @param home the `--home` given, `undefined` for the ambient one
 * @returns the lines
 */
export function cursorRetirePreviewLines({
  assessment,
  home,
}: {
  assessment: CursorRetireAssessment;
  home: string | undefined;
}): readonly string[] {
  const { name, path, cause, why, cursorCallCount, failingCallIds, sourceSha256 } = assessment;
  const lines = [`talk cursor-retire: cursor ${name} (${path}) is refused by talk unread with ${cause} — ${why}`];
  if (cursorCallCount === null) {
    lines.push("  it does not parse, so no call it names can be counted");
  } else {
    const named = failingCallIds.slice(0, NAMED_FAILING_CALLS).join(", ");
    const more = failingCallIds.length - NAMED_FAILING_CALLS;
    const tail = more > 0 ? ` and ${String(more)} more` : "";
    lines.push(
      `  ${String(failingCallIds.length)} of the ${String(cursorCallCount)} calls it names fail their prefix proof: ${named}${tail}`,
    );
  }
  const [read, adopt] = cursorRetireNextSteps({ home, name });
  lines.push(
    `  sourceSha256: ${sourceSha256}`,
    "  nothing was written; to move it, unchanged, into talk/unread-cursors/retired/ beside a receipt:",
    `  ${cursorRetireApplyCommand({ home, name, sourceSha256 })}`,
    `  then ${read}, and ${adopt} to adopt what an earlier chair already read`,
  );
  return lines;
}

/**
 * The text an apply prints: where the cursor went and what to run next.
 *
 * @internal — {@link runTalkCursorRetire} is this module's public surface; exported for its own unit test.
 * @param applied what the apply wrote
 * @param home the `--home` given, `undefined` for the ambient one
 * @returns the lines
 */
export function cursorRetireAppliedLines({
  applied,
  home,
}: {
  applied: CursorRetireApplied;
  home: string | undefined;
}): readonly string[] {
  const { receipt, retiredPath, receiptPath } = applied;
  const [read, adopt] = cursorRetireNextSteps({ home, name: receipt.name });
  return [
    `talk cursor-retire: cursor ${receipt.name} retired to ${retiredPath} (receipt ${receiptPath}); ` +
      "talk unread now reads as a first read",
    `  next: ${read}, then ${adopt} to adopt what an earlier chair already read`,
  ];
}

/**
 * The visible session a receipt records: whatever `grantSessionId` resolves, or `null` outside any visible session.
 *
 * @returns the session id, or `null`
 */
function retiringSession(): string | null {
  const visible = grantSessionId({ env: process.env });
  if (visible === undefined || isBlank({ text: visible })) {
    return null;
  }
  return visible;
}

/**
 * Run the `talk cursor-retire` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runTalkCursorRetire(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_CURSOR_RETIRE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseCursorRetireArgs({ rest });
  if (parsed.isErr()) {
    logger.error({ msg: parsed.error.message });
    logger.error({ msg: TALK_CURSOR_RETIRE_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = talkHomeOf({ home: args.home });
  const nowIso = new Date().toISOString();
  if (args.apply === undefined) {
    const assessed = assessCursorRetire({ home, name: args.cursor, nowIso });
    if (assessed.isErr()) {
      logger.error({ msg: `talk cursor-retire: ${assessed.error.message}` });
      return cursorRetireExit({ error: assessed.error });
    }
    const assessment = assessed.value;
    if (args.json) {
      const apply = cursorRetireApplyCommand({
        home: args.home,
        name: args.cursor,
        sourceSha256: assessment.sourceSha256,
      });
      logger.out({ line: safeJsonStringify({ label: "talk cursor-retire preview", value: { ...assessment, apply } }) });
      return EXIT_OK;
    }
    for (const line of cursorRetirePreviewLines({ assessment, home: args.home })) {
      logger.out({ line });
    }
    return EXIT_OK;
  }
  const applied = applyCursorRetire({
    home,
    name: args.cursor,
    nowIso,
    reason: args.apply.reason,
    session: retiringSession(),
    sourceSha256: args.apply.sourceSha256,
  });
  if (applied.isErr()) {
    logger.error({ msg: `talk cursor-retire: ${applied.error.message}` });
    return cursorRetireExit({ error: applied.error });
  }
  if (args.json) {
    logger.out({ line: safeJsonStringify({ label: "talk cursor-retire receipt", value: applied.value }) });
    return EXIT_OK;
  }
  for (const line of cursorRetireAppliedLines({ applied: applied.value, home: args.home })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

export const talkCursorRetireCommand = defineCommand({ run: runTalkCursorRetire });
