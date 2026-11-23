/**
 * `slopweaver briefing sweep-block` — one supervisor sweep's edit to the fleet-briefing form, validated whole
 * against the briefing schema before a byte is written. The decision is `../../../briefing/sweepBlock.ts`;
 * this edge reads the form, validates the proposal the way `briefing render` would, and writes it.
 *
 * It validates and DISCARDS the parsed form, and writes the raw proposal: the parse injects the two eyebrow
 * instants and resolves every image path into `data:`, and none of that belongs in the file a seat keeps
 * editing. `briefing render` stays the publication authority — a form this verb accepts can still be refused
 * by the rendered-page gate.
 */
import type { Result } from "#lib/result.js";

import { briefingErrorLines } from "../../../briefing/errors.js";
import { applySweepBlock } from "../../../briefing/sweepBlock.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { VERB_ARG_OFFSET } from "./core.js";
import { briefingCommandErrorLines } from "./errors.js";
import { parseBriefingSweepBlockArgs } from "./formEditArgs.js";
import {
  type BriefingFormEditDeps,
  formJsonText,
  productionFormEditDeps,
  readFormJson,
  runFormEdit,
  writeFormText,
} from "./formEditIo.js";
import { readImageDataUri } from "./readImageDataUri.js";
import { parseBriefingForm } from "./renderCore.js";
import { BRIEFING_SWEEP_BLOCK_USAGE } from "./usage.js";

/** Everything `sweep-block` touches outside itself: the shared form seams, plus the clock and image reader. */
export interface BriefingSweepBlockDeps extends BriefingFormEditDeps {
  /** The instant the validation's eyebrow stamps are set to. */
  readonly now: () => string;
  /** Reads one image path into a `data:` URI, exactly as `briefing render` does. */
  readonly readImageDataUri: (args: { path: string }) => Result<string>;
}

/**
 * Print every line under the verb's name, and return the exit code.
 *
 * @param deps the injected diagnostic lane
 * @param lines what to say, one line each
 * @param code the exit code to answer, which decides whether the usage line follows
 * @returns that same exit code, so a caller can `return refuse({…})`
 */
function refuse({
  deps,
  lines,
  code,
}: {
  deps: BriefingSweepBlockDeps;
  lines: readonly string[];
  code: number;
}): number {
  for (const line of lines) {
    deps.writeDiagnostic(`briefing sweep-block: ${line}`);
  }
  if (code === EXIT_USAGE) {
    deps.writeDiagnostic(BRIEFING_SWEEP_BLOCK_USAGE);
  }
  return code;
}

/**
 * Judge the proposed form exactly as `briefing render` would, and say what it refuses.
 *
 * The parsed form is DISCARDED: the parse injects the eyebrow's two instants and resolves every image path
 * into a `data:` URI, and none of that belongs in the file a seat keeps editing.
 *
 * @param deps the injected image reader and clock
 * @param text the proposed form, serialised
 * @returns the schema's own refusal lines, or an empty list when the form would render
 */
function schemaRefusals({ deps, text }: { deps: BriefingSweepBlockDeps; text: string }): readonly string[] {
  const nowIso = deps.now();
  const valid = parseBriefingForm({
    // The projected sections are all absent on purpose: this validates what a SEAT authored, and every one of
    // them is injected by `briefing render` at publish time from a register rather than from the form.
    autonomy: undefined,
    freshness: undefined,
    narrative: undefined,
    nothingStale: undefined,
    openArtifacts: undefined,
    openPageCards: undefined,
    openPrs: undefined,
    handSteps: undefined,
    ownerBeliefs: undefined,
    quiz: undefined,
    raw: text,
    readImageDataUri: deps.readImageDataUri,
    stamps: { readyIso: nowIso, refreshedIso: nowIso },
    yourList: undefined,
  });
  // The VALUE is discarded whole, both halves of it: the parse injects the eyebrow's two instants and
  // resolves every image path, and its `foldedPages` can only ever be empty here, since no projected card
  // was passed in for the one-card-per-page fold to drop.
  if (valid.isErr()) {
    return briefingCommandErrorLines({ error: valid.error });
  }
  return [];
}

