/**
 * The pure half of the fan-out verbs: where a plan lives, what its report says, and what a harvest reads as.
 *
 * Split from {@link ./read} for the reason every shell here is split — a line a person reads is a value a
 * test can assert, and the effectful half is then a plain resolve → write → print sequence.
 */
import { join } from "node:path";

import { err, ok, type Result } from "../../../lib/result.js";
import type { FanoutHarvest, FanoutPlan, Shard } from "../../../retrieval/fanout.js";
import { readerInstruction } from "../../../retrieval/fanout.js";
import { stateHomePaths } from "../../../stateHome.js";
import { parseFlags } from "../../parseFlags.js";
import { type StoreCommandError, StoreCommandErrors } from "./errors.js";

/** Where one fan-out's shards and plan live, under the home. */
export interface FanoutPaths {
  readonly dir: string;
  readonly plan: string;
}

/**
 * A directory name for one fan-out, from its instant and its question.
 *
 * The question rides along so a directory listing is readable months later, and it is reduced to
 * lower-case words joined by dashes rather than escaped, because a shell-safe path is worth more here than
 * a reversible one — the question itself is inside the plan.
 *
 * @param nowIso the instant the plan was made
 * @param question the question being answered
 * @returns the directory's own name
 */
export function fanoutSlug({ nowIso, question }: { nowIso: string; question: string }): string {
  const words = question
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 48);
  const stamp = nowIso.replaceAll(/[:.]/g, "-");
  return words.length > 0 ? `${stamp}-${words}` : stamp;
}

/**
 * Where one fan-out's files go.
 *
 * @param home the Slopweaver home
 * @param slug the fan-out's own directory name
 * @returns the directory and the plan file inside it
 */
export function fanoutPaths({ home, slug }: { home: string; slug: string }): FanoutPaths {
  const dir = join(stateHomePaths({ home }).fanout, slug);
  return { dir, plan: join(dir, "plan.json") };
}

/**
 * Where one shard's records are written.
 *
 * @param dir the fan-out's directory
 * @returns the shard file's path
 */
export function shardPath({ dir, shard }: { dir: string; shard: Shard }): string {
  return join(dir, `${shard.id}.jsonl`);
}

/**
 * How many characters of record text a shard carries. Pure.
 *
 * @returns the sum of its records' text lengths
 */
export function shardChars({ shard }: { shard: Shard }): number {
  return shard.records.reduce((total, record) => total + record.text.length, 0);
}

/**
 * The report a fan-out plan prints: what it selected, and the exact instruction for each reader. Pure.
 *
 * The instruction is printed IN FULL for every shard rather than once with a placeholder, because the
 * session dispatching the readers copies it — and a template a caller has to fill in is a template a
 * caller fills in differently for shard three.
 *
 * @param dir where the shards were written
 * @param planPath where the plan itself was written
 * @returns the lines to print
 */
export function planLines({
  plan,
  dir,
  planPath,
}: {
  plan: FanoutPlan;
  dir: string;
  planPath: string;
}): readonly string[] {
  if (plan.shards.length === 0) {
    return [
      `no candidate records for: ${plan.question}`,
      "That is a fact about the store, not about the world — widen the filters, or load more with `slopweaver store load`.",
    ];
  }
  const lines: string[] = [
    `FAN-OUT PLAN — ${String(plan.shards.length)} shard(s) over ${String(plan.candidates)} candidate record(s)`,
    `  question: ${plan.question}`,
    `  plan:     ${planPath}`,
    `  shards:   ${dir}`,
    "",
    "Dispatch ONE reader per shard, ALL IN PARALLEL, each as an in-process Agent on a cheap model",
    '(model: "haiku"). No model runs in this CLI — rule 2 — so the readers are yours to start and the',
    "checking is this verb's. Give each reader exactly the instruction under its shard, verbatim.",
    "",
  ];
  for (const shard of plan.shards) {
    const path = shardPath({ dir, shard });
    lines.push(
      `── shard ${shard.id} — ${String(shard.records.length)} record(s), ${String(shardChars({ shard }))} chars → ${path}`,
      "",
      readerInstruction({ path, question: plan.question, shard }),
      "",
    );
  }
  lines.push(
    "Collect every reply into one JSON array and check it:",
    `  slopweaver store collect --plan ${planPath} --replies <file.json>`,
  );
  return lines;
}

/**
 * What a checked harvest reads as: what survived, what did not, and which reader never answered. Pure.
 *
 * Every rejection is printed with its id and its reason rather than counted, because a fan-out whose
 * readers quietly hallucinated and whose report said only "3 dropped" would hide the one thing worth
 * knowing about a fan-out.
 *
 * @param harvest the checked findings
 * @returns the lines to print
 */
export function harvestLines({ harvest }: { harvest: FanoutHarvest }): readonly string[] {
  const refusals = harvest.rejected.length + harvest.shardFailures.length;
  const lines: string[] = [
    `${String(harvest.kept.length)} finding(s) survived checking, ${String(refusals)} refused`,
    "",
  ];
  for (const kept of harvest.kept) {
    lines.push(
      `[${kept.record.source}] (${kept.record.id}) ${kept.record.url}`,
      ...(kept.record.title !== null ? [`  ${kept.record.title}`] : []),
      `  why: ${kept.finding.why}`,
      `  “${kept.finding.quote}”`,
      "",
    );
  }
  for (const refused of harvest.rejected) {
    lines.push(`refused ${refused.id} from shard ${refused.shard}: ${refused.reason}`);
  }
  // Printed even when that shard's reply carried NOTHING: a slice whose integrity failed is a fact about
  // the slice, and a reply of zero findings from a tampered shard used to say nothing at all.
  for (const failed of harvest.shardFailures) {
    lines.push(`refused the whole of shard ${failed.shard}: ${failed.reason}`);
  }
  if (harvest.missingShards.length > 0) {
    lines.push(
      `no reply for shard(s) ${harvest.missingShards.join(", ")} — a reader that never ran is not a reader that found nothing`,
    );
  }
  return lines;
}

/**
 * The flags `store collect` takes.
 *
 * @internal
 */
export const COLLECT_FLAGS = { boolean: ["json"], string: ["plan", "replies"] } as const;

/**
 * The flags `store collect` advertises, for the help-truth ratchet.
 *
 * @internal
 */
export const STORE_COLLECT_FLAG_NAMES: readonly string[] = [
  ...COLLECT_FLAGS.string.map((name) => `--${name}`),
  ...COLLECT_FLAGS.boolean.map((name) => `--${name}`),
];

/** A parsed `store collect` invocation. */
export interface StoreCollectArgs {
  readonly plan: string;
  readonly replies: string;
  readonly json: boolean;
}

/**
 * Parse a `store collect` invocation. PURE — it reads neither file, it only says which two to read.
 *
 * @param rest the argv tail
 * @returns the two paths and the output mode, or every reason the invocation was refused
 */
export function parseStoreCollectArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<StoreCollectArgs, StoreCommandError> {
  const parsed = parseFlags({ args: rest, spec: COLLECT_FLAGS });
  if (parsed.isErr()) {
    return err(StoreCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const plan = parsed.value.values["plan"];
  const replies = parsed.value.values["replies"];
  if (typeof plan !== "string" || typeof replies !== "string") {
    return err(StoreCommandErrors.collectPathsMissing());
  }
  return ok({ json: parsed.value.values["json"] === true, plan, replies });
}
