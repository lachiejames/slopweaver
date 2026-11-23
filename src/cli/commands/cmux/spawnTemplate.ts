/**
 * `cmux spawn`'s launch template: resolved from `--template`, the doc's `template:` line and the doc's role,
 * printed, and refused where it would be a knob that does nothing.
 *
 * A leaf of its own for the reason `./spawnPins.ts` is one: a decision about argv and the doc alone, reached
 * before any worktree or workspace effect, kept out of `./run.ts`'s decision tree.
 */
import { type LaunchTemplate, launchTemplateLine, resolveLaunchTemplate } from "../../../cmux/launchTemplate.js";
import type { CmuxDriver } from "../../../cmux/pickupCommand.js";
import { classifySessionRole } from "../../../cmux/role.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import { duplicateKeyProblem } from "../../../handover/docFlat.js";
import { logger } from "../../../lib/logger.js";
import { EXIT_USAGE } from "../../exitCodes.js";
import type { ParsedFlags } from "../../parseFlags.js";

import { stringFlag } from "./core.js";

/**
 * Why a `codex` spawn cannot take an explicit `--template`, or `undefined` when nothing stands in the way.
 *
 * It REFUSES, the way `--effort` on codex does: Codex expands no `@` import, so it never loaded the rules a
 * template leaves out, and accepting the flag would report a knob set that changed nothing.
 *
 * @internal — exported for its own unit test; {@link resolveSpawnTemplate} is the only production caller
 * @param driver the already-resolved host this spawn boots
 * @param flag the `--template` the caller passed, or `undefined` when it passed none
 * @returns the refusal text, or `undefined`
 */
export function codexTemplateRefusal({
  driver,
  flag,
}: {
  driver: CmuxDriver;
  flag: string | undefined;
}): string | undefined {
  if (flag === undefined || driver !== "codex") {
    return undefined;
  }
  return (
    `--template ${flag} cannot be set on a codex spawn: codex expands no @ import, so it never loads the ` +
    `rules a template leaves out and the flag would change nothing. Drop --template, or spawn on the claude driver`
  );
}

/**
 * The template refusals that need no host: a doubled `template:` line, or a template name nothing resolves.
 * Run ahead of the plan register read an omitted `--driver` makes, so an unreadable register never masks one.
 *
 * @param doc the handover doc being spawned, for its `template:` line and its role
 * @param parsed the verb's parsed flags
 * @returns the exit code to stop on, or undefined when the template resolves
 */
export function refuseSpawnTemplate({ doc, parsed }: { doc: HandoverDoc; parsed: ParsedFlags }): number | undefined {
  const doubled = duplicateKeyProblem({ key: "template" });
  // The parser keeps the FIRST of two `template:` lines and reports the second, so a misspelt repeat would
  // otherwise boot the first unseen.
  if (doc.problems.includes(doubled)) {
    logger.error({ msg: `cmux spawn: ${doubled}` });
    return EXIT_USAGE;
  }
  const launch = resolveLaunchTemplate({
    docTemplate: doc.template,
    flag: stringFlag({ name: "template", parsed }),
    role: classifySessionRole({ docRole: doc.role }),
  });
  if ("error" in launch) {
    logger.error({ msg: `cmux spawn: ${launch.error}` });
    return EXIT_USAGE;
  }
  return undefined;
}

/**
 * The launch template this spawn boots from, printed with where it came from and what it leaves out — or the
 * exit code to stop on, for an unknown `--template` or one passed to a codex spawn.
 *
 * @param doc the handover doc being spawned, for its `template:` line and its role
 * @param driver the already-resolved host this spawn boots
 * @param parsed the verb's parsed flags
 * @returns the template, or the exit code to stop on
 */
export function resolveSpawnTemplate({
  doc,
  driver,
  parsed,
}: {
  doc: HandoverDoc;
  driver: CmuxDriver;
  parsed: ParsedFlags;
}): LaunchTemplate | number {
  const hostless = refuseSpawnTemplate({ doc, parsed });
  if (hostless !== undefined) {
    return hostless;
  }
  const flag = stringFlag({ name: "template", parsed });
  const refusal = codexTemplateRefusal({ driver, flag });
  if (refusal !== undefined) {
    logger.error({ msg: `cmux spawn: ${refusal}` });
    return EXIT_USAGE;
  }
  const launch = resolveLaunchTemplate({
    docTemplate: doc.template,
    flag,
    role: classifySessionRole({ docRole: doc.role }),
  });
  if ("error" in launch) {
    logger.error({ msg: `cmux spawn: ${launch.error}` });
    return EXIT_USAGE;
  }
  const codexNote = driver === "codex" ? " (not applied: codex expands no @ import)" : "";
  logger.out({ line: `cmux spawn: ${launchTemplateLine(launch)}${codexNote}` });
  return launch.template;
}
