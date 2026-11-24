/**
 * `slopweaver codex review-fallback prepare|record` — the Claude fallback review, as two verbs.
 *
 * When Codex is capped, a visible Claude session takes the review pass
 * instead. The decision and the document shapes are pure and live in `../../../codex/fallbackReview.ts`;
 * this file is the shell: read every registered destination's gauge, capture the diff, write the packet, and
 * later validate the answer and write the receipt. Neither verb spends a Codex turn or reaches the network
 * beyond the local store, where the request and receipt rows are the record (`../../../codex/fallbackPort.ts`).
 *
 * `prepare` is what a Codex review does BEFORE its model call — capture the diff and the tree, write the
 * untrusted-material packet — with one extra obligation: it refuses unless every REGISTERED Codex destination
 * is closed right now, or the adopted register names no Codex plan at all (`../../../codex/providerUnregistered.ts`),
 * and it writes the ground it saw into the request. A fallback prepared while any of them is
 * open is not a fallback but a routing decision taken wrongly (`../../../codex/fleetCap.ts`), and the
 * `unreviewed` hatch already covers "I am not going to run a review at all"; this verb is for the other case.
 *
 * `record` is what a Codex review does AFTER: validate the answer against the property that was asked, and
 * persist it. It refuses when the tree has moved since `prepare`, because the packet then describes a diff
 * nobody is landing — the fan-out defect `docs/doctrine-rationale/rule-9.md` § Rule 9 records, closed here by
 * capturing diff and tree together and refusing to record over any other tree.
 */

import { randomUUID } from "node:crypto";

import { refusalMessage } from "../../../codex/diff.js";
import { codexErrorLines } from "../../../codex/errors.js";
import { discardPacket, writeReviewPacket } from "../../../codex/fallbackPacket.js";
import { type FallbackRegisterPort, fallbackRegisterPort } from "../../../codex/fallbackPort.js";
import { fallbackRequestText } from "../../../codex/fallbackRequestRead.js";
import { type ClaudeFallbackReviewRequest, fallbackGroundLine } from "../../../codex/fallbackReview.js";
import { parseFallbackRequest } from "../../../codex/fallbackReviewParse.js";
import { captureReviewDiffWithProvenance, type ReviewDiff } from "../../../codex/gitDiff.js";
import { supersessionPort } from "../../../codex/supersessionStore.js";
import type { CodexPassTree } from "../../../codex/types.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { booleanFlagsOf, type FlagSpec, type ParsedFlags, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { readFallbackGround } from "./fallbackCapRead.js";
import { type PrepareArgs, preparePrepareArgs, stringFlag } from "./fallbackPrepareArgs.js";
import { requestGround } from "./fallbackReviewGround.js";
import { recordFallbackReview } from "./fallbackReviewRecord.js";
import { repoDirOf } from "./repoScope.js";
import { refusedByReviewCap } from "./reviewCapGate.js";
import { refusedAsReservedWitness } from "./reviewLaneRead.js";

/** How many argv entries precede the verb's own tail (`node`, `slopweaver`, `codex`, `review-fallback`). */
const VERB_ARG_OFFSET = 4;

/**
 * The flags both sub-verbs accept, as ONE spec so the help-truth ratchet has one parser to probe. Which are
 * required is the sub-verb's business, checked after parsing.
 */
const FALLBACK_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: [
    "pass",
    "property-id",
    "property",
    "base",
    "max-diff-bytes",
    "after-refusal",
    "request",
    "answer-file",
    "workspace",
    "model",
    "repo",
    "home",
  ],
};

