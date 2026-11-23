/**
 * Parsing a render observation from JSON — the shape a Notion page reports about itself, and the seam that
 * survived the browser being taken away from this lane.
 *
 * Owner ruling (`docs/browser-route.md`; what it retired,
 * `docs/browser-route/screenshot-reading-and-retirement.md`): no verb here launches a browser. The measurement is
 * the same script it always was (`renderProbe.ts`'s `observationScript`), the judgement is the same pure
 * pass it always was (`renderFindings.ts`) — what changed is that the observation now ARRIVES as a document
 * rather than being read out of a page this process opened.
 *
 * That is why the schema moved out of the retired capture module and into a file of its own: it is the
 * contract between whoever ran the script and the verb that judges what it returned, so it has to be
 * readable without reading anything about browsers at all.
 */
import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";
import { strictForm } from "../strictForm.js";
import type { RenderObservation } from "./renderFindings.js";
import { type NotionVerifyError, NotionVerifyErrors } from "./verify.errors.js";

/**
 * The document `observationScript()` produces, validated field by field.
 *
 * `prose` is exact-optional because {@link RenderObservation} declares it optional so an older capture, taken
 * before text blocks were measured, still parses: absent stays absent rather than gaining `undefined` or `[]`.
 */
const OBSERVATION = strictForm({
  cells: z.array(
    strictForm({
      anchorHrefs: z.array(z.string()),
      anchorTexts: z.array(z.string()),
      column: z.number(),
      heightPx: z.number(),
      lineHeightPx: z.number(),
      row: z.number(),
      table: z.number(),
      text: z.string(),
    }),
  ),
  mermaid: z.array(
    strictForm({
      codeBlockIndex: z.number(),
      index: z.number(),
      mode: z.enum(["preview", "split", "code", "unknown"]),
    }),
  ),
  prose: z
    .array(
      strictForm({
        anchorHrefs: z.array(z.string()),
        anchorTexts: z.array(z.string()),
        index: z.number(),
        text: z.string(),
      }),
    )
    .exactOptional(),
});

/**
 * Parse an observation document.
 *
 * REFUSES rather than defaulting to an empty observation, and that is the difference between this and the
 * read it replaced. Reading the script's own return value inside a page that had already proved it rendered
 * made "nothing seen" a safe default — a clean page. A document handed in from outside has proved nothing,
 * so an empty or malformed one must not report a page with no problems.
 *
 * @param json the observation document
 * @param source named in the refusal, so a reader knows which file did not parse
 * @returns the observation, or why it cannot be judged
 */
export function parseObservation({
  json,
  source,
}: {
  json: string;
  source: string;
}): Result<RenderObservation, NotionVerifyError> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err(NotionVerifyErrors.observationUnreadable({ detail, path: source }));
  }
  const parsed = OBSERVATION.safeParse(raw);
  if (!parsed.success) {
    return err(
      NotionVerifyErrors.observationUnreadable({
        detail: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
        path: source,
      }),
    );
  }
  return ok(parsed.data);
}