/**
 * Everything wrong with one sweep edit, in one list.
 *
 * The headline's own cap was refused at parse time (`../../../briefing/headlineSentences.ts`), so every line
 * here is a whole-form refusal the composed edit still earns.
 *
 * @param deps the injected image reader and clock
 * @param text the composed form, serialised
 * @returns every refusal line, or an empty list when the edit may be written
 */
function sweepRefusals({ deps, text }: { deps: BriefingSweepBlockDeps; text: string }): readonly string[] {
  const schema = schemaRefusals({ deps, text });
  const header = schema.length === 0 ? [] : ["the edited form fails the briefing schema, so nothing was written:"];
  return [...header, ...schema];
}

/**
 * Refuse an edit that failed before the form was touched, saying so after the reasons it failed for.
 *
 * @param formPath the form the verb would have written, named so the reader knows it is unchanged
 * @returns the error exit code, once every line is printed
 */
function refuseUnwritten({
  deps,
  formPath,
  lines,
}: {
  deps: BriefingSweepBlockDeps;
  formPath: string;
  lines: readonly string[];
}): number {
  return refuse({ code: EXIT_ERROR, deps, lines: [...lines, `nothing was written to ${formPath}`] });
}

/**
 * Run `briefing sweep-block` against injected seams.
 *
 * @param rest the argv tail after `briefing sweep-block`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code: usage for a bad invocation, error for a refusal, ok once written
 */
export function runBriefingSweepBlock({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: BriefingSweepBlockDeps;
}): number {
  const args = parseBriefingSweepBlockArgs({ rest });
  if (args.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: args.error });
  }
  const { formPath, dryRun, input } = args.value;
  const form = readFormJson({ deps, path: formPath });
  if (form.isErr()) {
    return refuse({ code: EXIT_ERROR, deps, lines: briefingCommandErrorLines({ error: form.error }) });
  }
  const edited = runFormEdit({
    edit: ({ form: raw }) => applySweepBlock({ form: raw, input }),
    form: form.value,
    path: formPath,
  });
  if (edited.isErr()) {
    return refuseUnwritten({ deps, formPath, lines: briefingCommandErrorLines({ error: edited.error }) });
  }
  const outcome = edited.value;
  if (outcome.isErr()) {
    return refuseUnwritten({ deps, formPath, lines: briefingErrorLines({ error: outcome.error }) });
  }
  const serialised = formJsonText({ form: outcome.value.form });
  if (serialised.isErr()) {
    return refuseUnwritten({ deps, formPath, lines: briefingCommandErrorLines({ error: serialised.error }) });
  }
  const text = serialised.value;
  const refusals = sweepRefusals({ deps, text });
  if (refusals.length > 0) {
    return refuse({ code: EXIT_ERROR, deps, lines: refusals });
  }
  const { droppedQuestions, earlierCount, recentCount, rolled } = outcome.value;
  const dropped = droppedQuestions.length === 0 ? "" : `, dropped ${String(droppedQuestions.length)} card(s)`;
  const report =
    `briefing sweep-block: added one recent block (${String(recentCount)} open), rolled ${String(rolled)} into ` +
    `earlierToday (${String(earlierCount)} notes)${dropped}`;
  if (dryRun) {
    deps.writeOut(`${report} (dry run, nothing written)`);
    return EXIT_OK;
  }
  const written = writeFormText({ deps, path: formPath, text });
  if (written.isErr()) {
    return refuse({ code: EXIT_ERROR, deps, lines: briefingCommandErrorLines({ error: written.error }) });
  }
  deps.writeOut(`${report}; wrote ${formPath}`);
  for (const question of droppedQuestions) {
    deps.writeOut(`  dropped: ${question}`);
  }
  return EXIT_OK;
}

/**
 * The real seams.
 *
 * @returns the production dependencies for {@link runBriefingSweepBlock}
 */
export function productionBriefingSweepBlockDeps(): BriefingSweepBlockDeps {
  return {
    ...productionFormEditDeps(),
    now: () => new Date().toISOString(),
    readImageDataUri: ({ path }) => readImageDataUri({ path }).mapErr((error) => briefingCommandErrorLines({ error })),
  };
}

/** `slopweaver briefing sweep-block`. */
export const briefingSweepBlockCommand = defineCommand({
  run: (argv) => runBriefingSweepBlock({ deps: productionBriefingSweepBlockDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