/** The same flags, `--`-prefixed, for the help-truth ratchet. Derived rather than retyped. */
export const CODEX_REVIEW_FALLBACK_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: FALLBACK_FLAGS }),
  ...booleanFlagsOf({ spec: FALLBACK_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** Usage for `codex review-fallback`, shared by `--help` and every parse failure. */
export const CODEX_REVIEW_FALLBACK_USAGE =
  "usage: slopweaver codex review-fallback prepare --pass r1|r2|r3 --property-id <id> --property <claim>\n" +
  "           --base <ref> --max-diff-bytes <n> [--after-refusal <artifactId>]\n" +
  "           [--repo <dir>] [--home <dir>] [--json]\n" +
  "       slopweaver codex review-fallback record --request <id> --answer-file <path>\n" +
  "           [--workspace <ref>] [--model <name>] [--repo <dir>] [--home <dir>] [--json]\n" +
  "\n" +
  "The review pass a VISIBLE Claude session takes when Codex is capped (AGENTS.md rule 9), when\n" +
  "no Codex plan is registered at all, or when Codex refused the review on policy twice (--after-refusal).\n" +
  "\n" +
  "  prepare  REFUSED unless Codex is closed right now or unregistered. Captures the diff against --base and the\n" +
  "           tree it was cut from, writes the review packet a Codex pass would have read, and records the ground it saw.\n" +
  "           Prints the request id and the packet path. Read the packet, answer the ONE property.\n" +
  "           --after-refusal <artifactId> grounds it on that review pass instead of a cap: REFUSED unless the\n" +
  "           pass was this review (checkout, pass, property, diff, tree) refused on policy on BOTH its initial\n" +
  "           attempt and its one policy retry. A cap is not read on this path.\n" +
  "  record   Validates --answer-file (the review-output JSON a Codex pass returns: verdict, propertyId,\n" +
  "           summary, evidence, counterexample) against the request's property, REFUSES if the tree moved\n" +
  "           since prepare, and writes the receipt the landing floor reads. One receipt per request.";

/**
 * Parse the verb's flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the verb's argument tail, sub-verb first
 * @returns the parsed flags, or the errors
 */
export function parseCodexReviewFallbackArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: FALLBACK_FLAGS });
}

/**
 * Run the verb — the composition root, naming the production fallback port.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function runCodexReviewFallback(argv: readonly string[]): Promise<number> {
  return runCodexReviewFallbackOver({ argv, port: fallbackRegisterPort() });
}

/**
 * Run the verb over a given fallback port — the seam a unit test hands an in-memory store.
 *
 * @param argv the whole process argv
 * @param port where the fallback requests and receipts are read and written
 * @returns the process exit code
 */
export async function runCodexReviewFallbackOver({
  argv,
  port,
}: {
  argv: readonly string[];
  port: FallbackRegisterPort;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: CODEX_REVIEW_FALLBACK_USAGE });
    return EXIT_OK;
  }
  const [sub, ...tail] = rest;
  if (sub !== "prepare" && sub !== "record") {
    logger.error({ msg: `codex review-fallback: expected prepare or record, got ${JSON.stringify(sub)}` });
    logger.error({ msg: CODEX_REVIEW_FALLBACK_USAGE });
    return EXIT_USAGE;
  }
  const parsed = parseCodexReviewFallbackArgs({ rest: tail });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      logger.error({ msg: problem });
    }
    logger.error({ msg: CODEX_REVIEW_FALLBACK_USAGE });
    return EXIT_USAGE;
  }
  const common = {
    home: resolveHome({ named: stringFlag({ name: "home", parsed: parsed.value }) }),
    json: parsed.value.values["json"] === true,
    port,
    repo: repoDirOf({ repo: stringFlag({ name: "repo", parsed: parsed.value }) }),
  };
  if (sub === "prepare") {
    return prepare({ ...common, parsed: parsed.value });
  }
  const requestId = stringFlag({ name: "request", parsed: parsed.value });
  const answerFile = stringFlag({ name: "answer-file", parsed: parsed.value });
  if (requestId === undefined || answerFile === undefined) {
    logger.error({ msg: "codex review-fallback record: both --request <id> and --answer-file <path> are required" });
    logger.error({ msg: CODEX_REVIEW_FALLBACK_USAGE });
    return EXIT_USAGE;
  }
  return recordFallbackReview({
    ...common,
    answerFile,
    model: stringFlag({ name: "model", parsed: parsed.value }),
    requestId,
    workspace: stringFlag({ name: "workspace", parsed: parsed.value }),
  });
}

