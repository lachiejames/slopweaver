/**
 * The TODO block — a checklist that visibly advances, in the shape the reference agent actually posts.
 *
 * ## What was measured, and what it overturns
 *
 * The orchestration doc's central hypothesis was that the reference agent renders in **mrkdwn**, and that
 * this repo's `rich_text` decision would therefore have to be inverted. Reading the reference thread's
 * raw payload (`conversations.replies` — see
 * `docs/slack-agent-surface/measured-rendering-and-identities.md`) refutes that. One of its todo messages is,
 * verbatim:
 *
 *     blocks[0].type = "rich_text"          ← the checklist body, text runs with `style.code` spans
 *     blocks[1].type = "context"            ← block_id "cc_session_date_footer", ONE mrkdwn element:
 *                                             "_todos as of <!date^1785192578^{time} ({ago})|fallback time>_"
 *     blocks[2].type = "context"            ← the provenance footer (see ./footer.ts)
 *
 * So the body IS `rich_text` and the `<!date^…>` token IS available — because it lives in a `context`
 * block, in the same message, not in the `rich_text` one. The old decision stands; the doc's fear that
 * "the existing card schema, the fold behaviour and the spacing rules become dead" does not apply. This
 * is the structural trick this file is built on, and the ONE progress shape `src/outbound` has: the
 * mrkdwn-only feature goes in a `context` block beside the `rich_text` body.
 *
 * The trap that produced the wrong hypothesis is worth naming, because it is cheap to fall into again:
 * the message's top-level `text` fallback IS mrkdwn (`<url|label>`, backticks), so a reader who inspects
 * `text` rather than `blocks` concludes mrkdwn and is wrong.
 *
 * ## Why the epoch is a parameter
 *
 * `<!date^EPOCH^{time} ({ago})|fallback>` is rendered by the CLIENT, localised and relative. That is what
 * lets a posted checklist keep aging correctly with no further edits — the highest-value trick in the
 * reference transcript. Measured detail: in the reference message the token's epoch (1785192578) equals
 * `edited.ts`, so the stamp is "when the todos were last written", not "when the turn began". Nothing here
 * reads a clock, so a given input renders the same bytes forever and a frame is assertable to the character.
 *
 * ## Two renderings, one step list
 *
 * {@link renderTodoBlocks} is the reference shape above. {@link todoTaskChunks} projects the SAME steps
 * onto Slack's native `task_update` streaming chunks, which were also measured working (they arrive back
 * as `task_card` blocks and advance in place when re-sent under the same `id`).
 *
 * They are NOT interchangeable, and this repo has measured this TWICE with a contradiction between the
 * two runs — recorded honestly rather than quietly picking the newer one, because neither claim has been
 * re-verified since:
 *  1. One session recorded that a stream which had taken a `task_update` chunk refused a later
 *     `markdown_text` append with `streaming_mode_mismatch` (full detail in
 *     `docs/slack-agent-surface/todo-primitive-and-contract-facts.md`). A later session mixed `task_update`
 *     and `markdown_text` in the SAME stream live and it worked. Neither claim is treated as settled;
 *     production turn messages sidestep the question entirely by not streaming.
 *  2. `chat.stopStream` REWRITES every task that is not `complete` to `error` — `pending` and
 *     `in_progress` alike — confirmed live and unchanged across both measurements. So a native
 *     checklist cannot show remaining work once the turn ends: a turn that plans five steps and finishes
 *     three reads as two failures. Production checklists therefore use {@link renderTodoBlocks} in ordinary
 *     metadata-bearing post/update messages; the native chunk projection remains an explicitly exercised
 *     transport capability, not the production lifecycle.
 */
import type { ContextBlock, RichTextBlock } from "@slack/types";

import { escapeMrkdwn, typedTextElements } from "../slack/render.js";

/**
 * How far a step has got. Five states: four because the native chunk vocabulary has four and a checklist
 * that cannot say "this one broke" pushes the failure into prose, where it is skimmed past — and `blocked`,
 * which is the owner's own design and is emphatically NOT a fifth flavour of `failed`.
 *
 * `blocked` means the step is waiting on the owner and nothing is wrong. The card a colleague is watching
 * must not show a failure, or an inability to handle the request, or anything that makes the bot look
 * broken: the most honest framing is that this particular step is blocked on the owner. That is why it is
 * a state here rather than a `failed` step with kinder words on it: a glyph is read before a sentence, and
 * `✗` says the opposite of what is true no matter what follows it.
 */
export type TodoState = "pending" | "running" | "done" | "failed" | "blocked";

/**
 * Where a step renders. Absent is the OUTLINE — the checklist above the fold. `meter` is the one progress line
 * under the task label, drawn with no glyph; `loop` is a phase of the planning loop, drawn BELOW the Details
 * label so the story of the turn is one expand away and never competes with the outline (`AGENTS.md` rule 7).
 * A placement on the step rather than a second card type, so every writer and poster seam keeps carrying one
 * `TodoStep[]`.
 *
 * @internal
 */
