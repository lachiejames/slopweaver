/*
 * When a typed conversation was last active, which says whether the desktop test instance's call may run beside it
 * (`site/lib/talkArbiter.ts` `typedAtRest`): an open, every press, and its own thread's turn notices and writing move it,
 * and another thread's never does.
 */
import { describe, expect, it } from "vitest";

import { accepting, COMPOSITION, delta, harness, line, opened, started } from "./talkTypedSessionHarness";

describe("TypedPlanSession.activityMs", () => {
  it("starts at the conversation's making and moves to the open", async () => {
    const h = harness({ script: accepting() });
    const made = h.session.activityMs;
    h.clock.advance({ ms: 7 });
    await h.session.openTyped({ composition: COMPOSITION });
    expect([made, h.session.activityMs]).toEqual([0, 7]);
  });

  it("moves on every press, a refused or blank one included", async () => {
    const h = await opened();
    h.clock.advance({ ms: 5 });
    await h.session.say({ messageId: "m-1", text: "  " });
    const blank = h.session.activityMs;
    h.clock.advance({ ms: 5 });
    await h.session.say({ messageId: "m-2", text: "one" });
    expect([blank, h.session.activityMs]).toEqual([5, 10]);
  });

  it("moves on its own thread's turn notice and written answer, never on another thread's", async () => {
    const h = await opened();
    h.clock.advance({ ms: 3 });
    h.session.receive({
      chunk: line({
        method: "turn/started",
        params: { threadId: "thread-2", turn: { id: "t-9", items: [], status: "inProgress" } },
      }),
    });
    h.session.receive({ chunk: delta({ text: "elsewhere", threadId: "thread-2" }) });
    const other = h.session.activityMs;
    h.session.receive({ chunk: started({ turnId: "t-1" }) });
    const notice = h.session.activityMs;
    h.clock.advance({ ms: 4 });
    h.session.receive({ chunk: delta({ text: "hello" }) });
    expect([other, notice, h.session.activityMs]).toEqual([0, 3, 7]);
  });
});
