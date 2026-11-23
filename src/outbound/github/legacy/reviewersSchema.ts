/**
 * The Who reviews what section's schema, beside `./schema.ts` that carries it as the optional `reviewers` field.
 * `github pr reviewers` derives the rows (`./reviewerTable.ts`); this is what a row must be to render at all.
 */
import { z } from "zod";
import { strictForm } from "../../strictForm.js";
import { lineText } from "../schemaText.js";
import type { ReviewerRow } from "./types.js";

/** A GitHub mention token: `@login` or `@org/team`, exactly the shapes CODEOWNERS spells. */
const MENTION = z
  .string()
  .regex(
    /^@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\/[A-Za-z0-9._-]+)?$/,
    "must be a GitHub @login or @org/team, as CODEOWNERS spells it",
  );

/** A changed path on one line, as the files cell lists it. */
const CHANGED_PATH = lineText({ what: "a changed path" });

const reviewerRowSchema = strictForm({
  look: z.discriminatedUnion("kind", [
    strictForm({ files: z.array(CHANGED_PATH).min(1), kind: z.literal("files") }),
    strictForm({ kind: z.literal("rest") }),
  ]),
  standsInFor: z.array(MENTION),
  who: z.array(MENTION).min(1),
}) satisfies z.ZodType<ReviewerRow>;

/** The most rows the table carries: past this it is a wall, and the split belongs in smaller pull requests. */
const REVIEWER_ROWS_MAX = 10;

/**
 * The Who reviews what table: two rows at least (one owner is what GitHub already says), one everything-else row
 * at most and only last, no file on two rows, and no two rows tagging the same reviewers in any case or order,
 * because one reviewer set reads one row and its deep link lands on it.
 */
export const reviewersSchema = z
  .array(reviewerRowSchema)
  .min(2, "the reviewer table needs two rows at least — one owner covering every file is what GitHub already says")
  .max(REVIEWER_ROWS_MAX)
  .superRefine((rows, ctx) => {
    const restAt = rows.findIndex((row) => row.look.kind === "rest");
    if (restAt !== -1 && restAt !== rows.length - 1) {
      ctx.addIssue({ code: "custom", message: "the everything-else row comes last, and there is only one" });
    }
    const perRow = rows.map((row) => (row.look.kind === "files" ? row.look.files : []));
    if (perRow.some((listed) => new Set(listed).size !== listed.length)) {
      ctx.addIssue({ code: "custom", message: "a reviewer row lists the same file twice" });
    }
    const files = perRow.flatMap((listed) => [...new Set(listed)]);
    const twice = files.filter((file, index) => files.indexOf(file) !== index);
    if (twice.length > 0) {
      ctx.addIssue({ code: "custom", message: `a file sits on two reviewer rows: ${[...new Set(twice)].join(", ")}` });
    }
    const keys = rows.map((row) => [...new Set(row.who.map((token) => token.toLowerCase()))].toSorted().join(" "));
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: "custom", message: "two reviewer rows tag the same reviewers; merge them into one row" });
    }
    for (const row of rows) {
      const tagged = new Set(row.who.map((token) => token.toLowerCase()));
      if (tagged.size !== row.who.length) {
        ctx.addIssue({ code: "custom", message: "a reviewer row tags the same reviewer twice" });
      }
      if (row.standsInFor.some((token) => tagged.has(token.toLowerCase()))) {
        ctx.addIssue({ code: "custom", message: "a reviewer row stands a token in for itself" });
      }
    }
  }) satisfies z.ZodType<readonly ReviewerRow[]>;
