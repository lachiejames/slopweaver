import { describe, expect, it } from "vitest";
import { doctrineAlertSummary, fleetDoctrineOf } from "../../lib/fleetDoctrine";
import type { DoctrineSeats } from "../../lib/fleetDoctrineSeats";
import type { DoctrineLine, DoctrineTone } from "../../lib/fleetDoctrineTypes";
import { boardOf, landingOf, lineOf, reconcileOf, seat } from "./fleetDoctrineFixture";

describe("fleetDoctrineOf", () => {
  const read = <T>(value: T): { kind: "read"; value: T } => ({ kind: "read", value });

  it("draws the incident: three seats of eight, two supervisor workspaces, headroom and a burst undrawn", () => {
    const seats: DoctrineSeats = {
      rows: [
        seat({
          manager: true,
          signal: "working",
          title: "✳ /slopweaver:supervisor",
          workspaceId: "w1",
          workspaceRef: "workspace:1",
        }),
        seat({ signal: "working", title: "/slopweaver:supervisor", workspaceId: "w2", workspaceRef: "workspace:2" }),
        seat({ sessionTitle: "Fix the flaky test", signal: "working", workspaceId: "w3" }),
        seat({ signal: "idle", title: "abc-idle", workspaceId: "w4" }),
      ],
      diagnostics: [],
      suppressed: 0,
    };
    const { lines } = fleetDoctrineOf({
      board: boardOf({ rows: [] }),
      glance: { burst: { kind: "read", open: ["plan-a", "plan-b"], taken: false }, ceiling: 8, working: 3 },
      landing: read(landingOf({ prs: [] })),
      reconcile: read(reconcileOf()),
      seats: read(seats),
    });
    expect(lines.map((line) => line.key)).toEqual(["seats", "unseatable", "pull-requests", "supervisors", "headroom"]);
    expect(lineOf({ key: "seats", lines })).toEqual({
      groups: [
        {
          items: [
            { href: undefined, key: "w1", text: "/slopweaver:supervisor" },
            { href: undefined, key: "w2", text: "/slopweaver:supervisor" },
            { href: undefined, key: "w3", text: "Fix the flaky test" },
          ],
          label: "working now",
        },
      ],
      key: "seats",
      quoted: [],
      sentence: "3 seats working of the 8 the plans' week carries.",
      tone: "attention",
    });
    expect(lineOf({ key: "supervisors", lines })).toEqual({
      groups: [
        {
          items: [
            { href: undefined, key: "w1", text: "workspace:1, pinned" },
            { href: undefined, key: "w2", text: "workspace:2, not pinned" },
          ],
          label: "supervisor workspaces",
        },
        { items: [{ href: undefined, key: "w3", text: "Fix the flaky test (w3)" }], label: "no title, not checked" },
      ],
      key: "supervisors",
      quoted: [],
      sentence:
        "At least 2 supervisor workspaces are open; there should be one. 1 open seat carries no title, so a copy could hide there.",
      tone: "danger",
    });
    expect(lineOf({ key: "headroom", lines })).toEqual({
      groups: [
        {
          items: [
            { href: undefined, key: "plan-a", text: "plan-a" },
            { href: undefined, key: "plan-b", text: "plan-b" },
          ],
          label: "behind their week",
        },
      ],
      key: "headroom",
      quoted: [],
      sentence:
        "5 seats the plans' week carries sit empty, and 2 plans are behind their week with the five-hour burst undrawn.",
      tone: "attention",
    });
    expect(lineOf({ key: "pull-requests", lines }).sentence).toBe("You have no open pull request.");
  });

  it("reads the doctrine kept: one supervisor, every seat in use, no plan behind", () => {
    const { lines } = fleetDoctrineOf({
      board: boardOf({ rows: [] }),
      glance: { burst: { kind: "read", open: [], taken: false }, ceiling: 1, working: 1 },
      landing: read(landingOf({ prs: [] })),
      reconcile: read(reconcileOf()),
      seats: read({
        diagnostics: [],
        rows: [seat({ manager: true, signal: "working", title: "/slopweaver:supervisor", workspaceId: "w1" })],
        suppressed: 0,
      }),
    });
    expect(lines.map((line) => [line.key, line.tone])).toEqual([
      ["seats", "ok"],
      ["unseatable", "ok"],
      ["pull-requests", "ok"],
      ["supervisors", "ok"],
      ["headroom", "ok"],
    ]);
    expect(lineOf({ key: "supervisors", lines }).sentence).toBe("1 supervisor workspace is open.");
    expect(lineOf({ key: "supervisors", lines }).tone).toBe("ok");
    expect(lineOf({ key: "headroom", lines }).sentence).toBe(
      "Every seat the plans' week carries is in use, and no plan is behind its week.",
    );
  });

  it("withdraws the seat and headroom counts when the glance and session watch's rows disagree", () => {
    const { lines } = fleetDoctrineOf({
      board: boardOf({ rows: [] }),
      glance: { burst: { kind: "read", open: [], taken: false }, ceiling: 1, working: 2 },
      landing: read(landingOf({ prs: [] })),
      reconcile: read(reconcileOf()),
      seats: read({
        diagnostics: [],
        rows: [seat({ manager: true, signal: "working", title: "/slopweaver:supervisor", workspaceId: "w1" })],
        suppressed: 0,
      }),
    });
    const mismatch =
      "the page counted 2 working against a session watch reading listing 1, so the two are not the same reading";
    expect(lineOf({ key: "seats", lines }).sentence).toBe(`Seats working: not read (${mismatch}).`);
    expect(lineOf({ key: "seats", lines }).tone).toBe("unread");
    expect(lineOf({ key: "headroom", lines }).sentence).toBe(`Plan headroom unused: not read (${mismatch}).`);
    expect(lineOf({ key: "headroom", lines }).tone).toBe("unread");
    expect(lineOf({ key: "supervisors", lines }).sentence).toBe("1 supervisor workspace is open.");
  });

  it("names a seat whose state did not read beside the mismatch, since it could be working", () => {
    const { lines } = fleetDoctrineOf({
      board: boardOf({ rows: [] }),
      glance: { burst: { kind: "read", open: [], taken: false }, ceiling: 2, working: 2 },
      landing: read(landingOf({ prs: [] })),
      reconcile: read(reconcileOf()),
      seats: read({
        diagnostics: [],
        rows: [
          seat({ signal: "working", title: "a", workspaceId: "w2" }),
          seat({ signal: "", title: "b", workspaceId: "w1" }),
        ],
        suppressed: 0,
      }),
    });
    const why =
      "the page counted 2 working against a session watch reading listing 1, so the two are not the same reading; session watch could not see everything (1 seat with a state that did not read)";
    expect(lineOf({ key: "seats", lines }).sentence).toBe(`Seats working: not read (${why}).`);
    const groups = [
      {
        items: [{ href: undefined, key: "w2", text: "a (w2), working" }],
        label: "shown by session watch, not checked",
      },
      { items: [{ href: undefined, key: "w1", text: 'b (w1), state "" did not read' }], label: "not checked" },
    ];
    expect(lineOf({ key: "seats", lines }).groups).toEqual(groups);
    expect(lineOf({ key: "headroom", lines }).groups).toEqual(groups);
  });

  it("names where a supervisor copy could hide, and never draws an unmeasured ceiling as a number", () => {
    const { lines } = fleetDoctrineOf({
      board: { kind: "unread", why: "the board is loading" },
      glance: {
        burst: { kind: "unread", why: "the machine capacity reading is not available" },
        ceiling: undefined,
        working: 1,
      },
      landing: { kind: "unread", why: "no landing reading yet" },
      reconcile: { kind: "unread", why: "no reconcile reading yet" },
      seats: read({ diagnostics: [], rows: [seat({ signal: "working", workspaceId: "w1" })], suppressed: 2 }),
    });
    expect(lineOf({ key: "seats", lines }).sentence).toBe(
      "1 seat working; how many seats the plans' week carries was not read.",
    );
    expect(lineOf({ key: "supervisors", lines })).toEqual({
      groups: [{ items: [{ href: undefined, key: "w1", text: "w1" }], label: "no title, not checked" }],
      key: "supervisors",
      quoted: [],
      sentence:
        "None of the titled seats looked at is a supervisor workspace. 1 open seat carries no title, so a copy could hide there. session watch left out 2 seats too quiet to count.",
      tone: "unread",
    });
    expect(lines.map((line) => line.tone)).toEqual(["unread", "unread", "unread", "unread", "unread"]);
  });

  it("reads one supervisor as a floor when session watch left a seat out", () => {
    const { lines } = fleetDoctrineOf({
      board: { kind: "unread", why: "the board is loading" },
      glance: { burst: { kind: "unread", why: "not read" }, ceiling: undefined, working: 0 },
      landing: { kind: "unread", why: "no landing reading yet" },
      reconcile: { kind: "unread", why: "no reconcile reading yet" },
      seats: read({
        diagnostics: [],
        rows: [seat({ manager: true, signal: "idle", title: "/slopweaver:supervisor", workspaceId: "w1" })],
        suppressed: 1,
      }),
    });
    expect(lineOf({ key: "supervisors", lines }).sentence).toBe(
      "At least 1 supervisor workspace is open. session watch left out 1 seat too quiet to count.",
    );
    // The seat left out could be a second supervisor, so a floor of one never reads as the doctrine met.
    expect(lineOf({ key: "supervisors", lines }).tone).toBe("unread");
  });

  it("withdraws every seat line when session watch's latest refresh failed", () => {
    const { lines } = fleetDoctrineOf({
      board: boardOf({ rows: [] }),
      glance: { burst: { kind: "read", open: [], taken: false }, ceiling: 2, working: 1 },
      landing: read(landingOf({ prs: [] })),
      reconcile: read(reconcileOf()),
      seats: { kind: "unread", why: "the latest read of session watch failed: timed out" },
    });
    expect(lines.map((line) => [line.key, line.tone, line.sentence])).toEqual([
      ["seats", "unread", "Seats working: not read (the latest read of session watch failed: timed out)."],
      ["unseatable", "ok", "No board row kept from a seat."],
      ["pull-requests", "ok", "You have no open pull request."],
      [
        "supervisors",
        "unread",
        "Supervisor workspaces open: not read (the latest read of session watch failed: timed out).",
      ],
      ["headroom", "unread", "Plan headroom unused: not read (the latest read of session watch failed: timed out)."],
    ]);
  });
});

