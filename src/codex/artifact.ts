/**
 * Rendering a pass record to markdown. Pure — the writer is {@link ./artifactStore}.
 *
 * THIS FILE IS THE FIX FOR THE ORIGINAL COMPLAINT. The predecessor's worst failure mode, and the one named
 * first in the brief that started this work, was answers being truncated or lost: a substantive 18-minute
 * plan written off as a total loss; `output --clean` returning 53KB of terminal box-drawing; a job record
 * truncated at 500 characters; a whole planning pass gone when a tmux server died. The response is not a
 * better scraper — it is to stop scraping. The model's complete final response is written to a file, once,
 * atomically, and the file is the answer of record.
 *
 * Three rendering rules earn their place:
 *
 *  1. THE RAW RESPONSE IS ALWAYS INCLUDED, VERBATIM, inside a fence longer than any backtick run it
 *     contains. A plan's `bodyMarkdown` is itself markdown full of fenced code, so a fixed ``` fence would
 *     terminate early and silently swallow the rest — which is truncation reintroduced by the formatter.
 *  2. POLICY FIELDS SAY "requested". The SDK's `Turn` reports neither the model actually selected nor the
 *     sandbox actually applied, so `requestedModel` and `requestedSandboxMode` are the honest names. A
 *     reader must not mistake a request for an observation.
 *  3. AN UNMEASURED OBSERVATION RENDERS AS `-` WITH ITS REASON, never as `0`, and each attempt is reported
 *     separately with no derived total. See {@link ./bounds.formatUsage} and `./types`.
 */

import { absentAs } from "#lib/absent.js";
import { isRecord } from "../lib/parsers.js";
import { formatUsage } from "./bounds.js";
import { formatSalvage } from "./salvage.js";
import { formatTransportCause } from "./transportCause.js";
import type { CodexArtifactRecord, CodexAttempt, CodexPassOutcome, ItemActivity } from "./types.js";

/**
 * A fence guaranteed longer than any backtick run inside the content.
 *
 * Without this, a plan whose body contains its own fenced `ts` blocks would close the artifact's own fence at
 * the first inner one and the rest of the answer would read as prose — a formatter silently truncating the
 * thing this file exists to preserve.
 *
 * @param content whatever will go inside the fence
 * @returns a backtick run strictly longer than any inside `content`
 */
export function fenceFor({ content }: { content: string }): string {
  const runs = content.match(/`+/g);
  // No match means the content holds no backtick at all, so nothing inside can close the shortest fence.
  if (runs === null) {
    return "```";
  }
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return "`".repeat(Math.max(3, longest + 1));
}

/**
 * Item activity as one line: measured counts (including a meaningful zero), or an explicit absence.
 *
 * @param items what the pass did
 * @returns the line; a measured zero reads differently from "not measured", because reporting an unknown as
 *   zero is the silent-failure shape this file exists to avoid
 */
export function formatItems({ items }: { items: ItemActivity }): string {
  if (items.kind === "not-measured") {
    return `- (not measured: ${items.reason})`;
  }
  const entries = Object.entries(items.counts);
  if (entries.length === 0) {
    return "none";
  }
  return entries.map(([kind, n]) => `${kind}=${String(n)}`).join(", ");
}

/**
 * The raw final response as printed. A FATAL pass ends on a transport fault before any response exists, and a
 * no-verdict pass stopped before it answered at all has none either, so the fence states that none was produced.
 */
function renderedRawResponse({ raw }: { raw: string | null }): string {
  if (raw === null) {
    return "(none — the pass produced no response)";
  }
  return raw;
}

/** One attempt's block. */
function attemptSection({ attempt, index }: { attempt: CodexAttempt; index: number }): readonly string[] {
  return [
    `### Attempt ${String(index + 1)} — ${attempt.kind} (${attempt.status})`,
    "",
    `- thread id: ${absentAs({ value: attempt.threadId, whenAbsent: "null (the abort landed before the id existed)" })}`,
    `- started: ${attempt.startedAtIso}`,
    `- finished: ${attempt.finishedAtIso}`,
    `- elapsed: ${String(attempt.elapsedMs)}ms`,
    `- items: ${formatItems({ items: attempt.items })}`,
    "- usage:",
    ...formatUsage({ usage: attempt.usage }).map((line) => `  - ${line}`),
    ...(attempt.cause === undefined ? [] : [`- cause: ${formatTransportCause({ cause: attempt.cause })}`]),
    "",
  ];
}

/**
 * What to do next after a pass produced no verdict, which is NOT the same advice for both arms.
 *
 * The old line said "narrow the question rather than raising the bound" for every mode. For a review property
 * that is right: the property is one falsifiable claim and a claim that cannot be settled in the bound is
 * usually too broad. For a planning pass it is close to backwards — a plan's bound has to cover investigating
 * a repository AND writing a whole artifact, so breadth is an input the caller chose and the bound is the
 * thing that has to match it. Measured: three recorded planning passes burned 100% of a 1,500-to-1,800-second
 * bound, and the one narrowing recorded in the history halved the prompt and still did not conclude.
 */
