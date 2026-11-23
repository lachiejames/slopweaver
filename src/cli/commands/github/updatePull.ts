/**
 * `github pr update --pull`: the read-only mode that writes the live description out as an authoring file, and
 * `--pull --convert-c3`, which does the same for a pre-C3 description through the legacy converter.
 *
 * Split out of `./updateFlow.ts` along that seam — pulling shares the address and authorship half of an update
 * and none of its write half — to keep `updateFlow.ts` under the file-size ratchet. Neither mode sends anything.
 */
import type { WrittenPr } from "../../../corpus/github/write.js";
import { renderAuthoringFile } from "../../../outbound/github/authoringFile.js";
import { renderContent } from "../../../outbound/github/authoringInline.js";
import { withholdingCredentialLines } from "../../../outbound/github/descriptionWords.js";
import { convertToC3 } from "../../../outbound/github/legacy/convertToC3.js";
import { parseReadingOrderBody } from "../../../outbound/github/legacy/parse.js";
import { bodyHash, readPrRecord } from "../../../outbound/github/prLedger.js";
import { recoverPrForm } from "../../../outbound/github/recovery.js";
import { prVoiceBriefLines } from "../../../outbound/github/voiceBrief.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { liveLocusFor, liveTargetFor, resolveAndAuthorise } from "./addressRun.js";
import type { GithubPrArgs } from "./core.js";
import type { GithubPrDeps } from "./prDeps.js";

/**
 * Why `--pull` could not produce a file, naming the way forward: a pre-C3 description is pointed at
 * `--convert-c3`, with the command spelled for this pull request so it runs as printed.
 *
 * @param code the recovery refusal's code
 * @param number the pull request being pulled
 * @param reason the recovery's own reason, for every other refusal
 * @param repo the `owner/name` the pull request lives in
 * @returns the refusal text
 */
function pullRefusal({
  code,
  number,
  reason,
  repo,
}: {
  code: string;
  number: number;
  reason: string;
  repo: string;
}): string {
  if (code !== "PRE_C3_SHAPE") {
    return reason;
  }
  return (
    `#${String(number)}'s description is a pre-C3 body. Convert it, which writes a C3 authoring file and sends ` +
    `nothing: \`slopweaver github pr update --repo ${repo} --number ${String(number)} --pull --convert-c3\`, then ` +
    "push the file back with --file once its blanks are filled in"
  );
}

/**
 * The note a pull prints about bytes the authoring file cannot carry: a trailing block.
 *
 * The authoring file holds the FORM, and a third-party block is not part of one — so pushing the file back with
 * `--file` is a wholesale replacement that discards it. That is allowed (it takes SLOPWEAVER_ALLOW_PR_REPLACE and
 * prints the diff of what it would lose), but a caller who was not told the block existed cannot read that diff
 * as a decision. A partial `--edit` keeps it.
 */
function trailingNotices({ outPath, trailing }: { outPath: string; trailing: number }): readonly string[] {
  if (trailing === 0) {
    return [];
  }
  return [
    `note: ${String(trailing)} bytes follow this description that slopweaver did not write — they are NOT in ` +
      `${outPath}, so pushing that file back with --file would discard them. Use a partial --edit to keep them`,
  ];
}

