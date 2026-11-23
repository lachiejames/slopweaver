/**
 * The `read-only-subagent` tier's contract: a bounded investigation task in, labelled evidence back to the
 * initiating supervisor, never a Slack write and never the final composition.
 *
 * ## Why this is an injected function, not a real invocation
 *
 * Slopweaver's own process may never start a model (AGENTS.md rule 2). A genuine subagent dispatch is
 * necessarily a VISIBLE HOST ACTION — the already-running Claude Code or Codex session's own native
 * subagent/tool-use mechanism, not anything this CLI spawns. `ReadOnlySubagentAdapter` mirrors
 * `RoutingJudgement`: a plain injected seam this plugin ships no production model-calling default for.
 * What `tier.ts` validates is the SHAPE of what came back, exactly the way `judgeRouting`
 * validates a decision rather than deriving one.
 *
 * ## `ExecutionEvidence` is not an opaque continuation (P3 finding #1, CRITICAL)
 *
 * Per H5's `TrustLabeledContext`: what a subagent returns must carry the same author/source labels forward,
 * not collapse into free text a later judgement call could mistake for an instruction. There is deliberately
 * no free-form "recommendation" or "next step" field — only labelled observations, the same control-plane/
 * quoted-evidence split H5 already enforces for routing input.
 */
import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";
import type { AskIdentity } from "../ask/identity.js";

/** Who observed one fact a subagent returned — never conflated with an instruction from that author. */
type ObservationAuthor = "owner" | "non-owner" | "system";

/** One labelled fact a read-only subagent's investigation surfaced. */
interface ExecutionObservation {
  readonly text: string;
  readonly author: ObservationAuthor;
  /** Where this came from — a file path, an API response, a thread message id. Never free text alone. */
  readonly source: string;
}

/**
 * Everything a read-only subagent reports back. Deliberately just observations — no recommendation, no next
 * step — so a later judgement call reads this as evidence to weigh, never as an instruction to follow.
 */
export interface ExecutionEvidence {
  readonly observations: readonly ExecutionObservation[];
}

/** A bounded, read-only investigation handed to a subagent — never a write, never a Slack post. */
export interface ReadOnlyTask {
  readonly ask: AskIdentity;
  /** What to investigate, in the visible supervisor's own words. */
  readonly instructions: string;
}

/** The adapter's own outcome — evidence gathered, or why the investigation could not complete. */
export type ReadOnlySubagentOutcome =
  | { readonly kind: "returned"; readonly evidence: ExecutionEvidence }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * The read-only-subagent seam. Production has no default implementation — see this module's own header for
 * why a real one would violate rule 2. A test injects a plain fake; a real host wires this to its own native
 * subagent mechanism from OUTSIDE this process.
 */
export type ReadOnlySubagentAdapter = (task: ReadOnlyTask) => Promise<ReadOnlySubagentOutcome>;

const executionObservationSchema = z
  .object({
    author: z.enum(["owner", "non-owner", "system"]),
    source: z.string().min(1),
    text: z.string().min(1),
  })
  .strict() satisfies z.ZodType<ExecutionObservation>;

/**
 * The strict parse-edge schema for a decoded {@link ExecutionEvidence} — the boundary `turn dispatch
 * --subagent-report` reads a host's native subagent output through, rather than trusting it typed.
 */
const executionEvidenceSchema = z
  .object({ observations: z.array(executionObservationSchema) })
  .strict() satisfies z.ZodType<ExecutionEvidence>;

/**
 * Parse an already-decoded value as {@link ExecutionEvidence}.
 *
 * @param value the decoded JSON value
 * @returns the validated evidence, or every schema violation
 */
export function parseExecutionEvidence({ value }: { value: unknown }): Result<ExecutionEvidence> {
  const parsed = executionEvidenceSchema.safeParse(value);
  return parsed.success ? ok(parsed.data) : err(parsed.error.issues.map((issue) => issue.message));
}
