/** Turning a retrieved record into the sanctioned verb that re-reads the real object. */
import { describe, expect, it } from "vitest";
import type { CorpusRecord } from "../../../corpus/types.js";
import { recordReadPlan } from "../../../live/recordReadPlan.js";

function record(over: Partial<CorpusRecord> = {}): CorpusRecord {
  return {
    container: "acme/one",
    kind: "pr",
    refs: [],
    source: "github",
    sourceId: "#42",
    text: "alpha launch approved",
    tsIso: "2026-08-01T00:00:00.000Z",
    url: "https://github.com/acme/one/pull/42",
    ...over,
  };
}

describe("recordReadPlan", () => {
  it("turns a GitHub record into the sanctioned read verb, not a raw gh call", () => {
    const plan = recordReadPlan({ record: record() });

    expect(plan).toEqual({
      command: ["slopweaver", "github", "read", "https://github.com/acme/one/pull/42"],
      kind: "supported",
    });
  });

  it("re-reads a mail record by its SOURCE ID, because a Gmail permalink is a web-UI fragment", () => {
    const plan = recordReadPlan({
      record: record({
        container: "mail/personal",
        kind: "message",
        source: "gmail",
        sourceId: "1a04220420e73f78",
        url: "https://mail.google.com/mail/u/0/#all/1a04220420e73f78",
      }),
    });

    expect(plan).toEqual({
      command: ["slopweaver", "gmail", "read", "1a04220420e73f78"],
      kind: "supported",
    });
  });

  it("re-reads an Outlook event by its event id alone, stripped by the calendar it sits on, whatever the id holds", () => {
    const plan = recordReadPlan({
      record: record({
        container: "AQMk/cal==",
        kind: "event",
        source: "outlook-calendar",
        sourceId: "AQMk/cal==/AAMk/evt==",
        url: "https://outlook.live.com/calendar/item/FIXTURE",
      }),
    });

    expect(plan).toEqual({
      command: ["slopweaver", "outlook-calendar", "read", "AAMk/evt=="],
      kind: "supported",
    });
  });

  it("resolves a COMMENT url to its parent object, because the whole doc is what was asked for", () => {
    // The retriever ranks a fragment; the owner asked to "pull the entire doc with the Slopweaver verb".
    // The provider's own parser already does this, which is the reason this module delegates to it.
    const plan = recordReadPlan({
      record: record({ sourceId: "#42:comment:3", url: "https://github.com/acme/one/pull/42#issuecomment-9" }),
    });

    expect(plan.kind).toBe("supported");
  });

  it("re-reads a chatgpt message through the one-named-chat read, addressed by its conversation id", () => {
    const plan = recordReadPlan({
      record: record({
        attrs: { conversationId: "a0000099-0000-4000-8000-000000000106" },
        container: "chatgpt/conversations",
        kind: "message",
        source: "chatgpt",
        sourceId: "a0000099-0000-4000-8000-000000000106:a-r1",
        url: "https://chatgpt.com/c/a0000099-0000-4000-8000-000000000106",
      }),
    });

    expect(plan).toEqual({
      command: ["slopweaver", "chatgpt", "conversation", "a0000099-0000-4000-8000-000000000106"],
      kind: "supported",
    });
  });

  it("plans no read for a chatgpt record whose conversation id the read would refuse", () => {
    const plan = recordReadPlan({
      record: record({ attrs: { conversationId: "not-a-uuid" }, kind: "message", source: "chatgpt", sourceId: "x:1" }),
    });

    expect(plan).toEqual({
      kind: "unsupported",
      reason: "chatgpt record x:1 carries no conversation id the conversation read accepts",
    });
  });

  it("reads a Slack record through read-thread, whose address IS the permalink", () => {
    const plan = recordReadPlan({
      record: record({
        container: "C0B5",
        kind: "message",
        source: "slack",
        sourceId: "C0B5:1783644763.016499",
        url: "https://acme.slack.com/archives/C0B5/p1783644763016499",
      }),
    });

    expect(plan).toEqual({
      command: ["slopweaver", "slack", "read-thread", "https://acme.slack.com/archives/C0B5/p1783644763016499"],
      kind: "supported",
    });
  });

  it("turns a Linear record into its read verb", () => {
    const plan = recordReadPlan({
      record: record({
        container: "CCCC",
        kind: "issue",
        source: "linear",
        sourceId: "CCCC-1462",
        url: "https://linear.app/acme/issue/CCCC-1462/migrate-mislabelled-purchases",
      }),
    });

    expect(plan).toEqual({
      command: [
        "slopweaver",
        "linear",
        "read",
        "https://linear.app/acme/issue/CCCC-1462/migrate-mislabelled-purchases",
      ],
      kind: "supported",
    });
  });

  it("turns a Notion record into its read verb", () => {
    const plan = recordReadPlan({
      record: record({
        container: "acme-wiki",
        kind: "page",
        source: "notion",
        sourceId: "0000000000000000000000000000a005",
        url: "https://www.notion.so/Ticket-breakdown-0000000000000000000000000000a005",
      }),
    });

    expect(plan.kind).toBe("supported");
    expect(plan.kind === "supported" ? plan.command.slice(0, 3) : []).toEqual(["slopweaver", "notion", "read"]);
  });

  it("refuses a gold digest with the reason, and points at what CAN be verified", () => {
    const plan = recordReadPlan({ record: record({ source: "gold", url: "gold://digest/1" }) });

    expect(plan.kind).toBe("unsupported");
    expect(plan.kind === "unsupported" ? plan.reason : "").toContain("verify the records it cites instead");
  });

  it("refuses a malformed provider url by REPORTING the provider's own refusal, never by guessing", () => {
    // The failure that matters: a plan must not promise a verification step that would then refuse. Because
    // the provider's parser decides, "the plan says supported" and "the verb will accept it" cannot drift.
    const plan = recordReadPlan({ record: record({ url: "https://github.com/acme/one" }) });

    expect(plan.kind).toBe("unsupported");
    expect(plan.kind === "unsupported" ? plan.reason.length : 0).toBeGreaterThan(0);
  });

  it("refuses a Slack record with no channel permalink rather than inventing one", () => {
    const plan = recordReadPlan({ record: record({ source: "slack", url: "https://acme.slack.com/team/U1" }) });

    expect(plan.kind).toBe("unsupported");
  });

  it("names `slopweaver` as argv[0] for every supported source, so nothing routes around the door", () => {
    const sources: readonly { source: CorpusRecord["source"]; url: string }[] = [
      { source: "github", url: "https://github.com/acme/one/pull/42" },
      { source: "slack", url: "https://acme.slack.com/archives/C0B5/p1783644763016499" },
    ];
    const commands = sources
      .map(({ source, url }) => recordReadPlan({ record: record({ source, url }) }))
      .flatMap((plan) => (plan.kind === "supported" ? [plan.command[0]] : []));

    expect(commands).toEqual(["slopweaver", "slopweaver"]);
  });
});
