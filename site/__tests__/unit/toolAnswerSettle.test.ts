/*
 * One answered tool call's end (`toolAnswerSettle.ts`), driven through plain fake functions (seams, not mocks). Each call keeps every tool's answer — the exact text the model was handed — and
 * keeping it never sits on the answer's path. So nothing is journalled until the delivery settled, the answer kept is
 * the output exactly (an image only as the fixed stand-in) while the row folds it indented, and it goes to the call
 * the tool BEGAN on.
 */
import type { ResponseFunctionCallOutputItemList } from "openai/resources/responses/responses";
import { describe, expect, it } from "vitest";

import { IMAGE_TOOL_ANSWER } from "../../components/live/talkSession";
import { settleToolAnswer } from "../../components/voice/toolAnswerSettle";
import type { ToolLine } from "../../components/voice/voiceContext";
import { PICTURE_OUTPUT } from "../../lib/voiceSessionView";

const CALL = "a0000041-0000-4000-8000-000000000044";
const PLAN = { callId: "plan-1", claimant: "page-1" };
const LINK = "https://acme.slack.com/archives/C0SYNPLATFORM/p1759813000000100";
const ANSWER = { answer: 'ABC-1 is "Done" \\ shipped' };
const OUTPUT = JSON.stringify(ANSWER);
/** What the tray folds for `OUTPUT`: the same JSON, indented — so not what the model was handed byte for byte. */
const SHOWN = { input: "{}", output: JSON.stringify(ANSWER, null, 2) };
const LOST = "the answer was lost: 502; the call was told the tool could not run";
const TOOL = {
  detail: "read ABC-1",
  knowledge: undefined,
  ms: 42,
  name: "code_read",
  rawArguments: "{}",
  refused: false,
  turnId: "turn-1",
};
const READ_ARGS = JSON.stringify({ url: LINK });

/** Everything the seams saw, in the order they saw it. */
type Seen =
  | { readonly kind: "deliver"; readonly input: unknown }
  | { readonly kind: "note"; readonly line: ToolLine }
  | {
      readonly kind: "settle";
      readonly input: {
        call: string | undefined;
        line: ToolLine;
        answer: string;
        drawn: boolean;
        turnId: string | undefined;
      };
    };

/** A settle over fakes whose delivery the test releases, and the record of what each seam was told. */
function harness({
  output = OUTPUT,
  noPlan = false,
  tool = TOOL,
  live = true,
}: {
  output?: string | ResponseFunctionCallOutputItemList;
  noPlan?: boolean;
  tool?: typeof TOOL;
  live?: boolean;
}): { seen: Seen[]; release: (input: { why: string | undefined }) => void; settled: Promise<string | undefined> } {
  const seen: Seen[] = [];
  const releases: ((why: string | undefined) => void)[] = [];
  let plan: typeof PLAN | undefined = PLAN;
  if (noPlan) {
    plan = undefined;
  }
  const settled = settleToolAnswer({
    call: CALL,
    deliver: (input) => {
      seen.push({ input, kind: "deliver" });
      return new Promise<string | undefined>((resolve) => {
        releases.push(resolve);
      });
    },
    delivery: { token: "tok-1" },
    live: () => live,
    note: ({ line }) => {
      seen.push({ kind: "note", line });
    },
    output,
    plan,
    settle: (input) => {
      seen.push({ input, kind: "settle" });
    },
    tool,
  });
  return {
    release: ({ why }) => {
      releases[0](why);
    },
    seen,
    settled,
  };
}

