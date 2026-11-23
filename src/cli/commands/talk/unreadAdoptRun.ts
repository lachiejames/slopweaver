/**
 * `slopweaver talk unread-adopt` — mark every stretch stamped before an instant read for one cursor, without printing
 * them: a preview with a digest, then an apply that quotes it, then a receipt.
 *
 * For a backlog another reader already read — a home carried from another machine, whose supervisor read every word
 * there — never for words nobody has read: `talk unread --mark` is the verb that reads. What is adopted, and why a
 * line that will not parse is never adopted, is `src/talk/unreadAdopt.ts`.
 */
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { type AdoptPlan, planUnreadAdopt } from "../../../talk/unreadAdopt.js";
import { type AdoptReceipt, adoptReceiptOf, appendAdoptReceipt } from "../../../talk/unreadAdoptReceipts.js";
import { unreadCursorPath, writeUnreadCursorBehindRecord } from "../../../talk/unreadCursorStore.js";
import { UnreadErrors } from "../../../talk/unreadErrors.js";
import { readUnread } from "../../../talk/unreadRead.js";
import type { UnreadCursor } from "../../../talk/unreadWords.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { talkHomeOf } from "./args.js";
import { parseUnreadAdoptArgs, type UnreadAdoptArgs } from "./unreadAdoptArgs.js";
import { TALK_UNREAD_ADOPT_USAGE } from "./usage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "unread-adopt", ...]`. */
const VERB_ARG_OFFSET = 4;

/**
 * The preview's text: what the adopt passes, per call, what stays unread, and how to apply exactly this.
 *
 * @param args the invocation
 * @param plan what an apply would write
 * @returns the lines to print
 */
export function adoptPreviewLines({ args, plan }: { args: UnreadAdoptArgs; plan: AdoptPlan }): readonly string[] {
  const lines = [
    `talk unread-adopt: ${String(plan.stretches)} stretch(es) of their speech on ${String(plan.calls.length)} call(s), ` +
      `every line stamped before ${plan.beforeIso}, would be marked read for the ${args.cursor} cursor WITHOUT printing`,
  ];
  for (const call of plan.calls) {
    lines.push(
      `  ${call.callId}  ${String(call.stretches)} stretch(es), ${String(call.lines)} line(s), ` +
        `${call.firstAtIso} .. ${call.lastAtIso}; ${String(call.linesLeft)} line(s) stay unread`,
    );
  }
  if (plan.foreignStretches > 0) {
    lines.push(`  and ${String(plan.foreignStretches)} stretch(es) another console recorded, passed with them`);
  }
  // A line the call schema refused is printed whole, never adopted unseen: it may be the owner's words.
  for (const line of plan.unparseablePassed) {
    lines.push(`  passed, not a call line: ${line.callId} at byte ${String(line.byteOffset)}`);
    lines.push(`    ${line.text}`);
  }
  lines.push(
    `stays unread: ${String(plan.stretchesLeft)} stretch(es) at or after ${plan.beforeIso}, and ` +
      `${String(plan.unparseableLeft)} line(s) that will not parse — talk unread prints them`,
  );
  lines.push(`digest: ${plan.digest}`);
  return lines;
}

/**
 * Print a preview, in the chosen shape.
 *
 * @param args the invocation
 * @param plan what an apply would write
 */
function printPreview({ args, plan }: { args: UnreadAdoptArgs; plan: AdoptPlan }): void {
  if (args.json) {
    const { cursor: _cursor, ...shown } = plan;
    logger.out({
      line: safeJsonStringify({ label: "talk unread-adopt preview", value: { ...shown, applied: false } }),
    });
    return;
  }
  for (const line of adoptPreviewLines({ args, plan })) {
    logger.out({ line });
  }
  logger.out({
    line:
      `to adopt exactly this: slopweaver talk unread-adopt --before ${plan.beforeIso} --cursor ${args.cursor} ` +
      `--why ${JSON.stringify(args.why)} --approve ${plan.digest}`,
  });
}

/**
 * Write the approved plan: the cursor through the same compare-and-swap a mark takes, installed only behind its stored
 * receipt.
 *
 * @param args the invocation, carrying the approval and its reason
 * @param home the Slopweaver home
 * @param plan the plan this read computed, whose digest the approval matched
 * @param readCursor the cursor as the read found it — what the swap compares against
 * @returns the process exit code
 */
