/**
 * The pull-request form's `reviewLeftovers` field: the findings a change lands with after its second and last
 * Codex review pass, each one line the landing verbs read back byte-for-byte (`../../codex/reviewLeftovers.ts`).
 */
import { z } from "zod";
import { strictForm } from "../../strictForm.js";
import type { ReviewLeftoverEntry } from "./types.js";

/** A token a leftover line carries inside backticks: no backtick, slash, whitespace or angle bracket. */
const leftoverToken = ({ what }: { what: string }): z.ZodString =>
  z.string().regex(/^[A-Za-z0-9._:-]+$/, `${what} is one token of letters, digits, ".", "_", ":" or "-"`);

/**
 * A leftover's description: one line of plain text, starting and ending on a visible character, with no tag,
 * code span, emphasis, strikethrough, link bracket, table pipe, escape, entity, mention or control character.
 * An `@` is refused because a pull-request body notifies whoever it names. GitHub still links a bare URL and a
 * hash-and-number issue reference on its own, which no character ban can stop without refusing ordinary prose.
 */
const LEFTOVER_DESCRIPTION = /^[^\s<>`@*_[\]~|\\&](?:[^\p{C}\p{Zl}\p{Zp}<>`@*_[\]~|\\&]*[^\s<>`@*_[\]~|\\&])?$/u;

/**
 * One finding standing after the second and last Codex review pass. The description is one plain-text line
 * with no markup, because the line is read back byte-for-byte by the landing verbs.
 */
const reviewLeftoverSchema = strictForm({
  artifactId: leftoverToken({ what: "the artifact id" }),
  description: z
    .string()
    .max(300, "a leftover's description is one line of at most 300 characters")
    .regex(
      LEFTOVER_DESCRIPTION,
      "a leftover's description is one plain-text line: no `<`, `>`, backtick, `@`, `*`, `_`, `[`, `]`, `~`, `|`, " +
        "backslash, `&`, control character or line break",
    )
    .refine((text) => /[\p{L}\p{N}]/u.test(text), "a leftover's description must say what is still wrong"),
  pass: leftoverToken({ what: "the pass" }),
  propertyId: leftoverToken({ what: "the property id" }),
}) satisfies z.ZodType<ReviewLeftoverEntry>;

/** One to thirty-two leftovers, each artifact named once. */
export const reviewLeftoversSchema = z
  .array(reviewLeftoverSchema)
  .min(1)
  .max(32)
  .refine(
    (entries) => new Set(entries.map((entry) => entry.artifactId)).size === entries.length,
    "a leftover names an artifact id another leftover already names",
  );
