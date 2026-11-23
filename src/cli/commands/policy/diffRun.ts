/**
 * `slopweaver policy diff` — an evidence or policy change, read like a good pull request.
 *
 * Reads one diff record (`../../../policy/diff/record.ts`), both sides of every document it names — a file, or a
 * blob at a git revision — and the Vanta atlas already on disk, then writes three things built from that one
 * record: the owner's review page, the team's page, and the team post. Nothing reaches a network: the atlas is
 * whatever the last `atlas vanta sync` stored, and publishing is `page publish`'s job, sending the post a Slack
 * verb's.
 *
 * ## The exit-code contract
 *
 * | situation                                                                         | code |
 * | --------------------------------------------------------------------------------- | ---- |
 * | a bad flag                                                                        | `2`  |
 * | the record, a source or the atlas is unreadable, or a line has no reason          | `1`  |
 * | all three files written                                                           | `0`  |
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, posix } from "node:path";

import { resolveVantaTenantSlug } from "../../../atlas/vanta/tenantSlug.js";
import { slopweaverHome } from "../../../homeDir.js";
import { errorMessage } from "../../../lib/errorMessage.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { readPolicyAtlasView } from "../../../policy/atlasView.js";
import { type DocDiffIssue, DocDiffIssues } from "../../../policy/diff/issues.js";
import { buildDocDiffModel, type DocDiffModel, type DocumentSources } from "../../../policy/diff/model.js";
import { type DocDiffRecord, type DocDiffSource, parseDocDiffRecord } from "../../../policy/diff/record.js";
import { renderOwnerPage } from "../../../policy/diff/render.js";
import { type EvidenceTarget, type PolicyTarget, resolveTargets } from "../../../policy/diff/targets.js";
import { renderTeamPage, renderTeamPost } from "../../../policy/diff/team.js";
import { FRONT_MATTER } from "../../../policy/diff/units.js";
import { readEvidenceAtlasView } from "../../../policy/evidenceAtlasView.js";
import { botAnswerBareRefContext } from "../../bareRefContext.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { vantaPolicyPageUrl } from "../vanta/policyVersionRun.js";
import { diffHumanLines, issueLines, POLICY_DIFF_OUTPUTS, POLICY_DIFF_USAGE, parsePolicyDiff } from "./diffCore.js";

/**
 * How long one git read here may take before it is killed. It is local work that answers in well under a
 * second on a healthy repository; two minutes, the bound `src/worktree/pruneGit.ts` and
 * `src/worktree/salvageScan.ts` already put on the same class of read, ends one wedged on a held lock, a FIFO
 * config or a prompt nobody can see instead of blocking the event loop for good. SIGKILL, because a child that
 * traps the default SIGTERM would outlive the bound.
 */
const GIT_READ_TIMEOUT_MS = 2 * 60_000;

/** Where a policy verb sits: past the runtime, the script and the `policy` noun. */
const POLICY_VERB_INDEX = 3;

/** The media type an inlined image is served as, by extension. */
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

/** An image a document names by a path beside it. */
const LOCAL_IMAGE = /!\[[^\]]*\]\(([^)\s]+)\)/g;

/** Read one source's bytes: a file, relative to the record, or a blob at a revision. */
function readSourceBytes({
  source,
  recordDir,
}: {
  source: DocDiffSource;
  recordDir: string;
}): Result<Buffer, DocDiffIssue> {
  if ("path" in source) {
    const path = isAbsolute(source.path) ? source.path : join(recordDir, source.path);
    try {
      return ok(readFileSync(path));
    } catch (error) {
      return err(DocDiffIssues.unreadableSource({ cause: errorMessage({ error }), source: path }));
    }
  }
  const { repo, rev, path } = source.git;
  try {
    return ok(
      execFileSync("git", ["-C", repo, "show", `${rev}:${path}`], {
        maxBuffer: 64 * 1024 * 1024,
        killSignal: "SIGKILL",
        timeout: GIT_READ_TIMEOUT_MS,
      }),
    );
  } catch (error) {
    return err(DocDiffIssues.unreadableSource({ cause: errorMessage({ error }), source: `${repo}@${rev}:${path}` }));
  }
}

/** The source an image path names, resolved beside the document that names it. */
function siblingSource({ source, relative }: { source: DocDiffSource; relative: string }): DocDiffSource {
  if ("path" in source) {
    return { path: join(dirname(source.path), relative) };
  }
  return { git: { ...source.git, path: posix.join(posix.dirname(source.git.path), relative) } };
}

