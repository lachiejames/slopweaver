/**
 * `slopweaver cmux submit` — press Enter on a session's composer and nothing else.
 *
 * The verb for ONE state, and it is the state that produced the stranded pickups: a session
 * holding its whole instruction in the composer, never submitted, because `sendLine`'s follow-up Enter did
 * not take. Until now the only door verb that could rescue it was `cmux send`, which TYPES the text before
 * submitting — so on a composer that already holds the line it appends a second copy, which is the duplicate
 * pickup `cmux/spawn.ts` removed an automatic retry for. Pushing a stranded pickup through was therefore
 * being done by hand, outside the door.
 *
 * MEASURED live against Claude Code v2.1.258 (the same reproduction `cmux/spawn.ts`'s
 * `MAX_RESUBMIT_VERIFY_POLLS` names): one bare `surface.send_key enter` submitted a stranded composer, and
 * cmux's `latest_submitted_message` named the line 20.0 s later. The same keystroke sent to a busy session
 * whose composer was empty did nothing at all — `latest_submitted_at` unmoved across eight reads over 32 s.
 * That is why this verb is safe to reach for on a session you are unsure about: it can submit what is there,
 * and it cannot invent what is not.
 *
 * Addressed by id like every other cmux verb, for the measured reason in `cmux/client.ts`'s `CmuxTarget`: a
 * `workspace:N` ref that names nothing types into the FOCUSED surface instead, which during a spawn is the
 * supervisor's own.
 *
 * ## Why it reads the composer before pressing anything
 *
 * The one thing that can be sitting in a stranded composer other than a stranded pickup is text Claude Code
 * WROTE ITSELF — a prompt suggestion, drawn grey (`cmux/composer.ts`, and the owner's ruling in
 * its header). Pressing Enter on one submits the model's own words into the session as though a person had
 * asked for them, which is the same failure as reading one and believing it, with the consequences actually
 * carried out. So this verb reads the box first and REFUSES a suggestion, naming what it saw. `--force`
 * submits anyway, for the case where a person has genuinely decided to accept the suggestion; an
 * `unreadable` box is not refused, because refusing every host this repository cannot read would break the
 * rescue the verb exists for — it says so instead.
 */
import { type ComposerReading, describeComposer, readComposer } from "../../../cmux/composer.js";
import { logger } from "../../../lib/logger.js";
import { err, ok } from "../../../lib/result.js";
import { withCmuxSessionHost } from "../../../sessionHarness/cmuxHost.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { cmuxUsage, parseCmuxVerb, stringFlag } from "./core.js";

/**
 * Run `cmux submit`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runCmuxSubmit(argv: readonly string[]): Promise<number> {
  const parsed = parseCmuxVerb({ argv, verb: "submit" });
  if (typeof parsed === "number") {
    return parsed;
  }
  const ref = stringFlag({ name: "workspace", parsed });
  if (ref === undefined) {
    logger.error({ msg: "cmux submit: --workspace is required" });
    logger.error({ msg: cmuxUsage({ verb: "submit" }) });
    return EXIT_USAGE;
  }
  const surfaceId = stringFlag({ name: "surface", parsed });
  const force = parsed.values["force"] === true;
  const submitted = await withCmuxSessionHost({
    body: async ({ harness, host }) => {
      const resolved = await harness.resolve({ handle: ref });
      if (resolved.isErr()) {
        return err(resolved.error);
      }
      const target = {
        ...(surfaceId === undefined ? {} : { surfaceId }),
        workspaceId: resolved.value.session.id,
      };
      const grid = await host.readScreenGrid({ target });
      const reading: ComposerReading = grid.isErr()
        ? { kind: "unreadable", reason: `the styled grid could not be read: ${grid.error.message}` }
        : readComposer({ grid: grid.value });
      if (!force && (reading.kind === "suggestion" || reading.kind === "placeholder")) {
        return ok({ reading, submittedRef: undefined });
      }
      return (await host.submitComposer({ target })).map(() => ({
        reading,
        submittedRef: resolved.value.session.handle,
      }));
    },
  });
  if (submitted.isErr()) {
    logger.error({ msg: `cmux submit: ${submitted.error.message}` });
    return EXIT_ERROR;
  }
  const { reading, submittedRef } = submitted.value;
  logger.out({ line: describeComposer({ reading }) });
  if (submittedRef === undefined) {
    logger.error({
      msg:
        `cmux submit: REFUSED — nothing was typed into ${ref}, so pressing Enter would submit text Claude ` +
        `Code wrote itself as though a person had asked for it. Pass --force if you have decided to accept it.`,
    });
    return EXIT_ERROR;
  }
  logger.out({
    line:
      `submitted ${submittedRef}'s composer — nothing was typed, so this either sent a line that was ` +
      `already sitting there or did nothing at all. Read it back with: slopweaver cmux list --json`,
  });
  return EXIT_OK;
}

export const cmuxSubmitCommand = defineCommand({ run: runCmuxSubmit });
