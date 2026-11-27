/**
 * `slopweaver codex plan-fallback prepare|record` — the Claude fallback PLAN, as two verbs.
 *
 * Owner ruling on the gold-owed-677 page: while Codex is capped, a visible Claude
 * session takes the plan pass BEFORE the work, so the plan half of the rule-9 floor is reachable again. The
 * decision and the document shapes are pure and live in `../../../codex/fallbackPlan.ts`; this file is the
 * shell. Neither verb spends a Codex turn or reaches the network beyond the local store, whose request and
 * receipt rows are the record (`../../../codex/fallbackPort.ts`).
 *
 * `prepare` is what `codex plan` does before its model call — read the task, build the exact planning prompt,
 * capture the tree — with the extra obligation the review fallback has: it refuses unless Codex is closed
 * right now or no Codex plan is registered at all, and writes the ground it saw into the request.
 *
 * `record` (its body is `./fallbackPlanRecord.ts`) validates the answer as a Codex plan response is validated and REFUSES once the tree has moved
 * since `prepare`. That refusal is the whole point: the plan is on the record before a single edit lands, and
 * the work that follows is what turns the row STALE — which is what the plan floor accepts.
 */

import { createHash, randomUUID } from "node:crypto";

import { discardPacket, writePlanPacket } from "../../../codex/fallbackPacket.js";
import type { ClaudeFallbackPlanRequest } from "../../../codex/fallbackPlan.js";
import { planGroundFor, planGroundLine } from "../../../codex/fallbackPlanGround.js";
import { type FallbackRegisterPort, fallbackRegisterPort } from "../../../codex/fallbackPort.js";
import { fallbackRequestText } from "../../../codex/fallbackRequestRead.js";
import type { VisibleClaudeReviewer } from "../../../codex/fallbackReview.js";
import { capturePassTree, resolveRepoRoot } from "../../../codex/gitDiff.js";
import { liveOriginRepositoryField } from "../../../codex/originBindingLive.js";
import { isPlanPass, parsePassId, passProfile } from "../../../codex/profiles.js";
import { buildPlanPrompt } from "../../../codex/prompt.js";
import type { FallbackFleetGround } from "../../../codex/providerUnregistered.js";
import type { CodexPassTree, PlanPassId } from "../../../codex/types.js";
import { slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { readFallbackGround } from "./fallbackCapRead.js";
import { recordFallbackPlan } from "./fallbackPlanRecord.js";
import { readTaskFile } from "./taskFile.js";

/** The checkout a plan request describes: its root, and the tree captured there. */
type Checkout = { readonly repoRoot: string; readonly tree: CodexPassTree };

/** How many argv entries precede the verb's own tail (`node`, `slopweaver`, `codex`, `plan-fallback`). */
const VERB_ARG_OFFSET = 4;

/** The flags both sub-verbs accept, as ONE spec so the help-truth ratchet has one parser to probe. */
const STRING_FLAGS = ["pass", "task-file", "request", "answer-file", "workspace", "model", "repo", "home"];
const BOOLEAN_FLAGS = ["json"];
const FALLBACK_PLAN_FLAGS: FlagSpec = { boolean: BOOLEAN_FLAGS, string: STRING_FLAGS };

/** The same flags, `--`-prefixed, for the help-truth ratchet. Derived rather than retyped. */
export const CODEX_PLAN_FALLBACK_FLAG_NAMES: readonly string[] = [...STRING_FLAGS, ...BOOLEAN_FLAGS]
  .map((name) => `--${name}`)
  .toSorted();

/** Usage for `codex plan-fallback`, shared by `--help` and every parse failure. */
export const CODEX_PLAN_FALLBACK_USAGE =
  "usage: slopweaver codex plan-fallback prepare --pass p1|p2|p3 --task-file <path> [--repo <dir>] [--home <dir>] [--json]\n" +
  "       slopweaver codex plan-fallback record --request <id> --answer-file <path>\n" +
  "           [--workspace <ref>] [--model <name>] [--repo <dir>] [--home <dir>] [--json]\n" +
  "\n" +
  "The plan pass a VISIBLE Claude session takes BEFORE the work when Codex is capped, or when no Codex plan\n" +
  "is registered at all (AGENTS.md rule 9).\n" +
  "\n" +
  "  prepare  REFUSED unless Codex is closed right now or unregistered. Builds the exact prompt `codex plan` would\n" +
  "           send, captures the tree it describes, and records the ground it saw. Prints the request id and the packet path.\n" +
  "  record   Validates --answer-file (the plan-output JSON a Codex pass returns: verdict READY|BLOCKED,\n" +
  "           summary, bodyMarkdown, blockers) and REFUSES if the tree moved since prepare — record before\n" +
  "           you edit, and keep the answer file outside the checkout. The work then makes the row STALE,\n" +
  "           which is what the plan floor accepts. One receipt per request.";

/**
 * Parse the verb's flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the verb's argument tail, sub-verb first
 * @returns the parsed flags, or the errors
 */
export function parseCodexPlanFallbackArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: FALLBACK_PLAN_FLAGS });
}

