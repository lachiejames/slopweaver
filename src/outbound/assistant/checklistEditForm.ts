/**
 * The `kind: "checklist"` form — what `slack edit --as bot` re-renders a turn CHECKLIST from.
 *
 * A checklist is the metadata-bearing frame `turn status` advances (`./turnMessage.ts`), and before this form
 * existed `slack delete` could take one down while `slack edit` refused it on its event type: the bot could
 * retract its own working card and could not correct a line on it. The form carries exactly what one frame is
 * rendered from — the task label, the steps and the model the footer names — and never the turn id, which the
 * edit INHERITS off the message it rewrites (`../../cli/commands/slack/lifecycleRunEditChecklist.ts`).
 *
 * The caps are `turn status`'s own (`../../live/turn/liveStatusCap.ts`): an outline of at most
 * {@link PLAN_STEPS_MAX} steps, a status line of at most {@link LIVE_STATUS_CAP} characters. An edit is a
 * correction of a card a session already drew, so it is held to the bounds that session was held to rather
 * than to looser ones of its own.
 */
import { z } from "zod";

import { LIVE_STATUS_CAP, PLAN_STEPS_MAX } from "../../live/turn/liveStatusCap.js";
import { strictForm } from "../strictForm.js";
import type { AuthoredProse } from "../voice/exactRules.js";
import { authoredProseOf } from "../voice/exactRules.js";
import type { TodoStep } from "./todoBlock.js";

/** The discriminant a checklist edit form carries. */
export const CHECKLIST_EDIT_KIND = "checklist";

/**
 * How many steps one frame may carry in all — outline, meter and loop together.
 *
 * The outline alone is capped at {@link PLAN_STEPS_MAX}; the loop below the fold grows with every re-plan, so
 * the whole list needs a bound of its own, and twenty is three re-plans of a full outline with room left over.
 */
const CHECKLIST_STEPS_MAX = 20;

/** How many indented sub-lines one step may carry. */
const CHECKLIST_CHILDREN_MAX = 6;

/** One line of the form, capped to a status line's own length; a line break would split one checklist row in two. */
const checklistLine = z
  .string()
  .trim()
  .min(1)
  .max(LIVE_STATUS_CAP)
  .refine((line) => !/[\r\n]/u.test(line), { message: "one line only: a line break would split one checklist row" });

const checklistStepSchema = strictForm({
  children: z.array(checklistLine).max(CHECKLIST_CHILDREN_MAX).optional(),
  detail: checklistLine.optional(),
  id: z.string().trim().min(1).max(80),
  placement: z.enum(["meter", "loop"]).optional(),
  state: z.enum(["pending", "running", "done", "failed", "blocked"]),
  title: checklistLine,
});

/** A validated checklist edit form. */
export interface ChecklistEditForm {
  readonly kind: typeof CHECKLIST_EDIT_KIND;
  readonly task: string;
  readonly modelId: string;
  readonly steps: readonly TodoStep[];
}

/** The strict schema a checklist edit form is parsed against. */
export const checklistEditFormSchema = strictForm({
  kind: z.literal(CHECKLIST_EDIT_KIND),
  modelId: z.string().trim().min(1).max(80),
  steps: z.array(checklistStepSchema).min(1).max(CHECKLIST_STEPS_MAX),
  task: checklistLine,
})
  .refine((form) => form.steps.filter((step) => step.placement === undefined).length <= PLAN_STEPS_MAX, {
    message: `at most ${String(PLAN_STEPS_MAX)} outline steps (a step with no placement), as \`turn status --plan\` allows`,
    path: ["steps"],
  })
  .refine((form) => new Set(form.steps.map((step) => step.id)).size === form.steps.length, {
    message: "every step id must be unique: an id is what makes a later advance an edit of the same line",
    path: ["steps"],
  });

/**
 * Every prose region of a checklist form the exact voice rules may inspect, each naming the field it came from.
 *
 * @param form the validated checklist form
 * @returns the task label, then every step's title, detail and child lines, in display order
 */
export function checklistProse({ form }: { form: ChecklistEditForm }): readonly AuthoredProse[] {
  return [
    ...authoredProseOf({ path: "task", text: form.task }),
    ...form.steps.flatMap(({ title, detail, children = [] }, index) => [
      ...authoredProseOf({ path: `steps[${String(index)}].title`, text: title }),
      ...(detail === undefined ? [] : authoredProseOf({ path: `steps[${String(index)}].detail`, text: detail })),
      ...children.flatMap((child, childIndex) =>
        authoredProseOf({ path: `steps[${String(index)}].children[${String(childIndex)}]`, text: child }),
      ),
    ]),
  ];
}