/** `--convert-c3`: the pre-C3 body read by the frozen reader, converted, and written with its report. */
function runConvert({ deps, live, outPath }: { deps: GithubPrDeps; live: WrittenPr; outPath: string }): number {
  const readingOrder = parseReadingOrderBody({ body: live.body });
  if (readingOrder.isErr()) {
    deps.out({
      line:
        `refused: #${String(live.number)}'s description is not a reading-order body the converter can read ` +
        `(${readingOrder.error.message}). Write it fresh: \`slopweaver github stack push --file-example\` prints the ` +
        "C3 shape, and --file replaces the description whole",
    });
    return EXIT_ERROR;
  }
  const converted = convertToC3({
    body: readingOrder.value.body,
    shell: { draft: live.draft, target: liveTargetFor({ pr: live }), title: live.title },
  });
  const reportPath = `${outPath}.report.txt`;
  deps.writeFileOut({
    content: renderAuthoringFile({ form: converted.form, pulledBodyHash: bodyHash({ body: live.body }) }),
    path: outPath,
  });
  deps.writeFileOut({ content: `${converted.report.join("\n")}\n`, path: reportPath });
  deps.out({ line: `converted #${String(live.number)} into ${outPath}; nothing was sent` });
  deps.out({ line: `conversion report: ${reportPath}` });
  for (const line of converted.report) {
    deps.out({ line: `  ${line}` });
  }
  for (const line of trailingNotices({ outPath, trailing: readingOrder.value.remainder.length })) {
    deps.out({ line });
  }
  return EXIT_OK;
}

/**
 * `--pull`: read the live description into an editable authoring file and exit; with `--convert-c3`, convert a
 * pre-C3 description into one instead.
 *
 * Fully read-only, like `create --dry-run` — no door record, no reservation, no mutation. It resolves the
 * same address and runs the same authorship check `update` always has, because the whole point of pulling is
 * to prepare a `--file` push, which does need it; recovering the form reuses `recoverPrForm`, the exact
 * cache-or-live-parse `--edit` already merges into, so a `--pull` and an `--edit` never disagree about what
 * the description currently is.
 *
 * @returns the exit code: OK once the file is written, ERROR on any refusal
 */
export async function runPull({
  args,
  deps,
  home,
}: {
  args: GithubPrArgs;
  deps: GithubPrDeps;
  home: string;
}): Promise<number> {
  const token = deps.token({ home });
  if (token === undefined) {
    deps.out({ line: "refused: no GitHub token resolved ($SLOPWEAVER_HOME/secrets/github-token, or gh auth token)" });
    return EXIT_ERROR;
  }
  const api = deps.makeApi({ home, token });
  const admitted = await resolveAndAuthorise({ address: args.address!, api, deps, home, selfReviewRequested: false });
  if ("reason" in admitted) {
    deps.out({ line: withholdingCredentialLines({ lines: [`refused: ${admitted.reason}`] }).join("") });
    return EXIT_ERROR;
  }
  const live = admitted.live;
  const { outPath = `pr-${String(live.number)}.md` } = args;
  if (args.convertC3) {
    return runConvert({ deps, live, outPath });
  }
  const recovered = recoverPrForm({
    live: { draft: live.draft, target: liveTargetFor({ pr: live }), title: live.title },
    liveBody: live.body,
    number: live.number,
    record: readPrRecord({ home, locus: liveLocusFor({ pr: live }) }),
  });
  if (recovered.kind === "refused") {
    const refusal = pullRefusal({
      code: recovered.code,
      number: live.number,
      reason: recovered.reason,
      repo: live.baseRepoFullName,
    });
    // A recovery refusal can quote the live body's runs, so a credential shape is withheld from the log.
    deps.out({ line: withholdingCredentialLines({ lines: [`refused: ${refusal}`] }).join("") });
    return EXIT_ERROR;
  }
  const file = renderAuthoringFile({ form: recovered.form, pulledBodyHash: bodyHash({ body: live.body }) });
  deps.writeFileOut({ content: file, path: outPath });
  deps.out({ line: `pulled #${String(live.number)} into ${outPath}` });
  for (const line of trailingNotices({ outPath, trailing: recovered.trailing.length })) {
    deps.out({ line });
  }
  // A recut starts here and never reaches the examples, so the voice brief rides the pull too, after what
  // the pull itself has to say, with the explainer echoed back for the composer to re-read before editing it.
  for (const line of prVoiceBriefLines({ currentExplainer: renderContent({ content: recovered.form.explainer }) })) {
    deps.out({ line });
  }
  return EXIT_OK;
}
