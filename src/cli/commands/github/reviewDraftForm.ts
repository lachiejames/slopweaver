/**
 * The typed form a session parks a review with, and the owner's exact voice rules over everything in it that would
 * be posted under the owner's name. Pure. Anchoring the decoded comments against the live diff is `./reviewDraftCore.ts`.
 */
import { z } from "zod";

import { err, ok } from "../../../lib/result.js";
import { REVIEW_VERDICTS, type ReviewVerdict } from "../../../outbound/github/reviewDraft.js";
import { strictForm } from "../../../outbound/strictForm.js";
import {
  authoredProseOf,
  type ExactVoiceRule,
  exactVoiceRuleFindings,
  voiceRuleLabel,
} from "../../../outbound/voice/exactRules.js";
import { GithubVerbErrors, type GithubVerbResult } from "./errors.js";

/** The most comments one review may carry — a bound, so a runaway form is refused rather than posted. */
export const MAX_REVIEW_COMMENTS = 50;

/** Whether a path names one repository-relative file. */
function isRepositoryPath({ value }: { value: string }): boolean {
  return (
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  );
}

const reviewCommentSchema = strictForm({
  body: z.string().refine((body) => body.trim().length > 0, "body must contain authored prose"),
  line: z.number().int().positive(),
  path: z.string().refine((value) => isRepositoryPath({ value }), "path must be repository-relative"),
  startLine: z.number().int().positive().optional(),
});

/** The review a session parks: a verdict, a body, line comments, and an optional deeper-review offer. */
const reviewDraftFormSchema = strictForm({
  body: z.string(),
  comments: z.array(reviewCommentSchema).max(MAX_REVIEW_COMMENTS),
  deeperReview: z
    .string()
    .refine((value) => value.trim().length > 0, "deeperReview, when present, names the risk")
    .optional(),
  verdict: z.enum(REVIEW_VERDICTS),
}).superRefine((form, ctx) => {
  if (form.verdict !== "APPROVE" && form.body.trim() === "") {
    ctx.addIssue({
      code: "custom",
      message: `a ${form.verdict} review needs a body — GitHub refuses one without`,
      path: ["body"],
    });
  }
});

/** A decoded review form, before it is anchored against the live diff. */
export interface ReviewDraftForm {
  readonly verdict: ReviewVerdict;
  readonly body: string;
  readonly comments: readonly {
    readonly path: string;
    readonly line: number;
    readonly startLine?: number | undefined;
    readonly body: string;
  }[];
  readonly deeperReview?: string | undefined;
}

/**
 * Decode a review form and apply the owner's exact voice rules to everything that would be posted under the owner's
 * name: the body and every comment. `deeperReview` is an offer to the owner and is not posted, so it is not judged.
 *
 * @param raw the JSON supplied to --form
 * @param exactVoiceRules the owner's exact rules from profile.json
 * @returns the form, or every refusal
 */
export function parseReviewDraftForm({
  raw,
  exactVoiceRules,
}: {
  raw: string;
  exactVoiceRules: readonly ExactVoiceRule[];
}): GithubVerbResult<ReviewDraftForm> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (cause: unknown) {
    return err(GithubVerbErrors.formNotJson({ cause }));
  }
  const decoded = reviewDraftFormSchema.safeParse(value);
  if (!decoded.success) {
    const reasons = decoded.error.issues.map((issue) => {
      const path = issue.path.map((part) => String(part)).join(".");
      return path.length === 0 ? issue.message : `${path}: ${issue.message}`;
    });
    return err(GithubVerbErrors.formInvalid({ form: "--form", reasons }));
  }
  const form = decoded.data;
  const findings = exactVoiceRuleFindings({
    prose: [
      ...authoredProseOf({ path: "body", text: form.body }),
      ...form.comments.flatMap((comment, index) =>
        authoredProseOf({ path: `comments[${String(index)}].body`, text: comment.body }),
      ),
    ],
    rules: exactVoiceRules,
  });
  if (findings.length > 0) {
    return err(
      GithubVerbErrors.formInvalid({
        form: "--form",
        reasons: findings.map(
          (finding) =>
            `${finding.path} ${voiceRuleLabel({ rule: finding.rule })}. Rewrite it; a review goes out as the owner.`,
        ),
      }),
    );
  }
  return ok(form);
}