export type TodoPlacement = "meter" | "loop";

/** One line of the checklist. `detail` is the clause after the em dash — what happened, not what is planned. */
export interface TodoStep {
  /** Stable across frames. It is what makes an advance an EDIT rather than a new line. */
  readonly id: string;
  readonly title: string;
  readonly state: TodoState;
  readonly detail?: string | undefined;
  /** Indented sub-lines under the step — the live step's latest finding and `now:` line, a phase's updates. */
  readonly children?: readonly string[] | undefined;
  readonly placement?: TodoPlacement | undefined;
}

/**
 * The line-leading glyph per state.
 *
 * `✓` and `✱` are measured — they are the two the reference transcript uses, for a completed and the
 * in-flight step. `◦` and `✗` are OURS: the reference never shows a not-yet-started or a failed step, so
 * inventing a glyph is the honest option and pretending it was measured is not.
 *
 * `⏳` is the owner's, asked for by name as the hourglass on the live progress card. It is the literal hourglass character rather than a `:hourglass_flowing_sand:` shortcode
 * because these lines land in a `rich_text` text run, where a shortcode renders as its own literal colons.
 */
const STATE_GLYPH: Readonly<Record<TodoState, string>> = {
  blocked: "⏳",
  done: "✓",
  failed: "✗",
  pending: "◦",
  running: "✱",
};

/**
 * The native `task_update` status each state maps to. Slack's vocabulary, so ours is a total mapping onto it.
 *
 * `blocked` maps to `in_progress`, and the two alternatives are both wrong in ways worth naming: `error`
 * paints the exact failure look the state exists to avoid, and `pending` says the step has not started when
 * it has started, run, and stopped one move short. `in_progress` is the honest one — the step is genuinely
 * still in flight, with a person rather than a process as the thing it is waiting on. Slack draws no
 * "waiting on someone" status, so the projection is lossier than {@link renderTodoBlocks}'s own glyph; that
 * is a property of the native vocabulary, and production checklists use the block renderer anyway.
 */
const STATE_TASK_STATUS: Readonly<Record<TodoState, "pending" | "in_progress" | "complete" | "error">> = {
  blocked: "in_progress",
  done: "complete",
  failed: "error",
  pending: "pending",
  running: "in_progress",
};

/**
 * The date footer's `block_id`, fixed rather than left to Slack.
 *
 * Slack assigns a random `block_id` when one is absent (the reference's other context block came back as
 * `ZDXU1`), and a random id changes on every edit. A stable id makes an edit idempotent and lets a later
 * read recognise its own footer, which is the same reason `../slack/types.ts` pins `metadata.event_type`.
 */
export const TODO_AS_OF_BLOCK_ID = "todos_as_of";

/** The separator between a step's title and its detail — measured off the reference transcript. */
const DETAIL_SEPARATOR = " — ";

/** What leads each sub-line under a step: an indent and a hook, so a child reads as belonging to the line above. */
const CHILD_PREFIX = "      ↳ ";

/** The heading over the loop section below the fold. */
export const LOOP_HEADING = "the loop so far";

/**
 * One checklist line: glyph, title, and the detail clause when there is one, then each child on its own
 * indented line. A `meter` step is drawn with no glyph — it is a reading of the whole turn, not a step in it.
 * Pure.
 *
 * NOT escaped, deliberately. This text lands in a `rich_text` text run, where markdown is inert and
 * `escapeMrkdwn` would emit visible backslashes — the inverse mistake to the one the status line makes.
 *
 * @param step the step to render
 * @returns the line or lines, with no trailing newline
 */
export function todoLine({ step }: { step: TodoStep }): string {
  const detail = step.detail;
  const tail = detail === undefined || detail.length === 0 ? "" : `${DETAIL_SEPARATOR}${detail}`;
  const lead = step.placement === "meter" ? "" : `${STATE_GLYPH[step.state]} `;
  const line = `${lead}${step.title}${tail}`;
  if (step.children === undefined) {
    return line;
  }
  return `${line}${step.children.map((child) => `\n${CHILD_PREFIX}${child}`).join("")}`;
}

/**
 * The steps that are the checklist itself — the meter and the outline, everything above the fold. Pure.
 *
 * @param steps every step of the frame
 * @returns the above-the-fold steps, meter first, in their own order otherwise
 */
export function aboveFoldSteps({ steps }: { steps: readonly TodoStep[] }): readonly TodoStep[] {
  return [
    ...steps.filter((step) => step.placement === "meter"),
    ...steps.filter((step) => step.placement === undefined),
  ];
}

/**
 * The loop section below the fold — its heading and one line per phase — or `undefined` when the frame carries
 * no phase, so a turn with nothing loop-shaped to show draws no empty section. Pure.
 *
 * @param steps every step of the frame
 * @returns the section's `rich_text` block, or `undefined`
 */
