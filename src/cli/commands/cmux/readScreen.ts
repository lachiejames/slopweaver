/**
 * `slopweaver cmux read-screen` — the inspectable operator surface over the same screen primitive
 * `turn dispatch --poll`/`--sweep` call directly. Cut out of `run.ts`, which keeps the verbs that MUTATE a
 * workspace (spawn, close, title); this one only reads, and prints what the surface shows right now.
 */
import { type ComposerReading, describeComposer, readComposer } from "../../../cmux/composer.js";
import { logger } from "../../../lib/logger.js";
import { err, ok } from "../../../lib/result.js";
import { withCmuxSessionHost } from "../../../sessionHarness/cmuxHost.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { cmuxUsage, numberFlag, parseCmuxVerb, stringFlag } from "./core.js";

/**
 * `cmux read-screen` — the inspectable operator surface for the same primitive `turn dispatch --poll`/
 * `--sweep` call directly (never shelling from one Slopweaver verb into another). Prints whatever the
 * surface currently shows, live, every time — never a cached value.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runCmuxReadScreen(argv: readonly string[]): Promise<number> {
  const parsed = parseCmuxVerb({ argv, verb: "read-screen" });
  if (typeof parsed === "number") {
    return parsed;
  }
  const workspaceRef = stringFlag({ name: "workspace", parsed });
  if (workspaceRef === undefined) {
    logger.error({ msg: "cmux read-screen: --workspace is required" });
    logger.error({ msg: cmuxUsage({ verb: "read-screen" }) });
    return EXIT_USAGE;
  }
  const scrollback = numberFlag({ name: "scrollback", parsed });
  if ("error" in scrollback) {
    logger.error({ msg: `cmux read-screen: ${scrollback.error}` });
    return EXIT_USAGE;
  }
  const surfaceId = stringFlag({ name: "surface", parsed });
  // A screen read is cmux-only by construction — the host surface names it as what stage 2 replaces with events.
  const read = await withCmuxSessionHost({
    body: async ({ harness, host }) => {
      const resolved = await harness.resolve({ handle: workspaceRef });
      if (resolved.isErr()) {
        return err(resolved.error);
      }
      const target = {
        ...(surfaceId === undefined ? {} : { surfaceId }),
        workspaceId: resolved.value.session.id,
      };
      const text = await host.readScreen({
        ...(scrollback.value === undefined ? {} : { scrollbackLines: scrollback.value }),
        target,
      });
      if (text.isErr()) {
        return err(text.error);
      }
      // The styled read is a SECOND call and is allowed to fail on its own: a screen the operator can read is
      // worth printing even where the composer cannot be attributed, and `unreadable` is a real answer this
      // verb prints rather than an error it exits on.
      const grid = await host.readScreenGrid({ target });
      const composer: ComposerReading = grid.isErr()
        ? { kind: "unreadable", reason: `the styled grid could not be read: ${grid.error.message}` }
        : readComposer({ grid: grid.value });
      return ok({ composer, text: text.value, workspaceRef: resolved.value.session.handle });
    },
  });
  if (read.isErr()) {
    logger.error({ msg: `cmux read-screen: ${read.error.message}` });
    return EXIT_ERROR;
  }
  if (parsed.values["json"] === true) {
    logger.out({ line: JSON.stringify(read.value) });
  } else {
    logger.out({ line: read.value.text });
    logger.out({ line: describeComposer({ reading: read.value.composer }) });
  }
  return EXIT_OK;
}

export const cmuxReadScreenCommand = defineCommand({ run: runCmuxReadScreen });
