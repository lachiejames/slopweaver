/**
 * `slopweaver page review-prepare <slug> --page <html> --inputs <file,...>` — build the repository a page's review reads.
 *
 * Every briefing that reaches them gets at least one Codex review pass first. This verb is the
 * first half of that: it commits the inputs the page answers to (their words, the run's doc) at a base and the page at
 * a head (`../../../pages/reviewRepo.ts`), then prints the exact `codex review` to run against it, the visible-Claude
 * fallback for when Codex is capped (rule 9), and the `page publish --review` that cites the result. It runs no model.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { shellCommandLine } from "#lib/shellCommandLine.js";

import { linkPageIdentifiers, pageIdentifierContext } from "../../../pages/identifiers.js";
import { readPageFragment } from "../../../pages/publish.js";
import type { PageReviewPreparation } from "../../../pages/review.js";
import { type InputUnreadableError, PageReviewErrors } from "../../../pages/reviewErrors.js";
import { type PageReviewInput, preparePageReview } from "../../../pages/reviewRepo.js";
import { isValidPageSlug } from "../../../pages/url.js";
import { botAnswerBareRefContext } from "../../bareRefContext.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { pageReviewPrepareOptions, VERB_ARG_OFFSET } from "./core.js";
import { PAGE_REVIEW_PREPARE_USAGE } from "./usage.js";

/** How long a page review may run; a page is small, so this is the bound a briefing pass needs, not a code review's. */
const REVIEW_BOUND_SECONDS = 600;

/** Headroom over the measured diff, so `--max-diff-bytes` never refuses the exact diff it was computed from. */
const DIFF_HEADROOM_BYTES = 4096;

/** The property the printed command names; the author narrows it to what this page most needs to get right. */
const DEFAULT_PROPERTY =
  "Every claim on page.html is supported by inputs/, answers what the owner asked there, and leaves nothing they must work out themselves";

/**
 * The commands that take a prepared page through review to publish, each one line a caller can paste.
 *
 * @param preparation what was committed
 * @param repoRoot the review repository
 * @param home the state home every command must name, so the review and the publish read the same one
 * @param pagePath the fragment the publish will read
 * @param maxDiffBytes the bound a review's diff must sit under
 * @returns the review, fallback-prepare, fallback-record and publish commands, in the order they run
 */
export function reviewPrepareCommands({
  preparation,
  repoRoot,
  home,
  pagePath,
  maxDiffBytes,
}: {
  preparation: PageReviewPreparation;
  repoRoot: string;
  home: string;
  pagePath: string;
  maxDiffBytes: number;
}): {
  readonly review: string;
  readonly fallbackPrepare: string;
  readonly fallbackRecord: string;
  readonly publish: string;
} {
  const property = ["--property-id", "page-answers-inputs", "--property", DEFAULT_PROPERTY];
  const bound = ["--base", preparation.baseSha, "--max-diff-bytes", String(maxDiffBytes)];
  const where = ["--repo", repoRoot, "--home", home];
  // Each fixed head is literal words with no space inside one, so splitting it is exact.
  const words = ({ text }: { text: string }): string[] => text.split(" ");
  const record = words({
    text: "slopweaver codex review-fallback record --request <request-id> --answer-file <answer.json>",
  });
  const publish = ["--page", pagePath, "--review", "<artifact-or-receipt-id>", "--home", home];
  return {
    fallbackPrepare: shellCommandLine({
      command: [
        ...words({ text: "slopweaver codex review-fallback prepare --pass r1" }),
        ...property,
        ...bound,
        ...where,
      ],
    }),
    fallbackRecord: shellCommandLine({ command: [...record, ...where] }),
    publish: shellCommandLine({ command: ["slopweaver", "page", "publish", preparation.slug, ...publish] }),
    review: shellCommandLine({
      command: [
        ...words({ text: "slopweaver codex review --pass r1" }),
        ...property,
        ...bound,
        "--bound-seconds",
        String(REVIEW_BOUND_SECONDS),
        ...where,
      ],
    }),
  };
}

/** What a successful preparation prints: the repository, then every command in the order it runs. */
function preparedLines({
  preparation,
  repoRoot,
  inputCount,
  commands,
}: {
  preparation: PageReviewPreparation;
  repoRoot: string;
  inputCount: number;
  commands: ReturnType<typeof reviewPrepareCommands>;
}): readonly string[] {
  return [
    repoRoot,
    `  base ${preparation.baseSha} holds ${String(inputCount)} input(s); head ${preparation.headSha} adds page.html`,
    "  review it (narrow --property to what this page most needs to get right; run more passes for more properties):",
    `    ${commands.review}`,
    "  Codex capped? A visible Claude session takes the pass instead (rule 9):",
    `    ${commands.fallbackPrepare}`,
    `    ${commands.fallbackRecord}`,
    "  then publish, citing every pass by its artifact or receipt id (comma-separated):",
    `    ${commands.publish}`,
  ];
}

