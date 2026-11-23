/**
 * `slopweaver proposal intake` — the effectful shell around the question-first intake record.
 *
 * ## Re-running it MERGES, and that is the whole reason this file exists
 *
 * The verb's own stderr tells the operator to hand-edit `<home>/proposals/<id>.json`, so re-running it is
 * the ordinary way to re-read the questions. It used to answer that by deriving a fresh record and writing
 * it straight over whatever was there, which cost one real run its six stakeholder answers.
 * The decision about what survives is pure, in `../../../outbound/proposal/intake.js`; what is left here is
 * the load, the save, and the one branch that refuses.
 *
 * ## Absence is decided on the FILESYSTEM, never on the error text
 *
 * A missing record and an unreadable one demand opposite acts from a caller about to write: seed over the
 * first, refuse to touch the second. `intakeExists` asks the filesystem before anything is read, so the
 * branch never rests on a message nobody promised to keep stable.
 */
import { slopweaverHome } from "../../../config.js";
import {
  blockingUnanswered,
  deriveIntake,
  type IntakeMerge,
  intakeId,
  intakeLines,
  mergeIntake,
  type ProposalIntake,
} from "../../../outbound/proposal/intake.js";
import {
  intakeExists,
  intakePath,
  isValidIntakeId,
  loadIntake,
  saveIntake,
} from "../../../outbound/proposal/intakeStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { proposalErrorLines } from "./errors.js";
import { parseProposalIntakeArgs } from "./publishCore.js";
import {
  type ProposalPublishDeps,
  productionProposalPublishDeps,
  refuse,
  VERB_ARG_OFFSET,
} from "./publishRunShared.js";

/** The state home the caller named, or this install's own when they named none. */
function homeOf({ flag }: { flag: string | undefined }): string {
  if (flag === undefined) {
    return slopweaverHome();
  }
  return flag;
}

/** The id the caller named, or one derived from the brief when they named none. */
function idOf({ flag, brief, now }: { flag: string | undefined; brief: string; now: Date }): string {
  if (flag === undefined) {
    return intakeId({ brief, now });
  }
  return flag;
}

/**
 * What a re-seed did, in one operator-facing line.
 *
 * Printed so a merge is distinguishable from a fresh seed without diffing the record — the counts come from
 * the merge itself rather than being recomputed here, so the sentence cannot disagree with the file.
 */
function mergeLine({ merge, path }: { merge: IntakeMerge; path: string }): string {
  const counts =
    `kept ${String(merge.keptAnswers)} answer(s), added ${String(merge.addedQuestions)} new question(s), ` +
    `carried ${String(merge.carriedQuestions)} stored question(s) no standing question claimed`;
  if (merge.briefChanged) {
    return `merged into the existing intake at ${path}: ${counts}; brief updated.`;
  }
  return `merged into the existing intake at ${path}: ${counts}.`;
}

/**
 * The record this seed should write, or the refusal that stops it.
 *
 * Three states, and the third is the one that matters: a record that EXISTS but cannot be parsed is refused
 * rather than replaced, because seeding over it would destroy the same answers this verb once destroyed by
 * merging nothing at all.
 */
function seedIntake({
  home,
  id,
  brief,
  now,
}: {
  home: string;
  id: string;
  brief: string;
  now: Date;
}):
  | { readonly intake: ProposalIntake; readonly merge: IntakeMerge | undefined }
  | { readonly errors: readonly string[] } {
  const fresh = deriveIntake({ brief, id, now });
  if (!intakeExists({ home, id })) {
    return { intake: fresh, merge: undefined };
  }
  const loaded = loadIntake({ home, id });
  if (loaded.isErr()) {
    return {
      errors: [
        loaded.error.message,
        `refusing to re-seed over it: ${intakePath({ home, id })} exists and could not be read, and ` +
          "overwriting it would destroy whatever answers are in it. Fix or move that file, then run this again.",
      ],
    };
  }
  const merge = mergeIntake({ existing: loaded.value, fresh });
  return { intake: merge.intake, merge };
}

/**
 * Run `proposal intake`.
 *
 * A fresh intake correctly has open questions, so it exits `EXPECTED_EMPTY` rather than zero. That is a
 * status, not a fault: the verb worked, and it is telling you what is still owed to the stakeholder.
 *
 * Re-running it with the same `--id` MERGES rather than replaces, and a record it cannot read is refused
 * rather than written over.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export async function runProposalIntake({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: ProposalPublishDeps;
}): Promise<number> {
  const parsed = parseProposalIntakeArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: proposalErrorLines({ error: parsed.error }) });
  }
  const args = parsed.value;
  const now = deps.now();
  const home = homeOf({ flag: args.home });
  const id = idOf({ brief: args.brief, flag: args.id, now });
  if (!isValidIntakeId({ id })) {
    return refuse({
      code: EXIT_USAGE,
      deps,
      lines: [`${JSON.stringify(id)} is not a valid intake id: lowercase letters, digits and dashes only`],
    });
  }
  const seeded = seedIntake({ brief: args.brief, home, id, now });
  if ("errors" in seeded) {
    return refuse({ code: EXIT_ERROR, deps, lines: seeded.errors });
  }
  const { intake, merge } = seeded;
  saveIntake({ home, intake });
  if (merge !== undefined) {
    deps.err(mergeLine({ merge, path: intakePath({ home, id }) }));
  }
  for (const line of intakeLines({ intake })) {
    deps.out(line);
  }
  const open = blockingUnanswered({ intake });
  deps.err(
    `${String(open.length)} blocking question(s) still open. Answer them with the stakeholder, edit ` +
      `${intakePath({ home, id })}, then draft.`,
  );
  return open.length > 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/** `slopweaver proposal intake` — seed the gap questions a proposal must answer before it is drafted. */
export const proposalIntakeCommand = defineCommand({
  run: (argv: readonly string[]) => runProposalIntake({ argv, deps: productionProposalPublishDeps() }),
});
