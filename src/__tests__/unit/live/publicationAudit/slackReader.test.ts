import { describe, expect, it } from "vitest";

import { err, ok, type Result } from "../../../../lib/result.js";
import {
  readSlackPublications,
  SLACK_PUBLICATION_GAPS,
  type SlackMessageRead,
  type SlackMessageReadFailedError,
  type SlackPlacementInventory,
  type SlackPublicationApi,
  SlackPublicationReadErrors,
  type SlackPublicationSeam,
  slackMessagePermalink,
  slackPublicationSeam,
} from "../../../../live/publicationAudit/slackReader.js";
import type { PlacementJournalRow } from "../../../../live/slack/placementJournal.js";

const WORKSPACE = "https://acme.slack.com/";

/** One settled placement row at a final coordinate. */
const settled = ({
  channel,
  ts,
  threadRoot,
  outcome = "verified",
}: {
  channel: string;
  ts: string;
  threadRoot?: string;
  outcome?: "verified" | "held" | "moved";
}): PlacementJournalRow => ({
  final: { channel, ts },
  intended: { channel },
  kind: "placement-settled",
  outcome,
  schemaVersion: 1,
  surface: "postMessage",
  threadRoot,
  tsIso: "2026-11-20T00:00:00.000Z",
});

const inventoryOf = ({ rows }: { rows: readonly PlacementJournalRow[] }): SlackPlacementInventory => ({
  readFailure: undefined,
  rows,
  unreadable: [],
});

/** A seam answering from a table keyed `channel ts`; a missing key is absent. */
const seamOf = ({
  messages,
  failing = [],
}: {
  messages: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  failing?: readonly string[];
}): SlackPublicationSeam & { readonly asked: string[] } => {
  const asked: string[] = [];
  const readMessage: SlackPublicationSeam["readMessage"] = async ({ channel, ts }) => {
    const key = `${channel} ${ts}`;
    asked.push(key);
    if (failing.includes(key)) {
      return err(SlackPublicationReadErrors.readFailed());
    }
    const message = messages[key];
    const read: SlackMessageRead = message === undefined ? { kind: "absent" } : { kind: "found", message };
    return ok(read);
  };
  return { asked, readMessage, workspaceUrl: async () => WORKSPACE };
};

describe("readSlackPublications", () => {
  it("judges the fleet's own message text and block prose under fixed fields, linked by permalink", async () => {
    const read = await readSlackPublications({
      botOnly: false,
      inventory: inventoryOf({ rows: [settled({ channel: "C1", ts: "1700000000.000100" })] }),
      seam: seamOf({
        messages: {
          "C1 1700000000.000100": {
            blocks: [{ text: { text: "block prose only", type: "mrkdwn" }, type: "section" }],
            text: "posted words",
            ts: "1700000000.000100",
          },
        },
      }),
    });
    expect(read.texts.map((text) => [text.field, text.text])).toEqual([
      ["text", "posted words"],
      ["blocks", "block prose only"],
    ]);
    expect(read.texts[0]!.link).toBe("https://acme.slack.com/archives/C1/p1700000000000100");
    expect(read.texts[0]!.linkCarriesNoText).toBe(false);
    expect(read.coverage).toEqual({
      attachmentsNotSwept: 0,
      door: "slack",
      gaps: [],
      objects: 1,
      state: "complete",
      texts: 2,
    });
  });

  it("reads each final coordinate once, however many rows settled there", async () => {
    const seam = seamOf({ messages: { "C1 1.1": { text: "x", ts: "1.1" } } });
    await readSlackPublications({
      botOnly: false,
      inventory: inventoryOf({ rows: [settled({ channel: "C1", ts: "1.1" }), settled({ channel: "C1", ts: "1.1" })] }),
      seam,
    });
    expect(seam.asked).toEqual(["C1 1.1"]);
  });

  it("is partial, naming a fixed gap, for a message the read cannot find or could not read", async () => {
    const read = await readSlackPublications({
      botOnly: false,
      inventory: inventoryOf({ rows: [settled({ channel: "C1", ts: "1.1" }), settled({ channel: "C2", ts: "2.2" })] }),
      seam: seamOf({ failing: ["C2 2.2"], messages: {} }),
    });
    expect(read.coverage.state).toBe("partial");
    expect(read.coverage.gaps).toEqual([
      SLACK_PUBLICATION_GAPS.messageNotFound,
      SLACK_PUBLICATION_GAPS.messageReadFailed,
    ]);
    expect(read.coverage.objects).toBe(0);
  });

  it("counts uploaded files without reading them, and is partial while any is unread", async () => {
    const read = await readSlackPublications({
      botOnly: false,
      inventory: inventoryOf({ rows: [settled({ channel: "C1", ts: "1.1" })] }),
      seam: seamOf({
        messages: { "C1 1.1": { files: [{ id: "F1" }, { id: "F1" }, { id: "F2" }], text: "", ts: "1.1" } },
      }),
    });
    expect(read.coverage.attachmentsNotSwept).toBe(2);
    expect(read.coverage.gaps).toEqual([SLACK_PUBLICATION_GAPS.uploadsNotRead]);
  });

  it("is partial with no seam when the inventory holds posts and no credential is configured", async () => {
    const read = await readSlackPublications({
      botOnly: false,
      inventory: inventoryOf({ rows: [settled({ channel: "C1", ts: "1.1" })] }),
      seam: undefined,
    });
    expect(read.coverage.gaps).toEqual([SLACK_PUBLICATION_GAPS.credentialMissing]);
    expect(read.coverage.state).toBe("partial");
  });

  it("is complete with nothing to read when the journal holds no post", async () => {
    const read = await readSlackPublications({ botOnly: false, inventory: inventoryOf({ rows: [] }), seam: undefined });
    expect(read.coverage.state).toBe("complete");
  });

  it("names an unreadable journal, unparsed lines, a held row and the bot token as gaps", async () => {
    const read = await readSlackPublications({
      botOnly: true,
      inventory: {
        readFailure: "EACCES",
        rows: [settled({ channel: "C1", outcome: "held", ts: "1.1" })],
        unreadable: [3],
      },
      seam: seamOf({ messages: { "C1 1.1": { text: "x", ts: "1.1" } } }),
    });
    expect(read.coverage.gaps).toEqual(
      [
        SLACK_PUBLICATION_GAPS.botCredentialOnly,
        SLACK_PUBLICATION_GAPS.heldCrossLinks,
        SLACK_PUBLICATION_GAPS.inventoryRowUnreadable,
        SLACK_PUBLICATION_GAPS.inventoryUnreadable,
      ].toSorted(),
    );
  });

  it("reports a ceiling past the object limit and reads only that many", async () => {
    const seam = seamOf({ messages: { "C1 1.1": { text: "x", ts: "1.1" }, "C1 2.2": { text: "y", ts: "2.2" } } });
    const read = await readSlackPublications({
      botOnly: false,
      inventory: inventoryOf({ rows: [settled({ channel: "C1", ts: "2.2" }), settled({ channel: "C1", ts: "1.1" })] }),
      objectLimit: 1,
      seam,
    });
    expect(seam.asked).toEqual(["C1 1.1"]);
    expect(read.coverage.gaps).toEqual([SLACK_PUBLICATION_GAPS.objectCeiling]);
  });

  it("never carries a message's words into a gap", async () => {
    const read = await readSlackPublications({
      botOnly: true,
      inventory: inventoryOf({ rows: [settled({ channel: "C1", ts: "1.1" })] }),
      seam: seamOf({ messages: { "C1 1.1": { files: [{ id: "F1" }], text: "a-distinctive-word", ts: "1.1" } } }),
    });
    expect(read.texts.map((text) => text.text)).toEqual(["a-distinctive-word"]);
    expect(read.coverage.gaps.join(" ")).not.toContain("a-distinctive-word");
  });
});

