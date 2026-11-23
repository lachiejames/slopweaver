/**
 * `slopweaver policy render` — one policy or evidence markdown file to a PDF, read back and verified.
 *
 * The verb touches no network or browser: it reads the markdown the operator names and writes the PDF where
 * they say. `policy diff`, the noun's other verb, loads its own module from the manifest.
 *
 * ## The exit-code contract
 *
 * | situation                                                      | code |
 * | -------------------------------------------------------------- | ---- |
 * | a bad flag                                                     | `2`  |
 * | the file could not be read or rendered, or did not read back   | `1`  |
 * | the PDF was written and every character read back in order     | `0`  |
 */
import { readFileSync, writeFileSync } from "node:fs";

import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { policyRunsFromPdf } from "../../../policy/render/extract.js";
import { figuresBeside } from "../../../policy/render/figures.js";
import { renderPolicyPdf } from "../../../policy/render/pdf.js";
import { linesFromPages } from "../../../policy/render/textRuns.js";
import { markdownWords, type RenderVerification, renderedWords, verifyRender } from "../../../policy/render/verify.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { parsePolicyRender } from "./core.js";

/** The usage the noun prints. */
export const POLICY_USAGE = [
  "usage: slopweaver policy <render|diff>",
  "  render --file <path.md> --out <path.pdf> [--json]",
  "         render one policy or evidence markdown file to a PDF, refusing any construct it would have to drop",
  "  diff   --record <record.json> --out <dir> [--json] [--home <dir>]",
  "         render a change as a review page, each material line with its reason, plus the team's page and post",
  "",
  "example: slopweaver policy render --file ./ai-acceptable-use-policy.md --out /tmp/ai.pdf",
].join("\n");

/** Print every problem to stderr, so a refusal says all of what is wrong rather than the first thing. */
function printProblems({ problems }: { problems: readonly string[] }): void {
  for (const problem of problems) {
    logger.error({ msg: problem });
  }
}

/** Print a usage refusal: the problems, then the grammar. */
function refuseUsage({ problems }: { problems: readonly string[] }): number {
  printProblems({ problems });
  logger.error({ msg: POLICY_USAGE });
  return EXIT_USAGE;
}

/**
 * Read the PDF back and compare its characters with the markdown's.
 *
 * A render that dropped a line reports success and looks right in a screenshot; this is the only thing that
 * sees it.
 */
async function verifyWritten({
  bytes,
  markdown,
}: {
  bytes: Uint8Array;
  markdown: string;
}): Promise<Result<RenderVerification>> {
  const back = await policyRunsFromPdf({ bytes });
  if (back.isErr()) {
    return err([back.error.message]);
  }
  return ok(
    verifyRender({
      rendered: renderedWords({
        text: linesFromPages({ pages: back.value })
          .map((line) => line.text)
          .join("\n"),
      }),
      source: markdownWords({ markdown }),
    }),
  );
}

function verificationLine({ verification }: { verification: RenderVerification }): string {
  if (verification.matched) {
    return `verified: all ${String(verification.sourceLength)} characters read back out of the PDF in the same order`;
  }
  return (
    `NOT VERIFIED: ${String(verification.sourceLength)} characters in, ` +
    `${String(verification.renderedLength)} read back; first difference at character ` +
    `${String(verification.firstDivergence)}: ${verification.context}`
  );
}

/** Run `policy render`.
 *
 * @param rest the verb tail
 * @returns the process exit code
 */
async function runRender({ rest }: { rest: readonly string[] }): Promise<number> {
  const parsed = parsePolicyRender({ rest });
  if (parsed.isErr()) {
    return refuseUsage({ problems: parsed.error });
  }
  const { file, out, json } = parsed.value;
  let markdown: string;
  try {
    markdown = readFileSync(file, "utf8");
  } catch {
    logger.error({ msg: `could not read ${file}` });
    return EXIT_ERROR;
  }
  const rendered = await renderPolicyPdf({ loadImage: figuresBeside({ file }), markdown });
  if (rendered.isErr()) {
    logger.error({ msg: `policy render: ${file}` });
    printProblems({ problems: rendered.error });
    return EXIT_ERROR;
  }
  try {
    writeFileSync(out, rendered.value.bytes);
  } catch {
    logger.error({ msg: `could not write ${out}` });
    return EXIT_ERROR;
  }
  const checked = await verifyWritten({ bytes: rendered.value.bytes, markdown });
  if (checked.isErr()) {
    printProblems({ problems: checked.error });
    return EXIT_ERROR;
  }
  const verification = checked.value;
  if (json) {
    logger.out({
      line: JSON.stringify({ lines: rendered.value.lines, out, pages: rendered.value.pages, verification }),
    });
  } else {
    logger.info({
      msg: `policy render: ${String(rendered.value.lines)} lines over ${String(rendered.value.pages)} page(s) to ${out}`,
    });
    logger.info({ msg: verificationLine({ verification }) });
  }
  return verification.matched ? EXIT_OK : EXIT_ERROR;
}

/**
 * Run the policy verb.
 *
 * @param argv the full process argv: the noun at index 2, the verb at index 3, its flags after
 * @returns the process exit code
 */
export async function runPolicy(argv: readonly string[]): Promise<number> {
  const verb = argv[3];
  const rest = verbTail({ argv, verbs: ["render"] });
  if (rest.includes("--help") || rest.includes("-h") || verb === undefined) {
    logger.out({ line: POLICY_USAGE });
    return EXIT_OK;
  }
  if (verb === "render") {
    return runRender({ rest });
  }
  return refuseUsage({ problems: [`unknown verb ${verb}`] });
}

export const policyCommand = defineCommand({ run: runPolicy });
