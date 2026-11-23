import type { ContextBlock, RichTextBlock } from "@slack/types";
import { describe, expect, it } from "vitest";

import {
  aboveFoldSteps,
  LOOP_HEADING,
  renderLoopBlock,
  renderTodoBlocks,
  TODO_AS_OF_BLOCK_ID,
  type TodoStep,
  todoAsOfText,
  todoLine,
  todoTaskChunks,
} from "../../../../outbound/assistant/todoBlock.js";

/**
 * The epoch off the reference thread's own date token (`<!date^1785192578^…>`), which measurably equals
 * that message's `edited.ts`. Fixed here so every assertion below is byte-exact.
 */
const AS_OF = 1_785_192_578;
const FALLBACK = "10:49pm UTC";

const step = ({
  state,
  detail,
  id = "s1",
  title = "Measure the reference thread",
}: Partial<TodoStep> & Pick<TodoStep, "state">): TodoStep => ({
  id,
  state,
  title,
  ...(detail === undefined ? {} : { detail }),
});

/** The single text run the body collapses to — the whole checklist, newline-joined. */
function bodyText({ block }: { block: RichTextBlock }): string {
  const section = block.elements[0]!;
  if (section.type !== "rich_text_section") {
    throw new Error(`expected a rich_text_section, got ${section.type}`);
  }
  const run = section.elements[0]!;
  if (run.type !== "text") {
    throw new Error(`expected a text run, got ${run.type}`);
  }
  return run.text;
}

describe("todoLine", () => {
  it("prefixes each state with its glyph", () => {
    expect(todoLine({ step: step({ state: "done" }) })).toBe("✓ Measure the reference thread");
    expect(todoLine({ step: step({ state: "running" }) })).toBe("✱ Measure the reference thread");
    expect(todoLine({ step: step({ state: "pending" }) })).toBe("◦ Measure the reference thread");
    expect(todoLine({ step: step({ state: "failed" }) })).toBe("✗ Measure the reference thread");
  });

  it("appends a detail after an em dash", () => {
    expect(todoLine({ step: step({ detail: "14 messages read raw", state: "done" }) })).toBe(
      "✓ Measure the reference thread — 14 messages read raw",
    );
  });

  it("appends nothing for an EMPTY detail, so no line ends in a bare dash", () => {
    expect(todoLine({ step: step({ detail: "", state: "done" }) })).toBe("✓ Measure the reference thread");
  });

  it("does NOT escape mrkdwn — the line lands in rich_text, where an escape would be visible", () => {
    expect(todoLine({ step: step({ state: "done", title: "diffed <a> & <b>" }) })).toBe("✓ diffed <a> & <b>");
  });

  it("draws each child on its own indented line under the step", () => {
    expect(
      todoLine({ step: { children: ["found it", "now: reading"], id: "p", state: "running", title: "Look" } }),
    ).toBe("✱ Look\n      ↳ found it\n      ↳ now: reading");
  });

  it("draws a meter with no glyph — it reads the whole turn, it is not a step in it", () => {
    expect(todoLine({ step: { id: "meter", placement: "meter", state: "running", title: "▰▱ step 2 of 2" } })).toBe(
      "▰▱ step 2 of 2",
    );
  });
});

describe("aboveFoldSteps", () => {
  it("puts the meter first, keeps the outline in order, and leaves every loop phase below the fold", () => {
    const steps: readonly TodoStep[] = [
      step({ id: "a", state: "done" }),
      { id: "loop-0", placement: "loop", state: "done", title: "planned" },
      { id: "meter", placement: "meter", state: "running", title: "m" },
      step({ id: "b", state: "running" }),
    ];
    expect(aboveFoldSteps({ steps }).map((entry) => entry.id)).toEqual(["meter", "a", "b"]);
  });
});