function applyPlan({
  args,
  home,
  plan,
  readCursor,
}: {
  args: UnreadAdoptArgs;
  home: string;
  plan: AdoptPlan;
  readCursor: UnreadCursor | undefined;
}): number {
  // What is about to be written is printed first, as a mark prints its batch before recording it.
  if (!args.json) {
    for (const line of adoptPreviewLines({ args, plan })) {
      logger.out({ line });
    }
  }
  // The receipt is stored while the new cursor is only staged, and the cursor installs only behind a stored receipt:
  // a receipt that cannot be written refuses the apply with the cursor where it stood, never after it moved.
  const receipt = adoptReceiptOf({ cursor: args.cursor, plan, why: args.why });
  const written = writeUnreadCursorBehindRecord({
    cursor: plan.cursor,
    home,
    name: args.cursor,
    nowIso: args.nowIso,
    read: readCursor,
    record: () => appendAdoptReceipt({ home, receipt }),
  });
  if (written.isErr()) {
    if (written.error.code === "CURSOR_INSTALL_FAILED") {
      logger.error({
        msg:
          `talk unread-adopt: ${written.error.message}; the receipt for digest ${plan.digest} records an adopt that ` +
          "did not happen, so preview again — the cursor stands where it was",
      });
      return EXIT_ERROR;
    }
    logger.error({ msg: `talk unread-adopt: ${written.error.message} — nothing was adopted` });
    return EXIT_ERROR;
  }
  printReceipt({
    args,
    cursorPath: written.value.cursorPath,
    plan,
    receipt,
    receiptsPath: written.value.recordPath,
  });
  return EXIT_OK;
}

/**
 * Print what an apply wrote, in the chosen shape: where the cursor now stands, and the receipt left behind it.
 *
 * @param args the invocation
 * @param cursorPath the cursor file the apply installed
 * @param plan the plan that was applied
 * @param receipt the receipt the apply stored
 * @param receiptsPath the file the receipt was appended to
 */
function printReceipt({
  args,
  cursorPath,
  plan,
  receipt,
  receiptsPath,
}: {
  args: UnreadAdoptArgs;
  cursorPath: string;
  plan: AdoptPlan;
  receipt: AdoptReceipt;
  receiptsPath: string;
}): void {
  if (args.json) {
    logger.out({
      line: safeJsonStringify({
        label: "talk unread-adopt receipt",
        value: { applied: true, cursorPath, receipt, receiptsPath },
      }),
    });
    return;
  }
  logger.out({
    line:
      `talk unread-adopt: adopted ${String(plan.stretches)} stretch(es) on ${String(plan.calls.length)} call(s) ` +
      `before ${plan.beforeIso} for the ${args.cursor} cursor (${cursorPath})`,
  });
  logger.out({ line: `  receipt ${plan.digest} appended to ${receiptsPath}` });
  logger.out({
    line: `  ${String(plan.stretchesLeft)} stretch(es) at or after it stay unread — talk unread prints them`,
  });
}

/**
 * Run the `talk unread-adopt` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runTalkUnreadAdopt(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_UNREAD_ADOPT_USAGE });
    return EXIT_OK;
  }
  const parsed = parseUnreadAdoptArgs({ clockIso: new Date().toISOString(), rest });
  if (parsed.isErr()) {
    logger.error({ msg: parsed.error.message });
    logger.error({ msg: TALK_UNREAD_ADOPT_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = talkHomeOf({ home: args.home });
  const path = unreadCursorPath({ home, name: args.cursor });
  if (path.isErr()) {
    logger.error({ msg: `talk unread-adopt: ${path.error.message}` });
    return EXIT_USAGE;
  }
  const read = readUnread({ all: true, home, name: args.cursor, nowIso: args.nowIso });
  if (read.isErr()) {
    logger.error({ msg: `talk unread-adopt: ${read.error.message}` });
    return EXIT_ERROR;
  }
  const plan = planUnreadAdopt({
    beforeIso: args.before,
    name: args.cursor,
    read: read.value,
    recordedAtIso: args.nowIso,
    why: args.why,
  });
  if (plan.calls.length === 0) {
    logger.out({
      line: `talk unread-adopt: nothing stamped before ${args.before} is unread for the ${args.cursor} cursor`,
    });
    return EXIT_EXPECTED_EMPTY;
  }
  if (args.approve === undefined) {
    printPreview({ args, plan });
    return EXIT_OK;
  }
  if (args.approve !== plan.digest) {
    const stale = UnreadErrors.adoptDigestStale({ approved: args.approve, current: plan.digest });
    logger.error({ msg: `talk unread-adopt: ${stale.message}` });
    return EXIT_ERROR;
  }
  return applyPlan({ args, home, plan, readCursor: read.value.cursor });
}

export const talkUnreadAdoptCommand = defineCommand({ run: runTalkUnreadAdopt });
