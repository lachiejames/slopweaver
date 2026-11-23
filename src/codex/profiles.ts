/**
 * The six pass profiles, the default model, and the pinned reasoning effort.
 *
 * Pure data. What varies between passes is the SHAPE OF THE QUESTION — broad vs one-property, diff or no
 * diff, what a valid answer looks like. The model has one default for every pass and a named per-pass
 * override (see {@link CODEX_MODEL}); the reasoning effort has no override at all.
 *
 * What the effort pin holds is UNIFORMITY, not one particular number. A per-pass effort dial would let a
 * caller ask for a check and quietly get a worse thinker than every other pass, so there is deliberately no
 * flag for it: it moves for the whole fleet at once or it does not move. A run that does not
 * converge is never a reason to reach for one — what IS the fix differs by arm (a review narrows its
 * property; a plan matches its bound to the breadth it was asked for first), and `skills/codex/SKILL.md`
 * carries that split rather than this file.
 *
 * There is also deliberately NO timeout in any profile. The bound is required per invocation
 * ({@link ./bounds.makePassBound}), because a 10-minute review and a 60-minute deep pass sharing one
 * accidental number is exactly how the predecessor ended up with a bound nobody could defend.
 */

import type { CodexPassId, PlanPassId, ReviewPassId } from "./types.js";

/**
 * THE DEFAULT. Bump both lines together on a Codex upgrade.
 *
 * `gpt-6-astra` spent a whole account in under a day and 20x Pro plans are not
 * purchasable, so the default is `gpt-5.6-sol`, with a right-model-for-the-job override per pass and
 * the difference MEASURED rather than argued — `slopweaver codex burn` reads sessions per five-hour window and
 * per week on each model out of the rollout logs. The owner's guess is two to four times the passes on 5.6; the verb
 * is what settles it. Effort stays `medium` so the model is the only thing that moved.
 *
 * Evidence either way: `gpt-5.6-sol` at `xhigh` is what caught a
 * `postMessage` running under both a client's default ten retries AND a four-retry wrapper — roughly 44
 * attempts at an irreversible POST — and a later ruling moved the pin to `gpt-6-astra` at
 * `medium`. Neither pair has been re-run against the other's findings.
 *
 * **The override is per PASS and named, never ambient.** `codex plan|review --model <id>` takes one pass onto
 * another model ({@link parseCodexModel} admits the id), and the artifact records the model that pass asked
 * for. Effort has no flag: a pass thinking less than its siblings is one nobody can compare.
 *
 * An effort setting alone does not pin the model: with `model` omitted, a user or global
 * `~/.codex/config.toml` default can drift while the effort stays fixed. Both are stated explicitly for
 * that reason.
 *
 * **A model bump is also an SDK bump, and it fails LOUDLY rather than silently.** `@openai/codex-sdk`
 * vendors the `codex` binary that actually opens the thread, so a model newer than that binary is refused
 * upstream — measured, `gpt-6-astra` on SDK 0.151.0 came back `400 invalid_request_error: "The
 * 'gpt-6-astra' model requires a newer version of Codex"`, surfacing as a `FATAL` pass ten seconds in with
 * no verdict. When you move this constant to a NEWER model, move `@openai/codex-sdk` in `package.json` with
 * it and run one real pass; reproduce the failure mode with
 * `node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex --version`.
 */
export const CODEX_MODEL = "gpt-5.6-sol";
export const CODEX_REASONING_EFFORT = "medium";

/** A model id as Codex spells one: lowercase, digits, dots, hyphens and underscores, starting alphanumeric. */
const CODEX_MODEL_ID = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Admit a `--model` value for one pass, or refuse it before anything is spent.
 *
 * Deliberately an open SHAPE rather than a closed list: a list would need a code change for every model
 * OpenAI ships, while an id Codex does not serve still fails loudly upstream on the first turn. What this
 * refuses is the typo that could not be a model at all — a space, an uppercase letter, a shell fragment.
 *
 * @param value the raw flag value
 * @returns the model id, or undefined when it cannot be one
 */
export function parseCodexModel({ value }: { value: string }): string | undefined {
  return CODEX_MODEL_ID.test(value) ? value : undefined;
}

/** A planning pass: broad by nature, converges on one artifact, never given a diff. */
export interface PlanPassProfile {
  readonly id: PlanPassId;
  readonly mode: "plan";
  readonly title: string;
  /** What this phase is FOR, in one line — rendered into the prompt. */
  readonly purpose: string;
  /** Planning may investigate the repo; that is the point of a broad pass. */
  readonly toolPolicy: "repo-investigation-allowed";
}

