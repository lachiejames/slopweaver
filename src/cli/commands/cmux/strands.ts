/**
 * `slopweaver cmux strands` — every composer in the fleet that is holding a line nobody submitted, and the
 * opt-in that presses them through.
 *
 * The read half answers a question the owner asked directly and no verb could: how many sessions are sitting
 * on an unsent message right now. `cmux/strandSweep.ts` carries the measurement that produced it and why the
 * denominator is printed rather than the count alone.
 *
 * The write half is `--submit`, and it is opt-in for one reason: pressing Enter on somebody else's composer
 * is an act on a live session. `cmux submit`'s own refusal is reused rather than re-decided — a `suggestion`
 * or `placeholder` is text Claude Code wrote itself, and submitting one puts the model's words into the
 * session as though a person had asked for them (owner ruling). `classifyStrands` never counts
 * one as stranded, so `--submit` cannot reach one at all.
 *
 * It skips the PINNED supervisor workspace, for the same reason `cmux send` refuses it: that box is the one
 * the owner types into, and a half-typed line of the owner's own is exactly the thing a sweep must not submit.
 */
import { type ComposerReading, readComposer } from "../../../cmux/composer.js";
import { classifyStrands, describeStrandReport, describeStrandRow, type StrandRow } from "../../../cmux/strandSweep.js";
import { logger } from "../../../lib/logger.js";
import { err, ok } from "../../../lib/result.js";
import { withCmuxSessionHost } from "../../../sessionHarness/cmuxHost.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { parseCmuxVerb } from "./core.js";

/**
 * Run `cmux strands`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runCmuxStrands(argv: readonly string[]): Promise<number> {
  const parsed = parseCmuxVerb({ argv, verb: "strands" });
  if (typeof parsed === "number") {
    return parsed;
  }
  const submit = parsed.values["submit"] === true;
  const swept = await withCmuxSessionHost({
    body: async ({ harness, host }) => {
      const listed = await harness.list();
      if (listed.isErr()) {
        return err(listed.error);
      }
      const rows: StrandRow[] = [];
      for (const session of listed.value) {
        if (session.pinned) {
          continue;
        }
        // A composer read is a screen read: cmux-only, named on the host surface as what stage 2 replaces.
        const target = { workspaceId: session.id };
        const grid = await host.readScreenGrid({ target });
        const reading: ComposerReading = grid.isErr()
          ? { kind: "unreadable", reason: `the styled grid could not be read: ${grid.error.message}` }
          : readComposer({ grid: grid.value });
        rows.push({
          reading,
          title: session.title,
          workspaceId: session.id,
          workspaceRef: session.handle,
        });
      }
      return ok(classifyStrands({ rows }));
    },
  });
  if (swept.isErr()) {
    logger.error({ msg: `cmux strands: ${swept.error.message}` });
    return EXIT_ERROR;
  }
  const report = swept.value;
  if (parsed.values["json"] === true) {
    logger.out({ line: JSON.stringify(report) });
    return EXIT_OK;
  }
  report.rows.forEach((row) => {
    logger.out({ line: describeStrandRow({ row }) });
  });
  logger.out({ line: describeStrandReport({ report }) });
  if (!submit) {
    return EXIT_OK;
  }
  return pressThrough({ stranded: report.stranded });
}

/**
 * Press one bare Enter on every stranded composer the sweep found — typing nothing, on each in turn.
 *
 * A failure on one workspace does not stop the rest: the whole point of a sweep is that it clears the
 * backlog, and one surface refusing a keystroke says nothing about the next.
 *
 * @param stranded the rows holding an unsubmitted line
 * @returns the process exit code — non-zero when any one of them refused the keystroke
 */
async function pressThrough({ stranded }: { stranded: readonly StrandRow[] }): Promise<number> {
  if (stranded.length === 0) {
    return EXIT_OK;
  }
  let refused = 0;
  await withCmuxSessionHost({
    body: async ({ host }) => {
      for (const row of stranded) {
        const pressed = await host.submitComposer({ target: { workspaceId: row.workspaceId } });
        if (pressed.isErr()) {
          refused += 1;
          logger.error({ msg: `cmux strands: ${row.workspaceRef} refused the keystroke — ${pressed.error.message}` });
        } else {
          logger.out({ line: `cmux strands: pressed ${row.workspaceRef}'s composer through — nothing was typed` });
        }
      }
    },
  });
  logger.out({
    line:
      `cmux strands: read back what each one did with \`slopweaver cmux list --json\` — a composer that was ` +
      `already empty absorbs the keystroke and nothing happens, which is the measured no-op this sweep ` +
      `relies on (src/cmux/spawn.ts)`,
  });
  return refused === 0 ? EXIT_OK : EXIT_ERROR;
}

export const cmuxStrandsCommand = defineCommand({ run: runCmuxStrands });
