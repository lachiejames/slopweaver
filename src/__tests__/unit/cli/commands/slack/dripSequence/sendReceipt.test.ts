/*
 * `runDripSequence`'s send receipt: a permalink from the workspace url, the render issues a reader will see, and a
 * read-back that throws or finds nothing failing open, the message still sent.
 */
import { describe, expect, it } from "vitest";
import { runDripSequence } from "../../../../../../cli/commands/slack/dripRun.js";
import { deps, freshHome, plan, recorder, useFreshHomes } from "./harness.js";

useFreshHomes();

describe("runDripSequence — the send receipt", () => {
  /** One stored `rich_text` message carrying exactly this text, as `readBack` would return it. */
  function storedText({ text }: { text: string }) {
    return {
      blocks: [{ elements: [{ elements: [{ text, type: "text" }], type: "rich_text_section" }], type: "rich_text" }],
      workspaceUrl: "https://example.slack.com",
    };
  }

  it("carries a permalink built from the workspace url, so a send hands back a link", async () => {
    const home = freshHome();
    const outcomes = await runDripSequence({
      deps: deps({ api: recorder().api, home, readBack: async () => storedText({ text: "clean" }) }),
      plan: plan({ texts: ["clean"] }),
      resend: { landed: false, unconfirmed: false },
    });

    const sent = outcomes[0]!;
    expect(sent.state).toBe("sent");
    expect(sent.state === "sent" ? sent.permalink : undefined).toBe(
      "https://example.slack.com/archives/C1/p1700000001000100",
    );
  });

  it("reports a CLEAN render as an empty list, which is different from not having checked", async () => {
    const home = freshHome();
    const outcomes = await runDripSequence({
      deps: deps({ api: recorder().api, home, readBack: async () => storedText({ text: "clean" }) }),
      plan: plan({ texts: ["clean"] }),
      resend: { landed: false, unconfirmed: false },
    });

    expect(outcomes[0]!.state === "sent" ? outcomes[0]!.renderIssues : undefined).toEqual([]);
  });

  it("reports what a reader will actually see wrong in a message that is already published", async () => {
    const home = freshHome();
    const outcomes = await runDripSequence({
      deps: deps({ api: recorder().api, home, readBack: async () => storedText({ text: "@ada-example look" }) }),
      plan: plan({ texts: ["mention"] }),
      resend: { landed: false, unconfirmed: false },
    });

    const issues = outcomes[0]!.state === "sent" ? outcomes[0]!.renderIssues : undefined;
    expect(issues?.length).toBe(1);
    expect(issues?.[0]).toContain("nobody is notified by it");
  });

  it("FAILS OPEN on a read-back that throws — the message is published, so the send still SENT", async () => {
    const home = freshHome();
    const outcomes = await runDripSequence({
      deps: deps({
        api: recorder().api,
        home,
        readBack: async () => {
          throw new Error("conversations.history said no");
        },
      }),
      plan: plan({ texts: ["clean"] }),
      resend: { landed: false, unconfirmed: false },
    });

    expect(outcomes[0]!.state).toBe("sent");
    expect(outcomes[0]!.state === "sent" ? outcomes[0]!.renderIssues : "x").toBe(undefined);
    expect(outcomes[0]!.state === "sent" ? outcomes[0]!.permalink : "x").toBe(undefined);
  });

  it("FAILS OPEN the same way when the read-back simply finds nothing", async () => {
    const home = freshHome();
    const outcomes = await runDripSequence({
      deps: deps({ api: recorder().api, home, readBack: async () => undefined }),
      plan: plan({ texts: ["clean"] }),
      resend: { landed: false, unconfirmed: false },
    });

    expect(outcomes[0]!.state).toBe("sent");
    expect(outcomes[0]!.state === "sent" ? outcomes[0]!.renderIssues : "x").toBe(undefined);
  });
});
