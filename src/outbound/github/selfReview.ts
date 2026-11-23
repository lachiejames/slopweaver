/**
 * The typed form for one inline self-review round (V3).
 *
 * These comments exist to orient a cold reviewer through the current diff. The schema owns the parts a
 * machine can prove: one current-diff line, concise prose, no duplicate locus, exact private voice rules, a
 * declared KIND whose fixed emoji opens the comment, file names written in backticks, and no pinned link.
 * Whether the prose actually makes the review easier remains visible-agent judgement and is stated in the
 * GitHub command guidance rather than pretended into a heuristic here.
 *
 * The emoji is RENDERED from the kind, never typed, so the same kind always reads the same way and a reviewer
 * can scan a round by its first character. A body that types one of the prefixes itself is refused, which is
 * what keeps a doubled `⚠️ ⚠️` impossible.
 */

import { z } from "zod";
import type { ReviewThreadDraft } from "../../corpus/github/write.js";
import { countWords } from "../../prformat/checkCore.js";
import { publicationProseMask } from "../publicationProse.js";
import { strictForm } from "../strictForm.js";
import { authoredProseOf, type ExactVoiceRule, exactVoiceRuleFindings, voiceRuleLabel } from "../voice/exactRules.js";

/** The owner's hard ceiling for one inline self-review comment. */
const MAX_SELF_REVIEW_WORDS = 50;

/**
 * What one comment is telling the reviewer, which decides the emoji it opens with. Closed.
 * @internal — the schema and the renderer here read it; tests pin it.
 */
export const SELF_REVIEW_KINDS = ["behaviour-change", "moved-unchanged", "risk", "test", "explanation"] as const;

/**
 * One self-review comment's kind.
 * @internal — read through {@link SelfReviewComment}; nothing outside this module names it.
 */
export type SelfReviewKind = (typeof SELF_REVIEW_KINDS)[number];

/**
 * The fixed emoji each kind renders as the comment's first character. `⚠️` and `♻️` are the owner's; the other
 * three are a fixed mapping documented in `skills/github/reference/self-review.md`, never chosen per comment.
 * @internal — {@link renderSelfReviewComment} is its one reader; tests pin it.
 */
export const SELF_REVIEW_KIND_PREFIX: Readonly<Record<SelfReviewKind, string>> = {
  "behaviour-change": "⚠️",
  explanation: "💡",
  "moved-unchanged": "♻️",
  risk: "🚩",
  test: "🧪",
};

/**
 * The file extensions a bare file name is recognised by. A product name spelled like a file (`Node.js`) is a
 * capitalised stem with no directory and is let through by {@link bareFileNamesIn}.
 */
const FILE_NAME =
  /(?<![\w./-])(?:[\w.-]+\/)*[\w-]+(?:\.[\w-]+)*\.(?:ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|mdx|ya?ml|sh|css|html|toml|lock|sql|txt|py|go|rs|graphql)(?![\w/-])/gu;

