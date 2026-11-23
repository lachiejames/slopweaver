/*
 * The readers under a register's placement: a field that places a row, present and unreadable, refuses the
 * whole reading rather than reading as absent. Absent would place the row by whatever else it carries while
 * hiding the address that might contradict it on the workspace selector.
 */

import { describe, expect, it } from "vitest";

import { readAutonomy } from "../../components/live/readAutonomy";
import { readHeldDrafts } from "../../components/live/readThread";

/** One autonomy ledger row, `run` exactly as given. */
function act({ run }: { run: unknown }): unknown {
  return {
    action: {
      actionId: "one",
      doneIso: "2026-09-28T00:00:00.000Z",
      kind: "press-merge-when-ready",
      run,
      subject: "https://github.com/lachiejames/slopweaver/pull/1",
      why: "green",
    },
  };
}

/** One `queue list --json` payload holding a single reply, `answering` exactly as given. */
function held({ answering }: { answering: unknown }): unknown {
  return {
    items: [
      {
        held: {
          askedBy: "U01",
          channel: "C01",
          draft: { answering, body: [{ runs: [{ text: "yes", type: "text" }] }], citations: [] },
          messageTs: "1720000000.000200",
          question: "is it done?",
          reason: "held for the owner's word",
          threadTs: "1720000000.000100",
        },
        id: "reply-one",
        state: "held",
        tsIso: "2026-09-28T00:00:00.000Z",
      },
    ],
  };
}

describe("an act's run", () => {
  it("refuses the reading when the run is present and not a string", () => {
    expect(readAutonomy([act({ run: ["the-row"] })])).toBeUndefined();
  });

  it("reads a string run, and an absent one as none", () => {
    expect(readAutonomy([act({ run: "the-row" })])![0].run).toBe("the-row");
    expect(readAutonomy([act({ run: undefined })])![0].run).toBeUndefined();
  });
});

describe("a held reply's permalink", () => {
  const permalink = "https://acme.slack.com/archives/C01/p1720000000000200";

  it("refuses the reading when the permalink is present and not an address", () => {
    expect(readHeldDrafts(held({ answering: { permalink: [permalink] } }))).toBeUndefined();
    expect(readHeldDrafts(held({ answering: { permalink: "acme.slack.com/archives/C01" } }))).toBeUndefined();
    expect(readHeldDrafts(held({ answering: { permalink: "ftp://acme.slack.com/archives/C01/p1" } }))).toBeUndefined();
  });

  it("refuses the reading when what it answers is present and not an object", () => {
    expect(readHeldDrafts(held({ answering: permalink }))).toBeUndefined();
  });

  it("reads a permalink that is an address, and an absent one as none", () => {
    expect(readHeldDrafts(held({ answering: { permalink } }))![0].permalink).toBe(permalink);
    expect(readHeldDrafts(held({ answering: undefined }))![0].permalink).toBeUndefined();
    expect(readHeldDrafts(held({ answering: {} }))![0].permalink).toBeUndefined();
  });
});