/** The diff and the tree it was cut from, or the exit code to stop on. */
function captureScope({
  args,
  repo,
}: {
  args: PrepareArgs;
  repo: string;
}): { readonly diff: ReviewDiff; readonly tree: CodexPassTree } | number {
  // BRACKETED around the diff read, not taken after it. The tree used to be captured once the diff was
  // already in hand, which reads the checkout as it stands a few git invocations later — the same subject
  // error `reviewPassProvenance` (`../../../codex/passProvenance.ts`) exists for, on the arm that stands in
  // for a review when Codex is capped. A receipt binds to the tree its diff was CUT FROM or to nothing.
  const captured = captureReviewDiffWithProvenance({ base: args.base, cwd: repo, maxBytes: args.maxDiffBytes });
  if (captured.isErr()) {
    logger.error({
      msg: `codex review-fallback prepare: could not capture the review diff: ${captured.error.message}`,
    });
    return EXIT_ERROR;
  }
  if (captured.value.capture.isErr()) {
    logger.error({ msg: refusalMessage({ refusal: captured.value.capture.error }) });
    return EXIT_USAGE;
  }
  const tree = captured.value.tree;
  if (tree === undefined) {
    logger.error({
      msg:
        "codex review-fallback prepare: the checkout moved while the diff was being read, so no single tree " +
        "describes it and nothing could bind a receipt to one — re-run on a settled tree",
    });
    return EXIT_ERROR;
  }
  return { diff: captured.value.capture.value, tree };
}

/**
 * Asked before the request is written: a Claude review spends one of the branch's two general passes exactly as a
 * Codex one does, so a third is refused here as `codex review` refuses it. A fallback is never a witness, so its
 * lane is always general.
 *
 * @returns true when the cap refused the review and no request may be written
 */
async function refusedAsThirdPass({
  diff,
  home,
  port,
  tree,
}: {
  diff: { readonly repoRoot: string; readonly sha256: string };
  home: string;
  port: FallbackRegisterPort;
  tree: { readonly branch: string | null };
}): Promise<boolean> {
  return refusedByReviewCap({
    branch: tree.branch,
    diff,
    env: process.env,
    fallbackPort: port,
    home,
    lane: "general",
    supersessions: supersessionPort(),
    verb: "codex review-fallback prepare",
  });
}

/** The `prepare` half: refuse unless capped, capture, write. */
async function prepare({
  parsed,
  home,
  port,
  repo,
  json,
}: {
  parsed: ParsedFlags;
  home: string;
  port: FallbackRegisterPort;
  repo: string;
  json: boolean;
}): Promise<number> {
  const args = preparePrepareArgs({ parsed });
  if (args.isErr()) {
    logger.error({ msg: args.error.message });
    logger.error({ msg: CODEX_REVIEW_FALLBACK_USAGE });
    return EXIT_USAGE;
  }
  if (refusedAsReservedWitness({ propertyId: args.value.property.id })) {
    return EXIT_USAGE;
  }
  // The refusal path never reads the cap, and the cap path never reads a pass record: which ground a request
  // stands on is the caller's explicit choice, never inferred, so a refused pass cannot quietly become a cap.
  const afterRefusal = stringFlag({ name: "after-refusal", parsed });
  // Given but blank is a mistake, never the cap path: a flag naming a ground must name one.
  if (parsed.values["after-refusal"] !== undefined && afterRefusal === undefined) {
    logger.error({ msg: "codex review-fallback prepare: --after-refusal needs the refused pass's artifact id" });
    return EXIT_USAGE;
  }
  const fleetGround = afterRefusal === undefined ? await readFallbackGround({ home, verb: "review" }) : undefined;
  if (typeof fleetGround === "number") {
    return fleetGround;
  }
  const scope = captureScope({ args: args.value, repo });
  if (typeof scope === "number") {
    return scope;
  }
  const { diff, tree } = scope;
  if (await refusedAsThirdPass({ diff, home, port, tree })) {
    return EXIT_ERROR;
  }
  const ground = requestGround({ afterRefusal, args: args.value, diff, fleetGround, home, tree });
  if (typeof ground === "number") {
    return ground;
  }
  const request: ClaudeFallbackReviewRequest = {
    ...ground,
    baseRef: args.value.base,
    baseSha: diff.baseSha,
    createdAtIso: new Date().toISOString(),
    diffBytes: diff.bytes,
    diffSha256: diff.sha256,
    headSha: diff.headSha,
    pass: args.value.pass,
    property: args.value.property,
    repoRoot: diff.repoRoot,
    requestId: randomUUID(),
    schemaVersion: 1,
    tree,
  };
  return persistRequest({ diffText: diff.text, home, json, port, request });
}