/** A GitHub blob link pinned to a commit or to a line, which goes stale on the next rebase. */
const PINNED_LINK = /https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/blob\/(?:[0-9a-f]{7,40}\/|[^\s)#]*#L\d)/iu;

/**
 * Every file name a comment body writes outside backticks.
 *
 * @param body the authored comment body
 * @returns each bare file name, in order
 * @internal — exported for its unit test; the comment schema is its one caller.
 */
export function bareFileNamesIn({ body }: { body: string }): readonly string[] {
  return [...publicationProseMask({ text: body }).matchAll(FILE_NAME)]
    .map((match) => match[0])
    .filter((name) => name.includes("/") || !/^[A-Z][a-z]+\.js$/u.test(name));
}

/**
 * Whether a comment body links a GitHub blob pinned to a commit or a line.
 *
 * @param body the authored comment body
 * @returns true when it does
 * @internal — exported for its unit test; the comment schema is its one caller.
 */
export function hasPinnedLink({ body }: { body: string }): boolean {
  return PINNED_LINK.test(body);
}

/** Whether a body opens with one of the rendered prefixes, which the kind supplies. */
function typesItsOwnPrefix({ body }: { body: string }): boolean {
  const opening = body.trimStart();
  return Object.values(SELF_REVIEW_KIND_PREFIX).some((prefix) => opening.startsWith(prefix.replace("️", "")));
}

/** The largest review round the exact readback can map in one bounded GitHub query. */
const MAX_SELF_REVIEW_COMMENTS = 100;

/** Whether a path names one repository-relative file without traversal or platform-specific separators. */
function isRepositoryPath({ value }: { value: string }): boolean {
  return (
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  );
}

const selfReviewCommentSchema = strictForm({
  body: z
    .string()
    .min(1)
    .refine((body) => body.trim().length > 0, "body must contain authored prose")
    .refine(
      (body) => countWords({ cell: body }) <= MAX_SELF_REVIEW_WORDS,
      `body must be at most ${String(MAX_SELF_REVIEW_WORDS)} words`,
    )
    .refine(
      (body) => !typesItsOwnPrefix({ body }),
      "body must not open with an emoji prefix: `kind` renders it (behaviour-change ⚠️, moved-unchanged ♻️, risk 🚩, test 🧪, explanation 💡)",
    )
    .superRefine((body, ctx) => {
      for (const name of bareFileNamesIn({ body })) {
        ctx.addIssue({ code: "custom", message: `body names ${name} outside backticks; write it as \`${name}\`` });
      }
    })
    .refine(
      (body) => !hasPinnedLink({ body }),
      "body must not link a GitHub blob pinned to a commit or a line, which goes stale on every rebase; name the file in backticks instead",
    ),
  kind: z.enum(SELF_REVIEW_KINDS),
  line: z.number().int().positive().max(2_147_483_647),
  path: z
    .string()
    .min(1)
    .refine((value) => isRepositoryPath({ value }), "path must be repository-relative"),
});

/** One submitted review, with at least one reviewer-orienting inline comment. */
export const selfReviewFormSchema = strictForm({
  comments: z
    .array(selfReviewCommentSchema)
    .min(1)
    .max(MAX_SELF_REVIEW_COMMENTS)
    .superRefine((comments, ctx) => {
      const seen = new Set<string>();
      comments.forEach((comment, index) => {
        const locus = `${comment.path}\u0000${String(comment.line)}`;
        if (seen.has(locus)) {
          ctx.addIssue({
            code: "custom",
            message: "only one self-review comment may target a path and line",
            path: [index],
          });
        }
        seen.add(locus);
      });
    }),
});

/** One validated inline review comment. */
export interface SelfReviewComment {
  readonly kind: SelfReviewKind;
  readonly body: string;
  readonly line: number;
  readonly path: string;
}

/**
 * The comment exactly as GitHub receives it: the kind's fixed emoji, one space, then the authored body.
 *
 * @param comment the validated comment
 * @returns the review thread the submit mutation sends
 */
export function renderSelfReviewComment({ comment }: { comment: SelfReviewComment }): ReviewThreadDraft {
  return { body: `${SELF_REVIEW_KIND_PREFIX[comment.kind]} ${comment.body}`, line: comment.line, path: comment.path };
}

/** The visible agent's complete self-review round. */
export interface SelfReviewForm {
  readonly comments: readonly SelfReviewComment[];
}

/**
 * Every comment of a round exactly as GitHub receives it: the one rendering both the submit mutation and the
 * description review read, so the bytes a review certified are the bytes posted.
 *
 * @param form the validated round, or undefined when the write posts none
 * @returns the rendered comments; `[]` for no round
 */
export function renderSelfReviewComments({ form }: { form: SelfReviewForm | undefined }): readonly ReviewThreadDraft[] {
  if (form === undefined) {
    return [];
  }
  return form.comments.map((comment) => renderSelfReviewComment({ comment }));
}

/** One actionable exact-rule refusal. */
export interface SelfReviewVoiceFinding {
  readonly path: string;
  readonly kind: ExactVoiceRule["kind"];
  /**
   * The rule NAMED as a whole clause, from {@link voiceRuleLabel} — already quoted, so a renderer must not
   * quote it again.
   *
   * It used to be the bare subject, which the CLI then re-quoted; when `voiceRuleSubject` started quoting
   * its own output the refusal came out as `voice rule "\"happy to\""`. It also carried the wrong POLARITY
   * for the `at-least-one` kind, which is broken by NOT appearing — "matches the configured at-least-one
   * voice rule" was the exact opposite of what fired.
   */
  readonly label: string;
}

/**
 * Check the operator's deterministic private voice rules against self-review prose.
 *
 * @param form the schema-valid review round
 * @param rules the operator's exact rules from profile.json
 * @returns every matched rule, in form order
 */
export function selfReviewVoiceFindings({
  form,
  rules,
}: {
  form: SelfReviewForm;
  rules: readonly ExactVoiceRule[];
}): readonly SelfReviewVoiceFinding[] {
  return exactVoiceRuleFindings({
    prose: form.comments.flatMap((comment, index) =>
      authoredProseOf({ path: `comments[${String(index)}].body`, text: comment.body }),
    ),
    rules,
  }).map((finding) => ({
    kind: finding.rule.kind,
    path: finding.path,
    label: voiceRuleLabel({ rule: finding.rule }),
  }));
}