/**
 * Every local image a side names, read from THAT side and inlined as a data URI under a key made of its bytes, with
 * the markdown rewritten to name the key. A key per content rather than per path is what lets the diff see a
 * diagram that was swapped under the same file name — the two sides then name different keys — and keeps two
 * documents' same-named images apart.
 *
 * @returns the side's markdown naming each image by its key, and every image that could not be read
 */
function inlineImages({
  markdown,
  source,
  recordDir,
  images,
}: {
  markdown: string;
  source: DocDiffSource;
  recordDir: string;
  images: Map<string, string>;
}): { readonly markdown: string; readonly issues: readonly DocDiffIssue[] } {
  const issues: DocDiffIssue[] = [];
  const rewrite = ({ line }: { line: string }): string =>
    line.replace(LOCAL_IMAGE, (whole, relative: string) => {
      const type = IMAGE_TYPES[extname(relative).toLowerCase()];
      if (/^[a-z]+:/i.test(relative) || type === undefined) {
        return whole;
      }
      const bytes = readSourceBytes({ recordDir, source: siblingSource({ relative, source }) });
      if (bytes.isErr()) {
        issues.push(bytes.error);
        return whole;
      }
      const key = `diff-image:${createHash("sha256").update(bytes.value).digest("hex").slice(0, 16)}`;
      images.set(key, `data:${type};base64,${bytes.value.toString("base64")}`);
      return whole.replace(`](${relative})`, `](${key})`);
    });
  const normalised = markdown.replace(/\r\n/g, "\n");
  const front = FRONT_MATTER.exec(normalised);
  let head = "";
  if (front !== null) {
    head = front[0];
  }
  let fence: string | null = null;
  const rewritten = normalised
    .slice(head.length)
    .split("\n")
    .map((line) => {
      const marker = /^\s*(```|~~~)/.exec(line);
      if (fence !== null) {
        if (marker?.[1] === fence) {
          fence = null;
        }
        return line;
      }
      if (marker !== null) {
        fence = marker[1]!;
        return line;
      }
      return rewrite({ line });
    });
  return { issues, markdown: head + rewritten.join("\n") };
}

/** Both sides of every document, and every image they name. */
function readSources({
  record,
  recordDir,
}: {
  record: DocDiffRecord;
  recordDir: string;
}): Result<
  { sources: ReadonlyMap<string, DocumentSources>; images: ReadonlyMap<string, string> },
  readonly DocDiffIssue[]
> {
  const issues: DocDiffIssue[] = [];
  const sources = new Map<string, DocumentSources>();
  const images = new Map<string, string>();
  for (const document of record.documents) {
    const read = readDocument({ document, images, recordDir });
    for (const issue of read.issues) {
      issues.push(issue);
    }
    if (read.sides !== null) {
      sources.set(document.id, read.sides);
    }
  }
  if (issues.length > 0) {
    return err(issues);
  }
  return ok({ images, sources });
}

/**
 * One document's two sides, each with its images inlined into `images`.
 *
 * @param images the run's inlined images by key, which this adds to
 * @returns both sides' markdown, or null when a side could not be read, and every problem found
 */
function readDocument({
  document,
  recordDir,
  images,
}: {
  document: DocDiffRecord["documents"][number];
  recordDir: string;
  images: Map<string, string>;
}): { readonly sides: DocumentSources | null; readonly issues: readonly DocDiffIssue[] } {
  const before = readSourceBytes({ recordDir, source: document.before.source });
  const after = readSourceBytes({ recordDir, source: document.after.source });
  if (before.isErr() || after.isErr()) {
    return { issues: [before, after].flatMap((side) => (side.isErr() ? [side.error] : [])), sides: null };
  }
  const afterSide = inlineImages({
    images,
    markdown: after.value.toString("utf8"),
    recordDir,
    source: document.after.source,
  });
  const beforeSide = inlineImages({
    images,
    markdown: before.value.toString("utf8"),
    recordDir,
    source: document.before.source,
  });
  return {
    issues: [afterSide.issues, beforeSide.issues].flat(),
    sides: { after: afterSide.markdown, before: beforeSide.markdown },
  };
}

/** Every evidence slot and policy the atlas holds, addressed. */
function readTargets({
  home,
}: {
  home: string;
}): Result<{ evidence: readonly EvidenceTarget[]; policies: readonly PolicyTarget[] }> {
  const evidence = readEvidenceAtlasView({ home });
  const view = readPolicyAtlasView({ home });
  const tenant = resolveVantaTenantSlug({ env: process.env, flag: null, home });
  if (evidence.isErr() || view.isErr() || tenant.isErr()) {
    return err([
      ...(evidence.isErr() ? evidence.error.reasons : []),
      ...(view.isErr() ? view.error : []),
      ...(tenant.isErr() ? tenant.error : []),
    ]);
  }
  const slots = evidence.value.flatMap((slot) => (slot.url === null ? [] : [{ id: slot.documentId, url: slot.url }]));
  const policies = view.value.policies.map((policy) => ({
    id: policy.policyId,
    name: policy.name,
    url: vantaPolicyPageUrl({ policyId: policy.policyId, tenantSlug: tenant.value }),
  }));
  return ok({ evidence: slots, policies });
}

/** Print a refusal: a heading, then every line. */
function refuse({ heading, lines }: { heading: string; lines: readonly string[] }): number {
  logger.error({ msg: heading });
  for (const line of lines) {
    logger.error({ msg: line });
  }
  return EXIT_ERROR;
}

/**
 * Run `policy diff`.
 *
 * @param argv the full process argv: the noun at index 2, the verb at index 3, its flags after
 * @returns the process exit code
 */
export function runPolicyDiff(argv: readonly string[]): number {
  const rest = verbTail({ argv, at: POLICY_VERB_INDEX, verbs: ["diff"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: POLICY_DIFF_USAGE });
    return EXIT_OK;
  }
  const parsed = parsePolicyDiff({ defaultHome: slopweaverHome(), rest });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      logger.error({ msg: problem });
    }
    logger.error({ msg: POLICY_DIFF_USAGE });
    return EXIT_USAGE;
  }
  const options = parsed.value;
  const model = buildModel({ home: options.home, recordPath: options.record });
  if (model.isErr()) {
    return refuse(model.error);
  }
  try {
    mkdirSync(options.out, { recursive: true });
    writeFileSync(join(options.out, POLICY_DIFF_OUTPUTS.owner), renderOwnerPage({ model: model.value }));
    writeFileSync(join(options.out, POLICY_DIFF_OUTPUTS.team), renderTeamPage({ model: model.value }));
    writeFileSync(join(options.out, POLICY_DIFF_OUTPUTS.teamPost), `${renderTeamPost({ model: model.value })}\n`);
  } catch (error) {
    return refuse({ heading: `policy diff: could not write into ${options.out}`, lines: [errorMessage({ error })] });
  }
  report({ json: options.json, model: model.value, out: options.out });
  return EXIT_OK;
}

/**
 * Build the diff from a record file: read the record, both sides of every document and the atlas, then link and
 * explain every line.
 *
 * @param recordPath the record file, whose directory a relative source path is read from
 * @param home the state home whose Vanta atlas the links resolve against
 * @returns the model, or the refusal to print: what failed, and every reason
 */
function buildModel({
  recordPath,
  home,
}: {
  recordPath: string;
  home: string;
}): Result<DocDiffModel, { readonly heading: string; readonly lines: readonly string[] }> {
  let text: string;
  try {
    text = readFileSync(recordPath, "utf8");
  } catch (error) {
    return err({ heading: `policy diff: could not read ${recordPath}`, lines: [errorMessage({ error })] });
  }
  const record = parseDocDiffRecord({ text });
  if (record.isErr()) {
    return err({
      heading: `policy diff: ${recordPath} is not a diff record`,
      lines: issueLines({ issues: record.error }),
    });
  }
  const read = readSources({ record: record.value, recordDir: dirname(recordPath) });
  if (read.isErr()) {
    return err({ heading: "policy diff: a source could not be read", lines: issueLines({ issues: read.error }) });
  }
  const atlas = readTargets({ home });
  if (atlas.isErr()) {
    return err({ heading: "policy diff: the Vanta atlas could not be read", lines: atlas.error });
  }
  const targets = resolveTargets({ ...atlas.value, record: record.value });
  if (targets.isErr()) {
    return err({
      heading: "policy diff: a link names nothing in the atlas",
      lines: issueLines({ issues: targets.error }),
    });
  }
  return buildDocDiffModel({
    context: botAnswerBareRefContext({ home }),
    images: read.value.images,
    phrases: targets.value.phrases,
    record: record.value,
    slotUrls: targets.value.slotUrls,
    sources: read.value.sources,
  }).mapErr((issues) => ({
    heading: "policy diff: the record does not explain this diff",
    lines: issueLines({ issues }),
  }));
}

/** Print what a run wrote: one JSON document, or the human report. */
function report({ model, out, json }: { model: DocDiffModel; out: string; json: boolean }): void {
  if (json) {
    const documents = model.documents.map((diff) => ({ counts: diff.counts, id: diff.document.id }));
    logger.out({ line: JSON.stringify({ documents, out }) });
    return;
  }
  for (const line of diffHumanLines({ model, out })) {
    logger.info({ msg: line });
  }
}

export const policyDiffCommand = defineCommand({ run: runPolicyDiff });
