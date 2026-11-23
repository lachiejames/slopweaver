/**
 * The one schema a mining brief's source manifest is held to, wherever a manifest is met: when the scan
 * builds one, when the store reads one back, and when an answer is accepted against one. Shared, because the
 * manifest hash is only injective over manifests this schema admits — JSON writes `-0` as `0` and every
 * non-finite number as `null`, and any in-band spelling of those collides with some other value — so a
 * manifest is validated before it is ever hashed, and the hash never sees a value the scan cannot write.
 */
import { z } from "zod";

import { err, ok, type Result } from "../lib/result.js";
import type { JudgementSourceManifestEntry } from "./miningBrief.js";
import type { JudgementSampleCoverage } from "./sourceSelection.js";

/**
 * A count the scan wrote: a non-negative safe integer, never `-0`, so it is never one of the values JSON
 * cannot tell apart.
 */
const countSchema = z
  .number()
  .int()
  .nonnegative()
  .refine((value) => !Object.is(value, -0), { message: "a count is never negative zero" });

/** A coverage measurement, exactly as `./sourceSelection.ts` writes it. */
const coverageSchema = z
  .object({
    budgetSkippedFiles: countSchema,
    candidateChars: countSchema,
    candidateFiles: countSchema,
    contract: z.string().min(1),
    selectedChars: countSchema,
    selectedFiles: countSchema,
    strata: z.array(
      z.object({ candidateFiles: countSchema, selectedFiles: countSchema, stratum: z.string().min(1) }).strict(),
    ),
    truncatedFiles: countSchema,
  })
  .strict() satisfies z.ZodType<JudgementSampleCoverage>;

/** One manifest row: every field, the coverage and the per-file receipts, nothing extra admitted. */
const manifestEntrySchema = z
  .object({
    contentHash: z.string().min(1),
    coverage: coverageSchema,
    fileCount: countSchema,
    label: z.string().min(1),
    selected: z.array(
      z
        .object({
          candidateChars: countSchema,
          contentHash: z.string().min(1),
          relativePath: z.string().min(1),
          selectedChars: countSchema,
          truncated: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict() satisfies z.ZodType<JudgementSourceManifestEntry>;

/** A whole source manifest. */
export const sourceManifestSchema = z.array(manifestEntrySchema);

/**
 * Parse a decoded value as a source manifest. The value returned is the schema's OWN copy, so a caller that
 * hashes it hashes exactly what was validated, never a re-read of the input (which an accessor could answer
 * differently). Pure.
 *
 * @param value the decoded manifest to check
 * @returns the validated copy, or one line per issue at its path
 */
export function parseSourceManifest({ value }: { value: unknown }): Result<readonly JudgementSourceManifestEntry[]> {
  const parsed = sourceManifestSchema.safeParse(value);
  return parsed.success
    ? ok(parsed.data)
    : err(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
}