function nextStepLines({ mode }: { mode: "plan" | "review" }): readonly string[] {
  if (mode === "review") {
    return [
      "NEXT: narrow the property, do not raise the bound. One falsifiable claim that cannot be settled inside",
      "the bound is nearly always more than one claim.",
    ];
  }
  return [
    "NEXT: match the bound to the BREADTH you asked for before narrowing anything. A planning pass has to",
    "investigate and then write a whole artifact, so a prompt covering more ground needs more time — and a",
    "narrower question inside the same bound has been measured to fail the same way. If the salvage below",
    "shows real investigation and a `no-conclusion-in-bound` reason, raise the bound. If it shows almost no",
    "commands, the prompt is the problem, not the clock.",
  ];
}

/**
 * The FATAL block: what failed, what the transport SAID when it did, and what the pass had already done.
 *
 * Both channels are written out whole, each in its own fence. The one-line cause above them is the bounded
 * summary a gate prints; this is the record, and a thrown exit error carries a stderr nobody should have to
 * reconstruct from a truncated line.
 *
 * The salvage is LAST because it is the least urgent thing here and the most voluminous — a reader chasing a
 * fault wants the cause, and a reader deciding whether to re-run the whole bound wants the fold.
 */
function fatalSection({ outcome }: { outcome: Extract<CodexPassOutcome, { kind: "fatal" }> }): readonly string[] {
  return [
    "## Outcome — FATAL",
    "",
    `The transport failed, so no verdict exists. This is a fault, not a finding.`,
    "",
    `- operation: ${outcome.error.operation}`,
    `- kind: ${outcome.error.kind}`,
    `- message: ${outcome.error.message}`,
    `- cause: ${formatTransportCause({ cause: outcome.cause })}`,
    "",
    "NEXT: read the cause before touching the question. A spend cap or an exhausted quota fails a one-line task",
    "file exactly the same way, so narrowing a diff or a property against it spends nothing and fixes nothing.",
    "",
    ...causeChannels({ cause: outcome.cause }),
    ...formatSalvage({ salvage: outcome.salvage }),
  ];
}

/**
 * Both channels of a recorded cause, each whole in its own fence — or one, when they say the same thing.
 *
 * A `turn.failed` throws its own message (`./client.ts`), so on that path the two channels are identical, and
 * printing the sentence twice reads as two failures. Measured on a live spend cap.
 *
 * @param cause the recorded cause, as read — `unknown` because a disk record is only shallow-decoded, so an old
 *   record has none and a malformed one renders no channels rather than throwing
 */
function causeChannels({ cause }: { cause: unknown }): readonly string[] {
  if (!isRecord(cause) || typeof cause["thrown"] !== "string") {
    return [];
  }
  const thrown = cause["thrown"];
  const reported = cause["reported"];
  if (reported === thrown) {
    return ["### What the stream reported, and the boundary threw", "", ...fenced({ content: thrown }), ""];
  }
  return [
    "### What the stream reported",
    "",
    ...fenced({ content: typeof reported === "string" ? reported : "(nothing — the stream reported no failure)" }),
    "",
    "### What the boundary threw",
    "",
    ...fenced({ content: thrown }),
    "",
  ];
}

/** Content inside a fence sized to outlast it. */
function fenced({ content }: { content: string }): readonly string[] {
  const fence = fenceFor({ content });
  return [fence, content, fence];
}

/** The verdict block, including the reason when there is no verdict. */
function outcomeSection({ mode, outcome }: { mode: "plan" | "review"; outcome: CodexPassOutcome }): readonly string[] {
  if (outcome.kind === "fatal") {
    return fatalSection({ outcome });
  }
  if (outcome.kind === "no-verdict") {
    return [
      "## Outcome — NO VERDICT",
      "",
      `Reason: \`${outcome.reason}\`.`,
      "",
      "**This is not a clean result.** The pass ran but produced nothing that can be relied on, and nothing",
      "below is a verdict. Never read any of it as approval to proceed.",
      "",
      ...nextStepLines({ mode }),
      "",
      ...formatSalvage({ salvage: outcome.salvage }),
    ];
  }
  const answer = outcome.answer;
  const lines = ["## Outcome — " + answer.verdict, "", answer.summary, ""];
  if ("blockers" in answer) {
    return [
      ...lines,
      ...(answer.blockers.length > 0 ? ["### Blockers", "", ...answer.blockers.map((b) => `- ${b}`), ""] : []),
      "### Body",
      "",
      answer.bodyMarkdown,
      "",
    ];
  }
  return [
    ...lines,
    `- property: \`${answer.propertyId}\``,
    "",
    "### Evidence",
    "",
    answer.evidence.length > 0 ? answer.evidence : "_none given_",
    "",
    "### Counterexample",
    "",
    answer.counterexample.length > 0 ? answer.counterexample : "_none — the property held_",
    "",
  ];
}