/** One declared string flag, or `undefined`. */
function stringFlag({ parsed, name }: { parsed: ParsedFlags; name: string }): string | undefined {
  const value = parsed.values[name];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/**
 * Run the verb — the composition root, naming the production fallback port.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function runCodexPlanFallback(argv: readonly string[]): Promise<number> {
  return runCodexPlanFallbackOver({ argv, port: fallbackRegisterPort() });
}

/**
 * Run the verb over a given fallback port — the seam a unit test hands an in-memory store.
 *
 * @param argv the whole process argv
 * @param port where the plan requests and receipts are read and written
 * @returns the process exit code
 */
export async function runCodexPlanFallbackOver({
  argv,
  port,
}: {
  argv: readonly string[];
  port: FallbackRegisterPort;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: CODEX_PLAN_FALLBACK_USAGE });
    return EXIT_OK;
  }
  const [sub, ...tail] = rest;
  if (sub !== "prepare" && sub !== "record") {
    logger.error({ msg: `codex plan-fallback: expected prepare or record, got ${JSON.stringify(sub)}` });
    logger.error({ msg: CODEX_PLAN_FALLBACK_USAGE });
    return EXIT_USAGE;
  }
  const parsed = parseCodexPlanFallbackArgs({ rest: tail });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      logger.error({ msg: problem });
    }
    logger.error({ msg: CODEX_PLAN_FALLBACK_USAGE });
    return EXIT_USAGE;
  }
  // A destructured default: an absent flag means the ambient home and the cwd, and the line says so.
  const { home = slopweaverHome(), repo = process.cwd() } = {
    home: stringFlag({ name: "home", parsed: parsed.value }),
    repo: stringFlag({ name: "repo", parsed: parsed.value }),
  };
  const common = { home, json: parsed.value.values["json"] === true, port, repo };
  if (sub === "prepare") {
    return prepare({ ...common, parsed: parsed.value });
  }
  return record({ ...common, parsed: parsed.value });
}

/** The repository root and the tree it is at, on a named branch, or the exit code to stop on. */
function captureCheckout({ repo }: { repo: string }): Checkout | number {
  const repoRoot = resolveRepoRoot({ cwd: repo });
  if (repoRoot.isErr()) {
    logger.error({ msg: `codex plan-fallback prepare: not a git repository: ${repoRoot.error.message}` });
    return EXIT_ERROR;
  }
  const tree = capturePassTree({ cwd: repoRoot.value });
  if (tree === undefined) {
    logger.error({
      msg: "codex plan-fallback prepare: could not capture the tree, so nothing could bind a receipt to it",
    });
    return EXIT_ERROR;
  }
  if (tree.branch === null) {
    logger.error({
      msg: "codex plan-fallback prepare: HEAD is detached, and a plan on no branch can never be placed on the one you land",
    });
    return EXIT_USAGE;
  }
  return { repoRoot: repoRoot.value, tree };
}

/** The frozen request for one prepared plan: the prompt and task by digest, the tree, and the ground seen. */
function planRequestFor({
  checkout,
  fleetGround,
  pass,
  prompt,
  task,
}: {
  checkout: Checkout;
  fleetGround: FallbackFleetGround;
  pass: PlanPassId;
  prompt: string;
  task: string;
}): ClaudeFallbackPlanRequest {
  return {
    ...planGroundFor({ fleetGround }),
    createdAtIso: new Date().toISOString(),
    // Read while the checkout exists: what re-proves this plan once its worktree is deleted.
    ...liveOriginRepositoryField({ repoRoot: checkout.repoRoot }),
    pass,
    promptBytes: Buffer.byteLength(prompt, "utf8"),
    promptSha256: createHash("sha256").update(prompt, "utf8").digest("hex"),
    repoRoot: checkout.repoRoot,
    requestId: randomUUID(),
    schemaVersion: 1,
    taskSha256: createHash("sha256").update(task, "utf8").digest("hex"),
    tree: checkout.tree,
  };
}

/**
 * Write the packet first and the request row last, so a stored request always had a complete packet; a refused
 * row takes its packet with it.
 */