/**
 * Write the packet, then the request row, and print where the packet landed.
 *
 * The packet lands first and the row last, so a request in the store always had a complete packet for the
 * session that prepared it; a row the store refused takes its packet with it.
 */
async function persistRequest({
  diffText,
  home,
  json,
  port,
  request,
}: {
  diffText: string;
  home: string;
  json: boolean;
  port: FallbackRegisterPort;
  request: ClaudeFallbackReviewRequest;
}): Promise<number> {
  // What this build writes, this build must read back: a request the reader refuses strands its receipt.
  const readBack = parseFallbackRequest({ value: JSON.parse(JSON.stringify(request)) });
  if (readBack.isErr()) {
    logger.error({
      msg: `codex review-fallback prepare: the request would not read back: ${codexErrorLines({ error: readBack.error }).join("; ")}`,
    });
    return EXIT_ERROR;
  }
  const packet = writeReviewPacket({ diff: diffText, property: request.property, requestId: request.requestId });
  if (packet.isErr()) {
    logger.error({ msg: `codex review-fallback prepare: ${packet.error.message}` });
    return EXIT_ERROR;
  }
  const stored = await port.writeRequest({
    home,
    requestId: request.requestId,
    requestText: fallbackRequestText({ request }),
  });
  if (stored.isErr()) {
    discardPacket({ packet: packet.value });
    logger.error({ msg: `codex review-fallback prepare: ${stored.error.message}` });
    return EXIT_ERROR;
  }
  const { packetPath } = packet.value;
  if (json) {
    logger.out({ line: JSON.stringify({ packetPath, request }) });
    return EXIT_OK;
  }
  for (const line of preparedLines({ packetPath, request })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

/**
 * What `prepare` prints on success. Exported so the wording a session acts on is pinned by a test.
 *
 * @param request the request just written
 * @param packetPath where the packet landed
 * @returns the lines, in order
 */
export function preparedLines({
  request,
  packetPath,
}: {
  request: ClaudeFallbackReviewRequest;
  packetPath: string;
}): readonly string[] {
  return [
    `prepared fallback review ${request.requestId} (${request.pass}, ${request.property.id})`,
    `  packet: ${packetPath}`,
    `  diff: ${String(request.diffBytes)} bytes, sha256 ${request.diffSha256.slice(0, 12)}…, HEAD ${request.headSha.slice(0, 12)}`,
    `  ground: ${fallbackGroundLine({ request })}`,
    "  Read the packet in THIS visible session, answer the one property as review-output JSON, then run",
    `  slopweaver codex review-fallback record --request ${request.requestId} --answer-file <path>`,
  ];
}

/** `slopweaver codex review-fallback`. */
export const codexReviewFallbackCommand = defineCommand({ run: runCodexReviewFallback });