export function renderLoopBlock({ steps }: { steps: readonly TodoStep[] }): RichTextBlock | undefined {
  const phases = steps.filter((step) => step.placement === "loop");
  if (phases.length === 0) {
    return undefined;
  }
  const lines = phases.map((step) => todoLine({ step })).join("\n");
  return {
    elements: [
      {
        elements: [
          { style: { bold: true }, text: `${LOOP_HEADING}\n`, type: "text" },
          ...typedTextElements({ text: lines }),
        ],
        type: "rich_text_section",
      },
    ],
    type: "rich_text",
  };
}

/**
 * The `<!date^…>` footer text, `_italic_` exactly as the reference posts it. Pure.
 *
 * The fallback is what non-rendering surfaces (push notifications, search results, an export) show in
 * place of the token, so it is escaped — it is mrkdwn, and an unescaped `<` or `&` there corrupts the
 * whole element. The token itself is NOT escaped; escaping its angle brackets would stop it resolving.
 *
 * @param asOfEpochSeconds when the checklist was last written, in whole seconds
 * @param asOfFallback the literal text to show where the token cannot be rendered
 * @returns the mrkdwn footer text
 */
export function todoAsOfText({
  asOfEpochSeconds,
  asOfFallback,
}: {
  asOfEpochSeconds: number;
  asOfFallback: string;
}): string {
  const epoch = String(Math.max(0, Math.trunc(asOfEpochSeconds)));
  return `_todos as of <!date^${epoch}^{time} ({ago})|${escapeMrkdwn({ text: asOfFallback })}>_`;
}

/**
 * Render the checklist as the reference agent's two blocks: a `rich_text` body and the `context` date
 * footer. Deterministic — no clock is read.
 *
 * The lines are joined with embedded newlines inside ONE text run rather than split across runs or
 * blocks. Block structure creates no spacing in Slack (measured), so one run is both the same rendering
 * and byte-comparable in a test.
 *
 * An EMPTY step list still renders both blocks. A turn that has set up its checklist but completed
 * nothing has a real state to show, and dropping the body would make frame zero structurally different
 * from frame one — which is exactly the difference that makes an edit path diverge from a post path.
 *
 * Only the ABOVE-THE-FOLD steps render here, meter first ({@link aboveFoldSteps}); a `loop` phase is
 * {@link renderLoopBlock}'s, below the Details label.
 *
 * @param steps the checklist, in display order
 * @param asOfEpochSeconds when the checklist was last written, in whole seconds
 * @param asOfFallback the literal text to show where the date token cannot be rendered
 * @returns the body block and the date-footer block, in that order
 */
export function renderTodoBlocks({
  steps,
  asOfEpochSeconds,
  asOfFallback,
}: {
  steps: readonly TodoStep[];
  asOfEpochSeconds: number;
  asOfFallback: string;
}): readonly [RichTextBlock, ContextBlock] {
  const body: RichTextBlock = {
    elements: [
      {
        elements: [
          ...typedTextElements({
            text: aboveFoldSteps({ steps })
              .map((step) => todoLine({ step }))
              .join("\n"),
          }),
        ],
        type: "rich_text_section",
      },
    ],
    type: "rich_text",
  };
  const asOf: ContextBlock = {
    block_id: TODO_AS_OF_BLOCK_ID,
    elements: [{ text: todoAsOfText({ asOfEpochSeconds, asOfFallback }), type: "mrkdwn" }],
    type: "context",
  };
  return [body, asOf];
}

/** One native `task_update` streaming chunk — the exact object `chat.appendStream` takes in `chunks`. */
export interface TodoTaskChunk {
  readonly type: "task_update";
  readonly id: string;
  readonly title: string;
  readonly status: "pending" | "in_progress" | "complete" | "error";
  readonly details?: string | undefined;
}

/**
 * Project the same steps onto Slack's native `task_update` chunks. Pure.
 *
 * Measured behaviour worth relying on: re-sending a chunk under an `id` already in the stream UPDATES
 * that card rather than appending a second one, so advancing a step costs one chunk and no bookkeeping.
 * Slack echoes each chunk back as a `task_card` block whose `block_id` is `task-<id>` and whose `details`
 * has been widened from the plain string sent here into a nested `rich_text` block.
 *
 * `details` is omitted rather than sent as an empty string when a step has none. What Slack draws for an
 * empty `details` was not measured; omitting an optional field we have no value for is the conservative
 * reading either way, and it keeps the chunk byte-comparable with the no-detail case in a test.
 *
 * Only OUTLINE steps become chunks: a meter is a reading of the whole turn and a loop phase is history, and
 * neither is a task Slack could tick.
 *
 * @param steps the checklist, in display order
 * @returns one chunk per outline step, in the same order
 */
export function todoTaskChunks({ steps }: { steps: readonly TodoStep[] }): readonly TodoTaskChunk[] {
  return steps
    .filter((step) => step.placement === undefined)
    .map((step) => {
      const detail = step.detail;
      const base = {
        id: step.id,
        status: STATE_TASK_STATUS[step.state],
        title: step.title,
        type: "task_update",
      } as const;
      return detail === undefined || detail.length === 0 ? base : { ...base, details: detail };
    });
}