async function storePlanRequest({
  home,
  port,
  prompt,
  request,
}: {
  home: string;
  port: FallbackRegisterPort;
  prompt: string;
  request: ClaudeFallbackPlanRequest;
}): Promise<string | number> {
  const packet = writePlanPacket({ prompt, requestId: request.requestId });
  if (packet.isErr()) {
    logger.error({ msg: `codex plan-fallback prepare: ${packet.error.message}` });
    return EXIT_ERROR;
  }
  const requestText = fallbackRequestText({ request });
  const stored = await port.writeRequest({ home, requestId: request.requestId, requestText });
  if (stored.isErr()) {
    discardPacket({ packet: packet.value });
    logger.error({ msg: `codex plan-fallback prepare: ${stored.error.message}` });
    return EXIT_ERROR;
  }
  return packet.value.packetPath;
}

/** The `prepare` half: refuse unless capped, build the prompt, capture, write. */
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
  const passFlag = stringFlag({ name: "pass", parsed });
  const pass = passFlag === undefined ? undefined : parsePassId({ value: passFlag });
  const taskFile = stringFlag({ name: "task-file", parsed });
  if (pass === undefined || !isPlanPass(pass) || taskFile === undefined) {
    logger.error({ msg: "codex plan-fallback prepare: --pass p1|p2|p3 and --task-file are both required" });
    logger.error({ msg: CODEX_PLAN_FALLBACK_USAGE });
    return EXIT_USAGE;
  }
  const fleetGround = await readFallbackGround({ home, verb: "plan" });
  if (typeof fleetGround === "number") {
    return fleetGround;
  }
  const task = readTaskFile({ path: taskFile, verb: "codex plan-fallback prepare" });
  if (typeof task === "number") {
    return task;
  }
  const checkout = captureCheckout({ repo });
  if (typeof checkout === "number") {
    return checkout;
  }
  const prompt = buildPlanPrompt({ profile: passProfile({ pass }), repoRoot: checkout.repoRoot, task });
  const request = planRequestFor({ checkout, fleetGround, pass, prompt, task });
  const packetPath = await storePlanRequest({ home, port, prompt, request });
  if (typeof packetPath === "number") {
    return packetPath;
  }
  if (json) {
    logger.out({ line: JSON.stringify({ packetPath, request }) });
    return EXIT_OK;
  }
  for (const line of preparedPlanLines({ packetPath, request })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

/**
 * What `prepare` prints on success. Exported so the wording a session acts on is pinned by a test.
 *
 * @param request the plan request just written
 * @param packetPath where the prompt packet landed
 * @returns the lines, in order
 */
export function preparedPlanLines({
  request,
  packetPath,
}: {
  request: ClaudeFallbackPlanRequest;
  packetPath: string;
}): readonly string[] {
  return [
    `prepared fallback plan ${request.requestId} (${request.pass})`,
    `  packet: ${packetPath}`,
    `  tree: HEAD ${request.tree.headSha.slice(0, 12)} on ${String(request.tree.branch)}`,
    `  ${planGroundLine({ request })}`,
    "  Read the packet in THIS visible session and answer it as plan-output JSON (verdict READY|BLOCKED, summary,",
    "  bodyMarkdown, blockers), written OUTSIDE the checkout. Record it BEFORE you edit anything — record refuses",
    "  once the tree has moved, because a plan recorded after the work proves nothing about order:",
    `  slopweaver codex plan-fallback record --request ${request.requestId} --answer-file <path>`,
  ];
}

/** Which visible session planned: the flags first, then the cmux workspace this process runs in. */
function plannerFor({ parsed }: { parsed: ParsedFlags }): VisibleClaudeReviewer {
  const model = stringFlag({ name: "model", parsed });
  const workspaceFlag = stringFlag({ name: "workspace", parsed });
  const ambient = process.env["CMUX_WORKSPACE_ID"];
  let workspace: string | null = null;
  if (workspaceFlag !== undefined) {
    workspace = workspaceFlag;
  } else if (ambient !== undefined && ambient.length > 0) {
    workspace = ambient;
  }
  let attestedModel: string | null = null;
  if (model !== undefined) {
    attestedModel = model;
  }
  return { host: "claude-code", model: attestedModel, workspace };
}

/** The `record` half: both flags required, then `./fallbackPlanRecord.ts` validates, refuses drift, writes once. */
async function record({
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
  const requestId = stringFlag({ name: "request", parsed });
  const answerFile = stringFlag({ name: "answer-file", parsed });
  if (requestId === undefined || answerFile === undefined) {
    logger.error({ msg: "codex plan-fallback record: both --request <id> and --answer-file <path> are required" });
    logger.error({ msg: CODEX_PLAN_FALLBACK_USAGE });
    return EXIT_USAGE;
  }
  return recordFallbackPlan({ answerFile, home, json, planner: plannerFor({ parsed }), port, repo, requestId });
}

/** `slopweaver codex plan-fallback`. */
export const codexPlanFallbackCommand = defineCommand({ run: runCodexPlanFallback });
