/**
 * Which re-render path one `slack edit --as bot` form belongs to, decided once off its `kind`.
 *
 * Every message kind `slack delete --as bot` accepts as this bot's own is re-rendered from ITS OWN form, by its
 * own renderer: a card from an `update`-family form, an answer from `kind: "answer"`, a turn checklist from
 * `kind: "checklist"` and a poll from `kind: "poll"`. Coercing one shape through another's renderer is not an
 * edit but a replacement with a different message under the same `ts`, so the kind picks the path and nothing
 * downstream re-decides it.
 *
 * A form that declares one of these kinds and does not validate reports ITS OWN violations here rather than
 * falling through to the update parser, which would report the far less useful "unrecognized keys" instead of
 * the field that is actually wrong. A form that is not JSON, or names no kind this file owns, is the card path's
 * to parse and report, so its error is worded once.
 */
import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type AnswerFormAnswer, answerFormSchema } from "../../../outbound/assistant/answerForm.js";
import {
  CHECKLIST_EDIT_KIND,
  type ChecklistEditForm,
  checklistEditFormSchema,
} from "../../../outbound/assistant/checklistEditForm.js";
import { slackDeliveryErrorLines } from "../../../outbound/slack/deliveryErrors.js";
import type { PollArtifact } from "../../../outbound/slack/pollForm.js";
import { parsePollForm } from "./pollCore.js";

/** The one path an edit form takes. `card` hands the raw text on to the card path's own parser. */
export type EditFormRoute =
  | { readonly kind: "card" }
  | { readonly kind: "answer"; readonly form: Result<AnswerFormAnswer> }
  | { readonly kind: "checklist"; readonly form: Result<ChecklistEditForm> }
  | { readonly kind: "poll"; readonly form: Result<PollArtifact> };

/** A zod issue list as the `path: message` lines every form refusal prints. */
function issueLines({ issues }: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }): string[] {
  return issues.map((issue) => {
    const where = issue.path.map(String).join(".");
    return where.length === 0 ? issue.message : `${where}: ${issue.message}`;
  });
}

/**
 * Route one edit form to the path that re-renders its kind.
 *
 * @param json the raw form text
 * @returns the route, carrying the validated form or its violations for every kind but the card
 */
export function routeEditForm({ json }: { json: string }): EditFormRoute {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { kind: "card" };
  }
  const kind = isRecord(raw) ? raw["kind"] : undefined;
  if (kind === "answer") {
    const parsed = answerFormSchema.safeParse(raw);
    return {
      form: parsed.success ? ok(parsed.data) : err(issueLines({ issues: parsed.error.issues })),
      kind: "answer",
    };
  }
  if (kind === CHECKLIST_EDIT_KIND) {
    const parsed = checklistEditFormSchema.safeParse(raw);
    return {
      form: parsed.success ? ok(parsed.data) : err(issueLines({ issues: parsed.error.issues })),
      kind: "checklist",
    };
  }
  if (kind === "poll") {
    return { form: parsePollForm({ json }).mapErr((error) => slackDeliveryErrorLines({ error })), kind: "poll" };
  }
  return { kind: "card" };
}