describe("settleToolAnswer", () => {
  it("journals nothing while the answer is being delivered, then the exact output on the call the tool began on", async () => {
    const { release, seen, settled } = harness({});
    expect(seen).toEqual([
      { input: { held: PLAN, output: OUTPUT, refused: false, token: "tok-1", tool: "code_read" }, kind: "deliver" },
    ]);
    release({ why: undefined });
    expect(await settled).toBe(undefined);
    expect(seen.slice(1)).toEqual([
      {
        input: {
          answer: OUTPUT,
          call: CALL,
          drawn: true,
          line: { detail: "read ABC-1", ms: 42, name: "code_read", refused: false, shown: SHOWN, usage: undefined },
          // The turn that called it, so `talk fidelity` reads a message against its own turn's answers.
          turnId: "turn-1",
        },
        kind: "settle",
      },
    ]);
  });

  it("keeps the exact output on the file while the row folds it indented", async () => {
    const { release, seen, settled } = harness({});
    release({ why: undefined });
    await settled;
    const settle = seen[1] as Extract<Seen, { kind: "settle" }>;
    expect(settle.input.answer).toBe('{"answer":"ABC-1 is \\"Done\\" \\\\ shipped"}');
    expect(settle.input.line.shown).toEqual({
      input: "{}",
      output: '{\n  "answer": "ABC-1 is \\"Done\\" \\\\ shipped"\n}',
    });
  });

  it("keeps the payload a lost delivery attempted, beside the line saying it was lost", async () => {
    const { release, seen, settled } = harness({});
    release({ why: LOST });
    expect(await settled).toBe(LOST);
    expect(seen.slice(1).map((entry) => entry.kind)).toEqual(["settle", "note"]);
    expect(seen[1]).toEqual({
      input: {
        answer: OUTPUT,
        call: CALL,
        drawn: true,
        line: { detail: "read ABC-1", ms: 42, name: "code_read", refused: false, shown: SHOWN, usage: undefined },
        turnId: "turn-1",
      },
      kind: "settle",
    });
    expect(seen[2]).toEqual({
      kind: "note",
      line: { detail: LOST, ms: undefined, name: "code_read", refused: true, usage: undefined },
    });
  });

  it("keeps an image answer only as the fixed stand-in", async () => {
    const image: ResponseFunctionCallOutputItemList = [
      { detail: "auto", image_url: "data:image/png;base64,QUJD", type: "input_image" },
    ];
    const { release, seen, settled } = harness({ output: image });
    release({ why: undefined });
    await settled;
    expect(seen[1]).toEqual({
      input: {
        answer: IMAGE_TOOL_ANSWER,
        call: CALL,
        drawn: true,
        line: {
          detail: "read ABC-1",
          ms: 42,
          name: "code_read",
          refused: false,
          shown: { input: "{}", output: PICTURE_OUTPUT },
          usage: undefined,
        },
        turnId: "turn-1",
      },
      kind: "settle",
    });
  });

  it("still journals the answer once the session that ran it has stopped, and draws nothing on the page", async () => {
    const read = { ...TOOL, name: "slack_thread_after", rawArguments: READ_ARGS };
    const { release, seen, settled } = harness({ live: false, tool: read });
    release({ why: undefined });
    await settled;
    expect(seen.slice(1)).toEqual([
      {
        input: {
          answer: OUTPUT,
          call: CALL,
          drawn: false,
          line: {
            detail: "read ABC-1",
            ms: 42,
            name: "slack_thread_after",
            opened: null,
            refused: false,
            shown: { input: JSON.stringify({ url: LINK }, null, 2), output: SHOWN.output },
            usage: undefined,
          },
          turnId: "turn-1",
        },
        kind: "settle",
      },
    ]);
  });

  it("names a delegated read's link on the settled line once the plan thread took it, after the answer", async () => {
    const read = { ...TOOL, name: "slack_thread_after", rawArguments: READ_ARGS };
    const { release, seen, settled } = harness({ tool: read });
    release({ why: undefined });
    await settled;
    expect(seen.slice(1).map((entry) => entry.kind)).toEqual(["settle", "note"]);
    expect(seen[2]).toEqual({
      kind: "note",
      line: {
        detail: "the plan thread took the answer",
        ms: undefined,
        name: "slack_thread_after",
        opened: LINK,
        refused: false,
        usage: undefined,
      },
    });
  });

  it("with no plan call hands nothing over and draws the row with no answer, since no model read it", async () => {
    const { seen, settled } = harness({ noPlan: true });
    expect(await settled).toBe(undefined);
    expect(seen).toEqual([
      {
        kind: "note",
        line: { detail: "read ABC-1", ms: 42, name: "code_read", refused: false, shown: SHOWN, usage: undefined },
      },
    ]);
  });
});