/**
 * The tree lines, or a stated absence.
 *
 * An unknown tree is written down rather than omitted. A missing line reads as "clean" to a human skimming
 * the artifact, and the whole point of this record is that it never overstates what was established.
 */
function treeSection({ record }: { record: CodexArtifactRecord }): readonly string[] {
  const tree = record.tree;
  if (tree === undefined) {
    return ["- tree at pass start: `unknown` (not captured — treat staleness as undecidable, not as fresh)"];
  }
  return [
    `- branch: ${tree.branch === null ? "`(detached HEAD)`" : `\`${tree.branch}\``}`,
    `- tree fingerprint at pass start: \`${tree.fingerprint}\``,
    `- HEAD at pass start: \`${tree.headSha}\``,
    `- uncommitted at pass start: ${String(tree.dirtyBytes)} bytes of patch`,
    tree.snapshotCommit === undefined
      ? "- read: the LIVE tree (no frozen copy was available, so later edits could have raced this pass)"
      : `- read: a frozen copy at \`${tree.snapshotCommit}\` — later edits to the repository could not affect it`,
  ];
}

/** The scope block: what this pass was actually pointed at. */
function scopeSection({ record }: { record: CodexArtifactRecord }): readonly string[] {
  const scope = record.scope;
  if (scope.mode === "plan") {
    return [
      `- pass: \`${scope.pass}\` (planning — broad, no diff)`,
      `- prompt sha256: \`${scope.promptSha256}\``,
      `- prompt bytes: ${String(scope.promptBytes)}`,
    ];
  }
  return [
    `- pass: \`${scope.pass}\` (review — one property, diff supplied)`,
    `- property id: \`${scope.property.id}\``,
    `- property: ${scope.property.statement}`,
    `- base ref: \`${scope.baseRef}\``,
    `- base sha (merge-base): \`${scope.baseSha}\``,
    `- HEAD sha at capture: \`${scope.headSha}\``,
    `- diff sha256: \`${scope.diffSha256}\``,
    `- diff bytes: ${String(scope.diffBytes)}`,
  ];
}

/**
 * Render a complete pass record as markdown.
 *
 * @param record the pass record
 * @returns the artifact's full text
 */
export function renderCodexArtifact({ record }: { record: CodexArtifactRecord }): string {
  const raw = record.outcome.kind === "fatal" ? null : record.outcome.rawFinalResponse;
  const fence = raw === null ? "```" : fenceFor({ content: raw });
  return [
    `# Codex pass artifact — ${record.scope.pass}`,
    "",
    "> The answer of record. Written once, atomically, after the pass completed. Read THIS file rather than",
    "> any terminal output: nothing here is truncated, and it survives the process that produced it.",
    "",
    "## Provenance",
    "",
    `- schema version: ${String(record.schemaVersion)}`,
    `- artifact id: \`${record.artifactId}\``,
    `- created: ${record.createdAtIso}`,
    `- repo root: \`${record.repoRoot}\``,
    ...treeSection({ record }),
    ...scopeSection({ record }),
    "",
    "### Requested policy",
    "",
    "These are what was ASKED FOR. The SDK reports neither the model it actually selected nor the sandbox it",
    "actually applied, so none of these is an observation.",
    "",
    `- requested model: \`${record.requestedModel}\``,
    `- requested reasoning effort: \`${record.requestedReasoningEffort}\``,
    `- requested sandbox: \`${record.requestedSandboxMode}\``,
    `- requested network access: \`${String(record.requestedNetworkAccess)}\``,
    `- requested web search: \`${String(record.requestedWebSearch)}\``,
    `- workspace prepared (writable): ${record.requestedWritableRoots.map((root) => `\`${root}\``).join(", ")}`,
    `- requested approval policy: \`${record.requestedApprovalPolicy}\` (load-bearing: measured to be what`,
    "  blocks an MCP tool dispatch, under both read-only and workspace-write)",
    "",
    "### Bound",
    "",
    `- requested bound: ${String(record.bound.totalMs)}ms`,
    `- warn at: ${String(record.bound.warnAfterMs)}ms (85%)`,
    `- conclusion window: ${String(record.bound.conclusionWindowMs)}ms`,
    `- observed elapsed: ${String(record.observedElapsedMs)}ms`,
    "",
    "## Attempts",
    "",
    "Each attempt is reported separately and NO total is derived. Which of the five token counters overlap",
    "their parents is not established, so any sum would be a guess presented as a measurement.",
    "",
    ...record.attempts.flatMap((attempt, index) => attemptSection({ attempt, index })),
    ...outcomeSection({ mode: record.scope.mode, outcome: record.outcome }),
    "## Raw final response",
    "",
    "Verbatim, complete, in a fence sized to outlast any backtick run inside it.",
    "",
    fence,
    renderedRawResponse({ raw }),
    fence,
    "",
  ].join("\n");
}
