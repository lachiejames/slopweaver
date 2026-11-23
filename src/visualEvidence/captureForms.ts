/**
 * The `--form` documents `browser terminal-shot` and `browser redact` read: strict, so a key nobody declared is
 * refused rather than dropped, and every path absolute, so a form means the same file wherever it is run from.
 *
 * Pure: the runs in `../cli/commands/browser/` read the file, call these, and act.
 */
import { isAbsolute } from "node:path";
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";
import { type VisualEvidenceError, VisualEvidenceErrors } from "./evidenceErrors.js";
import { pixelRectSchema } from "./frameText.js";
import type { PixelRect } from "./types.js";

const absolutePath = z.string().refine((value) => isAbsolute(value), { message: "must be an absolute path" });
const pngPath = absolutePath.refine((value) => value.endsWith(".png"), { message: "must end in .png" });

const terminalShotFormSchema = z
  .object({
    label: z.string().min(1).max(120),
    lines: z.object({ from: z.number().int().positive(), to: z.number().int().positive() }).strict().optional(),
    out: pngPath,
    textFile: absolutePath,
  })
  .strict();

const redactFormSchema = z.object({ out: pngPath, rects: z.array(pixelRectSchema).min(1), source: pngPath }).strict();

/** A parsed `browser terminal-shot` form. */
export interface TerminalShotForm {
  readonly textFile: string;
  readonly out: string;
  readonly label: string;
  readonly lines: { readonly from: number; readonly to: number } | undefined;
}

/** A parsed `browser redact` form. */
export interface RedactForm {
  readonly source: string;
  readonly out: string;
  readonly rects: readonly PixelRect[];
}

/** One line per schema issue, path first. */
function issueLines({ issues }: { issues: readonly z.core.$ZodIssue[] }): readonly string[] {
  return issues.map((issue) => {
    if (issue.path.length === 0) {
      return `the form: ${issue.message}`;
    }
    return `${issue.path.join(".")}: ${issue.message}`;
  });
}

/**
 * Parse a `browser terminal-shot` form.
 *
 * @param value the decoded JSON
 * @returns the form, or every problem with it
 */
export function parseTerminalShotForm({ value }: { value: unknown }): Result<TerminalShotForm, VisualEvidenceError> {
  const parsed = terminalShotFormSchema.safeParse(value);
  if (!parsed.success) {
    return err(VisualEvidenceErrors.terminalTextRefused({ reasons: issueLines({ issues: parsed.error.issues }) }));
  }
  const { label, lines, out, textFile } = parsed.data;
  return ok({ label, lines, out, textFile });
}

/**
 * Parse a `browser redact` form. The out path must differ from the source: redaction writes a NEW file.
 *
 * @param value the decoded JSON
 * @returns the form, or every problem with it
 */
export function parseRedactForm({ value }: { value: unknown }): Result<RedactForm, VisualEvidenceError> {
  const parsed = redactFormSchema.safeParse(value);
  if (!parsed.success) {
    return err(VisualEvidenceErrors.redactionRefused({ reasons: issueLines({ issues: parsed.error.issues }) }));
  }
  if (parsed.data.out === parsed.data.source) {
    return err(VisualEvidenceErrors.redactionRefused({ reasons: ["out must be a new file, never the source"] }));
  }
  return ok(parsed.data);
}