describe("slackMessagePermalink", () => {
  it("anchors a reply on its thread", () => {
    expect(slackMessagePermalink({ channel: "C1", threadRoot: "1.0001", ts: "1.0002", workspaceUrl: WORKSPACE })).toBe(
      "https://acme.slack.com/archives/C1/p10002?thread_ts=1.0001&cid=C1",
    );
  });
});

describe("slackPublicationSeam", () => {
  /** A doored API answering one fixed thread in two pages and one fixed top-level message. */
  const api = ({ throwing = false }: { throwing?: boolean } = {}): SlackPublicationApi & {
    readonly calls: string[];
  } => {
    const calls: string[] = [];
    return {
      calls,
      history: async ({ latest }) => {
        calls.push(`history ${latest}`);
        if (throwing) {
          throw new Error("provider said no");
        }
        return { messages: [{ text: "top", ts: "5.5" }] };
      },
      replies: async ({ cursor }) => {
        calls.push(`replies ${String(cursor)}`);
        if (cursor === undefined) {
          return { messages: [{ text: "root", ts: "1.0" }], nextCursor: "c2" };
        }
        return {
          messages: [
            { text: "someone else", ts: "1.1" },
            { text: "ours", ts: "1.2" },
          ],
        };
      },
      workspaceUrl: async () => WORKSPACE,
    };
  };

  /** The found message's text, or the read's kind. */
  const outcome = ({ read }: { read: Result<SlackMessageRead, SlackMessageReadFailedError> }): string => {
    if (read.isErr()) {
      return read.error.code;
    }
    if (read.value.kind === "found") {
      return String(read.value.message["text"]);
    }
    return read.value.kind;
  };

  it("finds a reply by its exact ts across thread pages, never a neighbour", async () => {
    const doored = api();
    const read = await slackPublicationSeam({ api: doored }).readMessage({
      channel: "C1",
      threadRoot: "1.0",
      ts: "1.2",
    });
    expect(outcome({ read })).toBe("ours");
    expect(doored.calls).toEqual(["replies undefined", "replies c2"]);
  });

  it("is absent for a reply the thread no longer holds", async () => {
    const read = await slackPublicationSeam({ api: api() }).readMessage({
      channel: "C1",
      threadRoot: "1.0",
      ts: "1.9",
    });
    expect(outcome({ read })).toBe("absent");
  });

  it("reads a top-level message by its one instant, and a thrown call is the fixed read failure", async () => {
    const found = await slackPublicationSeam({ api: api() }).readMessage({
      channel: "C1",
      threadRoot: undefined,
      ts: "5.5",
    });
    expect(outcome({ read: found })).toBe("top");
    const failed = await slackPublicationSeam({ api: api({ throwing: true }) }).readMessage({
      channel: "C1",
      threadRoot: undefined,
      ts: "5.5",
    });
    expect(outcome({ read: failed })).toBe("SLACK_MESSAGE_READ_FAILED");
  });
});
