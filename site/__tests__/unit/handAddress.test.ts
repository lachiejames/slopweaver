/*
 * Where a hand step happens, from `hand list --json` to its queue card — never silence.
 *
 * A sign-in card with nothing to click leaves the owner without a place to go. A new step carries a link, a paste, or `hand post --no-address "<why>"`; the card draws the
 * stated reason as its own row, and a row posted before the rule — none of the three — says the address was never
 * stated rather than drawing nothing. Driven through the real reader and row builder, as `./handLiteral.test.ts` is.
 */

import { describe, expect, it } from "vitest";

import { readHandSteps } from "../../components/live/read";
import { NO_ADDRESS_STATED } from "../../lib/handCard";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import { ACME_PLACER } from "../organisationFixture";

import { stepOf } from "./cardKind";

const LOADING = { phase: "loading" } as const;

/** A step with nothing to open and nothing to paste, saying why, as `hand list --json` would print it. */
const STATED = {
  id: "tell-sadie-cutover-monday",
  postedBy: "workspace:12",
  postedIso: "2026-09-27T09:00:00.000Z",
  unaddressed: "it is a word the owner says on the call",
  unblocks: "the cutover plan",
  what: "Tell Sadie the cutover moved to Monday",
  witness: 'slopweaver hand done tell-sadie-cutover-monday --did "told Sadie"',
};

function handRowFor({ step }: { step: Record<string, unknown> }): QueueRow {
  const rows = rowsOf({
    reviewers: LOADING,
    standing: LOADING,
    acts: LOADING,
    board: LOADING,
    drafts: LOADING,
    hands: {
      fixture: undefined,
      observedAtIso: "2026-09-27T09:05:00.000Z",
      phase: "ready",
      stampedByRoute: false,
      value: readHandSteps([step])!,
    },
    landing: LOADING,
    placer: ACME_PLACER,
    posts: LOADING,
    reviews: LOADING,
    imports: LOADING,
  });
  return rows.find((row) => row.key === `hand:${String(step["id"])}`)!;
}

/** The card's labelled rows, as label and value pairs. */
function rowsOfCard({ row }: { row: QueueRow }): readonly (readonly [string, string])[] {
  return stepOf({ card: row.card }).rows.map((one) => [one.label, one.value] as const);
}

/** Whether the queue may draw the row's card, off its hand record. */
function formOf({ row }: { row: QueueRow }): unknown {
  expect(row.record.kind).toBe("hand");
  return (row.record as Extract<QueueRow["record"], { kind: "hand" }>).form;
}

describe("a hand step's address reaches its card", () => {
  it("draws the stated reason byte for byte as the card's `no address` row", () => {
    expect(rowsOfCard({ row: handRowFor({ step: STATED }) })).toEqual([
      ["unblocks", "the cutover plan"],
      ["no address", "it is a word the owner says on the call"],
      ["done when", 'slopweaver hand done tell-sadie-cutover-monday --did "told Sadie"'],
    ]);
  });

  it("says the address was never stated on a row posted before the rule, and still draws the card", () => {
    const { unaddressed: _dropped, ...legacy } = STATED;
    const row = handRowFor({ step: legacy });
    expect(rowsOfCard({ row }).filter(([label]) => label === "no address")).toEqual([
      ["no address", NO_ADDRESS_STATED],
    ]);
    expect(formOf({ row })).toEqual({ kind: "drawn" });
  });

  it("draws no `no address` row on a step that opens a page", () => {
    const { unaddressed: _dropped, ...rest } = STATED;
    const row = handRowFor({ step: { ...rest, url: "https://admin.typeform.com/login" } });
    expect(rowsOfCard({ row }).map(([label]) => label)).toEqual(["go to", "unblocks", "done when"]);
  });

  it("draws what happens if the owner does nothing from the printed `ifIgnored`, in the unblocks line's place", () => {
    const { unaddressed: _dropped, ...rest } = STATED;
    const ifIgnored = "the cutover plan stays unsent and Sadie books the old date";
    const row = handRowFor({ step: { ...rest, ifIgnored, url: "https://admin.typeform.com/login" } });
    expect(rowsOfCard({ row })).toEqual([
      ["go to", "https://admin.typeform.com/login"],
      ["if you do nothing", ifIgnored],
      ["unblocks", "the cutover plan"],
      ["done when", 'slopweaver hand done tell-sadie-cutover-monday --did "told Sadie"'],
    ]);
  });

  it("draws the step as unreadable, naming ifIgnored, when it is present but not a string, rather than drop it silently", () => {
    expect(readHandSteps([{ ...STATED, ifIgnored: 7 }])![0].unreadable).toBe("ifIgnored");
    expect(readHandSteps([{ ...STATED, ifIgnored: null }])![0].unreadable).toBe("ifIgnored");
  });

  it("draws the page the fleet opened as the card's first row — the Clerk card, read as it is printed", () => {
    const clerk = {
      context: "work",
      id: "mon-signin-dashboard-clerk-com",
      opened: "https://dashboard.clerk.com",
      postedBy: "supervisor",
      postedIso: "2026-10-02T19:45:47.806Z",
      unblocks: "resync-atlas-clerk stopped at dashboard.clerk.com's sign-in page",
      url: "http://localhost:3000/queue?open=hand%3Amon-signin-dashboard-clerk-com&context=work",
      what: "Sign in to dashboard.clerk.com in the work Chrome window that just opened on its sign-in page",
      where: "Your work Chrome profile, on that platform's sign-in page — sign in there, then press Done",
      witness: "slopweaver monitor check --fire",
    };
    const row = handRowFor({ step: clerk });
    expect(rowsOfCard({ row })[0]).toEqual(["go to", "https://dashboard.clerk.com"]);
    expect(rowsOfCard({ row }).map(([label]) => label)).not.toContain("open");
    expect(formOf({ row })).toEqual({ kind: "drawn" });
  });

  it("draws the step as unreadable, naming opened, when the opened page is present but not a web address", () => {
    expect(readHandSteps([{ ...STATED, opened: "dashboard.clerk.com" }])![0].unreadable).toBe("opened");
    expect(readHandSteps([{ ...STATED, opened: 7 }])![0].unreadable).toBe("opened");
  });

  it("draws the step as unreadable, naming unaddressed, when a reason is present but not a string", () => {
    expect(readHandSteps([{ ...STATED, unaddressed: 7 }])![0].unreadable).toBe("unaddressed");
    expect(readHandSteps([{ ...STATED, unaddressed: null }])![0].unreadable).toBe("unaddressed");
  });
});