describe("renderLoopBlock", () => {
  it("draws no section for a frame with no loop phase", () => {
    expect(renderLoopBlock({ steps: [step({ state: "running" })] })).toBe(undefined);
  });

  it("heads the phases and draws each with its updates", () => {
    expect(
      renderLoopBlock({
        steps: [{ children: ["u1"], id: "loop-0", placement: "loop", state: "running", title: "started" }],
      }),
    ).toEqual({
      elements: [
        {
          elements: [
            { style: { bold: true }, text: `${LOOP_HEADING}\n`, type: "text" },
            { text: "✱ started\n      ↳ u1", type: "text" },
          ],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    });
  });
});

describe("todoAsOfText", () => {
  it("reproduces the reference token byte for byte", () => {
    expect(todoAsOfText({ asOfEpochSeconds: AS_OF, asOfFallback: FALLBACK })).toBe(
      "_todos as of <!date^1785192578^{time} ({ago})|10:49pm UTC>_",
    );
  });

  it("escapes the FALLBACK, which is mrkdwn, while leaving the token's own brackets alone", () => {
    expect(todoAsOfText({ asOfEpochSeconds: AS_OF, asOfFallback: "1:00am <UTC> & later" })).toBe(
      "_todos as of <!date^1785192578^{time} ({ago})|1:00am &lt;UTC&gt; &amp; later>_",
    );
  });

  it("truncates a fractional epoch to whole seconds — Slack's token takes an integer", () => {
    expect(todoAsOfText({ asOfEpochSeconds: 1_785_192_578.94, asOfFallback: FALLBACK })).toBe(
      "_todos as of <!date^1785192578^{time} ({ago})|10:49pm UTC>_",
    );
  });

  it("clamps a negative epoch to zero rather than emitting a token Slack cannot parse", () => {
    expect(todoAsOfText({ asOfEpochSeconds: -5, asOfFallback: FALLBACK })).toBe(
      "_todos as of <!date^0^{time} ({ago})|10:49pm UTC>_",
    );
  });
});

describe("renderTodoBlocks", () => {
  it("emits the reference's two blocks, in order: rich_text body then the context date footer", () => {
    const [body, asOf] = renderTodoBlocks({
      asOfEpochSeconds: AS_OF,
      asOfFallback: FALLBACK,
      steps: [step({ state: "done" })],
    });
    expect(body.type).toBe("rich_text");
    expect(asOf.type).toBe("context");
  });

  it("joins every step into ONE text run with embedded newlines", () => {
    const [body] = renderTodoBlocks({
      asOfEpochSeconds: AS_OF,
      asOfFallback: FALLBACK,
      steps: [
        step({ detail: "14 messages read raw", id: "a", state: "done", title: "Measure the reference thread" }),
        step({ id: "b", state: "running", title: "Probe the assistant methods" }),
        step({ id: "c", state: "pending", title: "Write the design note" }),
      ],
    });
    expect(body.elements.length).toBe(1);
    expect(bodyText({ block: body })).toBe(
      "✓ Measure the reference thread — 14 messages read raw\n✱ Probe the assistant methods\n◦ Write the design note",
    );
  });

  it("renders the body as exactly one rich_text_section holding one text element", () => {
    const [body] = renderTodoBlocks({
      asOfEpochSeconds: AS_OF,
      asOfFallback: FALLBACK,
      steps: [step({ state: "done" })],
    });
    expect(body).toEqual({
      elements: [{ elements: [{ text: "✓ Measure the reference thread", type: "text" }], type: "rich_text_section" }],
      type: "rich_text",
    } satisfies RichTextBlock);
  });

  it("pins the date footer's block_id so an edit is idempotent", () => {
    const [, asOf] = renderTodoBlocks({ asOfEpochSeconds: AS_OF, asOfFallback: FALLBACK, steps: [] });
    expect(asOf).toEqual({
      block_id: TODO_AS_OF_BLOCK_ID,
      elements: [{ text: "_todos as of <!date^1785192578^{time} ({ago})|10:49pm UTC>_", type: "mrkdwn" }],
      type: "context",
    } satisfies ContextBlock);
    expect(TODO_AS_OF_BLOCK_ID).toBe("todos_as_of");
  });

  it("still emits BOTH blocks for an empty checklist, so frame zero has the shape of frame one", () => {
    const blocks = renderTodoBlocks({ asOfEpochSeconds: AS_OF, asOfFallback: FALLBACK, steps: [] });
    expect(blocks.length).toBe(2);
    expect(bodyText({ block: blocks[0] })).toBe("");
  });

  it("is deterministic — the same steps render the same bytes, so a no-op edit is detectable", () => {
    const steps = [step({ state: "done" }), step({ id: "b", state: "running", title: "Probe" })];
    const first = renderTodoBlocks({ asOfEpochSeconds: AS_OF, asOfFallback: FALLBACK, steps });
    const second = renderTodoBlocks({ asOfEpochSeconds: AS_OF, asOfFallback: FALLBACK, steps });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("changes only the footer when the stamp advances and the steps do not", () => {
    const steps = [step({ state: "done" })];
    const before = renderTodoBlocks({ asOfEpochSeconds: AS_OF, asOfFallback: FALLBACK, steps });
    const after = renderTodoBlocks({ asOfEpochSeconds: AS_OF + 60, asOfFallback: "10:50pm UTC", steps });
    expect(JSON.stringify(before[0])).toBe(JSON.stringify(after[0]));
    expect(after[1].elements[0]).toEqual({
      text: "_todos as of <!date^1785192638^{time} ({ago})|10:50pm UTC>_",
      type: "mrkdwn",
    });
  });
});

describe("todoTaskChunks", () => {
  it("maps every state onto Slack's own four-value vocabulary", () => {
    expect(
      todoTaskChunks({
        steps: [
          step({ id: "a", state: "pending" }),
          step({ id: "b", state: "running" }),
          step({ id: "c", state: "done" }),
          step({ id: "d", state: "failed" }),
        ],
      }).map((chunk) => chunk.status),
    ).toEqual(["pending", "in_progress", "complete", "error"]);
  });

  it("emits the exact chunk object chat.appendStream takes, preserving the id that makes an advance an edit", () => {
    expect(
      todoTaskChunks({ steps: [step({ detail: "2 of 4 refused", id: "t2", state: "done", title: "Probe" })] }),
    ).toEqual([{ details: "2 of 4 refused", id: "t2", status: "complete", title: "Probe", type: "task_update" }]);
  });

  it("OMITS details rather than sending an empty string, which would draw an empty detail row", () => {
    const [chunk] = todoTaskChunks({ steps: [step({ detail: "", id: "t1", state: "running" })] });
    expect(chunk).toEqual({
      id: "t1",
      status: "in_progress",
      title: "Measure the reference thread",
      type: "task_update",
    });
  });

  it("preserves order and arity", () => {
    const chunks = todoTaskChunks({
      steps: [step({ id: "a", state: "done" }), step({ id: "b", state: "pending" })],
    });
    expect(chunks.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("returns nothing for an empty checklist", () => {
    expect(todoTaskChunks({ steps: [] })).toEqual([]);
  });

  it("projects only the outline — a meter and a loop phase are not tasks Slack could tick", () => {
    const chunks = todoTaskChunks({
      steps: [
        { id: "meter", placement: "meter", state: "running", title: "m" },
        step({ id: "a", state: "running" }),
        { id: "loop-0", placement: "loop", state: "done", title: "planned" },
      ],
    });
    expect(chunks.map((c) => c.id)).toEqual(["a"]);
  });
});