describe("doctrineAlertSummary", () => {
  const toned = ({ key, tone }: { key: DoctrineLine["key"]; tone: DoctrineTone }): DoctrineLine => ({
    groups: [],
    key,
    quoted: [],
    sentence: `${key} line`,
    tone,
  });

  it("counts danger as red and attention as amber", () => {
    const lines = [
      toned({ key: "seats", tone: "attention" }),
      toned({ key: "unseatable", tone: "attention" }),
      toned({ key: "pull-requests", tone: "ok" }),
      toned({ key: "supervisors", tone: "danger" }),
      toned({ key: "headroom", tone: "unread" }),
    ];
    expect(doctrineAlertSummary({ lines })).toBe("Doctrine: 1 red, 2 amber");
  });

  it("says a count, never clear, when every line is ok", () => {
    const lines = [toned({ key: "seats", tone: "ok" }), toned({ key: "headroom", tone: "ok" })];
    expect(doctrineAlertSummary({ lines })).toBe("Doctrine: 0 red, 0 amber");
  });

  it("counts a line not read as neither colour", () => {
    const lines = [toned({ key: "seats", tone: "unread" }), toned({ key: "supervisors", tone: "unread" })];
    expect(doctrineAlertSummary({ lines })).toBe("Doctrine: 0 red, 0 amber");
  });
});