/** A review pass: exactly one falsifiable property, always given the diff, free to check it against more. */
export interface ReviewPassProfile {
  readonly id: ReviewPassId;
  readonly mode: "review";
  readonly title: string;
  readonly purpose: string;
  /**
   * The diff is the subject; the repository and the web are available for the context a diff alone cannot
   * give. It was `supplied-diff-only`, and reading further genuinely was out of scope — that changed when
   * the diff moved into a file the reviewer must open, which takes a tool call by construction.
   */
  readonly toolPolicy: "diff-first-repo-and-web-allowed";
}

export type PassProfile = PlanPassProfile | ReviewPassProfile;

const PLAN_PROFILES: Readonly<Record<PlanPassId, PlanPassProfile>> = {
  p1: {
    id: "p1",
    mode: "plan",
    purpose:
      "Establish what already exists that this work should reuse rather than reinvent, where the proposal " +
      "contradicts the codebase, which of its assertions are unverified assumption rather than measured " +
      "fact, and what is missing. Cite real files.",
    title: "P1 — comprehension and critique",
    toolPolicy: "repo-investigation-allowed",
  },
  p2: {
    id: "p2",
    mode: "plan",
    purpose:
      "Turn the comprehension pass into a straight-line implementation plan: the module layout, the real " +
      "typed signatures, the pure/effectful split, the test lanes, every gate obligation, and a build " +
      "order that is green at each step.",
    title: "P2 — the implementation plan",
    toolPolicy: "repo-investigation-allowed",
  },
  p3: {
    id: "p3",
    mode: "plan",
    purpose:
      "Adversarial pre-mortem. Assume the plan is built exactly as written, every gate is green and every " +
      "test passes, and it still fails. Say how, ranked by severity, and say specifically what a fully " +
      "passing suite would not catch.",
    title: "P3 — adversarial pre-mortem",
    toolPolicy: "repo-investigation-allowed",
  },
};

const REVIEW_PROFILES: Readonly<Record<ReviewPassId, ReviewPassProfile>> = {
  r1: {
    id: "r1",
    mode: "review",
    purpose: "Confirm this one correctness property holds in the supplied diff, against what was specified.",
    title: "R1 — correctness against the spec",
    toolPolicy: "diff-first-repo-and-web-allowed",
  },
  r2: {
    id: "r2",
    mode: "review",
    purpose:
      "Confirm this one house-rule property holds in the supplied diff. Pattern-matching work, but it " +
      "still runs at the pinned effort like every other pass.",
    title: "R2 — house rules and the gate",
    toolPolicy: "diff-first-repo-and-web-allowed",
  },
  r3: {
    id: "r3",
    mode: "review",
    purpose:
      "Try hard to BREAK this one property. Find a concrete input or state that falsifies it. What do the " +
      "tests pass on that is actually broken?",
    title: "R3 — adversarial",
    toolPolicy: "diff-first-repo-and-web-allowed",
  },
};

/** Every pass id, in running order. */
export const CODEX_PASS_IDS: readonly CodexPassId[] = ["p1", "p2", "p3", "r1", "r2", "r3"];

/**
 * Whether a pass id is a planning pass (broad, no diff) rather than a review pass.
 *
 * POSITIONAL by necessity, not by preference: TypeScript error TS1230 forbids a type predicate from
 * referencing a destructured binding, and `.claude/rules/typescript-patterns.md` lists type predicates as
 * an explicit exception to the named-object rule for exactly this reason.
 *
 * @param pass the pass id
 * @returns true for `p1`/`p2`/`p3`
 */
export function isPlanPass(pass: CodexPassId): pass is PlanPassId {
  return pass === "p1" || pass === "p2" || pass === "p3";
}

/**
 * The profile for a pass id.
 *
 * @param pass the pass id
 * @returns its profile (plan or review)
 */
export function passProfile({ pass }: { pass: CodexPassId }): PassProfile {
  return isPlanPass(pass) ? PLAN_PROFILES[pass] : REVIEW_PROFILES[pass];
}

/**
 * Parse a pass id from a raw flag value.
 *
 * @param value the raw `--pass` value
 * @returns the pass id, or undefined when it is not one of the six
 */
export function parsePassId({ value }: { value: string }): CodexPassId | undefined {
  return CODEX_PASS_IDS.find((id) => id === value.toLowerCase());
}