/** Write every line to one sink and answer the exit code the run ends on. */
function writeAll({
  lines,
  code,
  write,
}: {
  lines: readonly string[];
  code: number;
  write: (line: string) => void;
}): number {
  for (const line of lines) {
    write(line);
  }
  return code;
}

/** Read every input file, or the first one that could not be read. */
function readInputs({ paths }: { paths: readonly string[] }): Result<PageReviewInput[], InputUnreadableError> {
  const inputs: PageReviewInput[] = [];
  for (const path of paths) {
    try {
      inputs.push({ contents: readFileSync(path, "utf8"), name: basename(path) });
    } catch (error: unknown) {
      return err(PageReviewErrors.inputUnreadable({ detail: errorMessage({ error }), path }));
    }
  }
  return ok(inputs);
}

/**
 * The fragment as `page publish` will write it, every reference it resolves already linked, so the review reads the
 * published bytes rather than the draft.
 */
function linkedAsPublished({ fragment, home }: { fragment: string; home: string }): string {
  const context = pageIdentifierContext({ fragment, install: botAnswerBareRefContext({ home }) });
  return linkPageIdentifiers({ context, fragment }).fragment;
}

/**
 * Run `page review-prepare` against injected sinks and clock.
 *
 * @param rest the argv tail after `page review-prepare`
 * @param nowIso the instant the preparation is stamped with
 * @param preparationId the id the preparation directory is named for
 * @param writeOut where the repository and the commands are printed
 * @param writeDiagnostic where a usage or preparation refusal is printed
 * @returns the process exit code
 */
export function runPageReviewPrepare({
  rest,
  nowIso,
  preparationId,
  writeOut,
  writeDiagnostic,
}: {
  rest: readonly string[];
  nowIso: string;
  preparationId: string;
  writeOut: (line: string) => void;
  writeDiagnostic: (line: string) => void;
}): number {
  const fail = ({ lines, code }: { lines: readonly string[]; code: number }): number =>
    writeAll({ code, lines, write: writeDiagnostic });
  const options = pageReviewPrepareOptions({ rest });
  if (options.isErr()) {
    return fail({ code: EXIT_USAGE, lines: [...options.error, PAGE_REVIEW_PREPARE_USAGE] });
  }
  const { home, inputPaths, json, pagePath, slug } = options.value;
  if (!isValidPageSlug({ slug })) {
    const problem = `"${slug}" is not a page slug: lowercase letters, digits and single hyphens`;
    return fail({ code: EXIT_USAGE, lines: [problem, PAGE_REVIEW_PREPARE_USAGE] });
  }
  const fragment = readPageFragment({ path: pagePath });
  if (fragment.isErr()) {
    return fail({ code: EXIT_ERROR, lines: fragment.error });
  }
  const read = readInputs({ paths: inputPaths });
  if (read.isErr()) {
    return fail({ code: EXIT_ERROR, lines: [read.error.message] });
  }
  const resolvedHome = resolveHome({ named: home });
  const prepared = preparePageReview({
    createdAtIso: nowIso,
    fragment: linkedAsPublished({ fragment: fragment.value, home: resolvedHome }),
    home: resolvedHome,
    inputs: read.value,
    preparationId,
    slug,
  });
  if (prepared.isErr()) {
    return fail({ code: EXIT_ERROR, lines: [prepared.error.message] });
  }
  const { preparation, repoRoot, diffBytes } = prepared.value;
  const commands = reviewPrepareCommands({
    home: resolvedHome,
    maxDiffBytes: diffBytes + DIFF_HEADROOM_BYTES,
    pagePath,
    preparation,
    repoRoot,
  });
  const lines = json
    ? [JSON.stringify({ commands, preparation, repoRoot })]
    : preparedLines({ commands, inputCount: read.value.length, preparation, repoRoot });
  return writeAll({ code: EXIT_OK, lines, write: writeOut });
}

/** `slopweaver page review-prepare`. */
export const pageReviewPrepareCommand = defineCommand({
  run: (argv) =>
    runPageReviewPrepare({
      nowIso: new Date().toISOString(),
      preparationId: randomUUID(),
      rest: argv.slice(VERB_ARG_OFFSET),
      writeDiagnostic: (line) => {
        logger.error({ msg: line });
      },
      writeOut: (line) => {
        logger.out({ line });
      },
    }),
});
