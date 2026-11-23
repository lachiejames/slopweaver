/** {@link parseSessionLog} and {@link foldSessions} — pure, no filesystem involved. */
import { describe, expect, it } from "vitest";

import { foldSessions, parseSessionLog, type SessionEvent, sessionEventLine } from "../../../sessions/session.js";
import { openRowForSession } from "../../../sessions/sessionRow.js";

describe("sessionEventLine / parseSessionLog", () => {
  it("round-trips a spawned event", () => {
    const event: SessionEvent = {
      branch: "a-doc",
      cwd: "/tmp/wt",
      kind: "spawned",
      sessionKey: "a-doc",
      slug: "a-doc",
      surfaceRef: "surface:1",
      tsIso: "2026-08-10T00:00:00.000Z",
      workspaceRef: "workspace:1",
    };

    const parsed = parseSessionLog({ text: sessionEventLine({ event }) });

    expect(parsed.events).toEqual([event]);
    expect(parsed.unreadable).toEqual([]);
  });

  it("round-trips a dispatched worker: no handover slug, and the tier it was pinned to", () => {
    const event: SessionEvent = {
      bootModel: { kind: "pinned", model: "opus" },
      branch: "a-branch",
      cwd: "/tmp/checkout",
      kind: "spawned",
      sessionKey: "ask-C1-1787720788.183959",
      surfaceRef: "surface:236",
      tsIso: "2026-08-26T00:00:00.000Z",
      workspaceRef: "workspace:218",
    };

    const parsed = parseSessionLog({ text: sessionEventLine({ event }) });

    expect(parsed.events).toEqual([event]);
    expect(parsed.unreadable).toEqual([]);
  });

  it("reports a spawned event whose slug is present but not a string as unreadable", () => {
    const text = JSON.stringify({
      branch: "a-branch",
      cwd: "/tmp/checkout",
      kind: "spawned",
      sessionKey: "ask-C1-2.2",
      slug: 5,
      surfaceRef: "surface:1",
      tsIso: "t",
      workspaceRef: "workspace:1",
    });

    const parsed = parseSessionLog({ text });

    expect(parsed.events).toEqual([]);
    expect(parsed.unreadable).toEqual([1]);
  });

  it("round-trips a noted event", () => {
    const event: SessionEvent = {
      kind: "noted",
      note: "waiting on the owner's answer",
      sessionKey: "a-doc",
      tsIso: "t",
    };

    expect(parseSessionLog({ text: sessionEventLine({ event }) }).events).toEqual([event]);
  });

  it("round-trips a closed event", () => {
    const event: SessionEvent = { kind: "closed", sessionKey: "a-doc", tsIso: "t" };

    expect(parseSessionLog({ text: sessionEventLine({ event }) }).events).toEqual([event]);
  });

  it("round-trips a closed event naming the workspace it targets", () => {
    const event: SessionEvent = { kind: "closed", sessionKey: "a-doc", tsIso: "t", workspaceRef: "workspace:1" };

    expect(parseSessionLog({ text: sessionEventLine({ event }) }).events).toEqual([event]);
  });

  it("reports a malformed line as unreadable rather than failing the whole parse", () => {
    const good: SessionEvent = { kind: "closed", sessionKey: "a-doc", tsIso: "t" };
    const text = `not json\n${sessionEventLine({ event: good })}`;

    const parsed = parseSessionLog({ text });

    expect(parsed.events).toEqual([good]);
    expect(parsed.unreadable).toEqual([1]);
  });

  it("reports a spawned event missing a required field as unreadable", () => {
    const text = JSON.stringify({ kind: "spawned", sessionKey: "a-doc", tsIso: "t" });

    expect(parseSessionLog({ text }).unreadable).toEqual([1]);
  });

  it("skips blank lines without counting them as unreadable", () => {
    expect(parseSessionLog({ text: "\n\n" })).toEqual({ events: [], unreadable: [] });
  });
});

describe("foldSessions", () => {
  it("opens an entry from a spawned event", () => {
    const events: readonly SessionEvent[] = [
      {
        branch: "a-doc",
        cwd: "/tmp/wt",
        kind: "spawned",
        sessionKey: "a-doc",
        slug: "a-doc",
        surfaceRef: "surface:1",
        tsIso: "t1",
        workspaceRef: "workspace:1",
      },
    ];

    expect(foldSessions({ events })).toEqual([
      {
        branch: "a-doc",
        cwd: "/tmp/wt",
        lastEventIso: "t1",
        latestNote: undefined,
        sessionKey: "a-doc",
        slug: "a-doc",
        spawnedIso: "t1",
        status: "open",
        surfaceRef: "surface:1",
        workspaceRef: "workspace:1",
      },
    ]);
  });

  it("folds a dispatched reviewer with no slug at all, keeping the tier it was pinned to", () => {
    const items = foldSessions({
      events: [
        {
          bootModel: { kind: "pinned", model: "sonnet" },
          branch: "a-branch",
          cwd: "/tmp/checkout",
          kind: "spawned",
          sessionKey: "review-C1-2.2",
          surfaceRef: "surface:2",
          tsIso: "t1",
          workspaceRef: "workspace:229",
        },
      ],
    });

    expect(items.length).toBe(1);
    expect(items[0]!.bootModel).toEqual({ kind: "pinned", model: "sonnet" });
    expect(items[0]!.slug).toBeUndefined();
    expect(items[0]!.status).toBe("open");
  });

  it("registers a session from a bare noted event, with no spawned event at all", () => {
    const events: readonly SessionEvent[] = [
      { kind: "noted", note: "opened by hand", sessionKey: "manual-1", tsIso: "t1" },
    ];

    expect(foldSessions({ events })).toEqual([
      { lastEventIso: "t1", latestNote: "opened by hand", sessionKey: "manual-1", status: "open" },
    ]);
  });

  it("keeps the spawn fields when a later note updates the same session", () => {
    const events: readonly SessionEvent[] = [
      {
        branch: "a-doc",
        cwd: "/tmp/wt",
        kind: "spawned",
        sessionKey: "a-doc",
        slug: "a-doc",
        surfaceRef: "surface:1",
        tsIso: "t1",
        workspaceRef: "workspace:1",
      },
      { kind: "noted", note: "root-caused it", sessionKey: "a-doc", tsIso: "t2" },
    ];

    const item = foldSessions({ events })[0]!;

    expect(item.slug).toBe("a-doc");
    expect(item.latestNote).toBe("root-caused it");
    expect(item.lastEventIso).toBe("t2");
    expect(item.status).toBe("open");
  });

  it("marks a session closed without losing its slug or last note", () => {
    const events: readonly SessionEvent[] = [
      {
        branch: "a-doc",
        cwd: "/tmp/wt",
        kind: "spawned",
        sessionKey: "a-doc",
        slug: "a-doc",
        surfaceRef: "surface:1",
        tsIso: "t1",
        workspaceRef: "workspace:1",
      },
      { kind: "closed", sessionKey: "a-doc", tsIso: "t2" },
    ];

    const item = foldSessions({ events })[0]!;

    expect(item.status).toBe("closed");
    expect(item.slug).toBe("a-doc");
  });

  it("orders most-recently-opened session first", () => {
    const events: readonly SessionEvent[] = [
      { kind: "noted", note: "first", sessionKey: "one", tsIso: "t1" },
      { kind: "noted", note: "second", sessionKey: "two", tsIso: "t2" },
    ];

    expect(foldSessions({ events }).map((item) => item.sessionKey)).toEqual(["two", "one"]);
  });

  it("returns nothing for an empty log", () => {
    expect(foldSessions({ events: [] })).toEqual([]);
  });

  it("folds two spawns of the same slug to two rows, not one overwriting the other", () => {
    const events: readonly SessionEvent[] = [
      {
        branch: "a-doc",
        cwd: "/tmp/wt-1",
        kind: "spawned",
        sessionKey: "a-doc",
        slug: "a-doc",
        surfaceRef: "surface:1",
        tsIso: "t1",
        workspaceRef: "workspace:1",
      },
      {
        branch: "a-doc",
        cwd: "/tmp/wt-2",
        kind: "spawned",
        sessionKey: "a-doc",
        slug: "a-doc",
        surfaceRef: "surface:2",
        tsIso: "t2",
        workspaceRef: "workspace:2",
      },
    ];

    const items = foldSessions({ events });

    expect(items.length).toBe(2);
    expect(items.map((item) => item.workspaceRef)).toEqual(["workspace:2", "workspace:1"]);
    expect(items.every((item) => item.status === "open")).toBe(true);
  });

  it("a closed event naming a workspace closes only that row, leaving its sibling open", () => {
    const events: readonly SessionEvent[] = [
      {
        branch: "a-doc",
        cwd: "/tmp/wt-1",
        kind: "spawned",
        sessionKey: "a-doc",
        slug: "a-doc",
        surfaceRef: "surface:1",
        tsIso: "t1",
        workspaceRef: "workspace:1",
      },
      {
        branch: "a-doc",
        cwd: "/tmp/wt-2",
        kind: "spawned",
        sessionKey: "a-doc",
        slug: "a-doc",
        surfaceRef: "surface:2",
        tsIso: "t2",
        workspaceRef: "workspace:2",
      },
      { kind: "closed", sessionKey: "a-doc", tsIso: "t3", workspaceRef: "workspace:1" },
    ];

    const items = foldSessions({ events });

    const closedRow = items.find((item) => item.workspaceRef === "workspace:1")!;
    const openRow = items.find((item) => item.workspaceRef === "workspace:2")!;
    expect(closedRow.status).toBe("closed");
    expect(openRow.status).toBe("open");
  });

  it("a closed event with no workspace keeps legacy whole-key behaviour, closing every open row for the key", () => {
    const events: readonly SessionEvent[] = [
      {
        branch: "a-doc",
        cwd: "/tmp/wt-1",
        kind: "spawned",
        sessionKey: "a-doc",
        slug: "a-doc",
        surfaceRef: "surface:1",
        tsIso: "t1",
        workspaceRef: "workspace:1",
      },
      {
        branch: "a-doc",
        cwd: "/tmp/wt-2",
        kind: "spawned",
        sessionKey: "a-doc",
        slug: "a-doc",
        surfaceRef: "surface:2",
        tsIso: "t2",
        workspaceRef: "workspace:2",
      },
      { kind: "closed", sessionKey: "a-doc", tsIso: "t3" },
    ];

    const items = foldSessions({ events });

    expect(items.every((item) => item.status === "closed")).toBe(true);
  });

  it("a closed event naming a workspace nobody spawned changes no row", () => {
    const events: readonly SessionEvent[] = [
      {
        branch: "a-doc",
        cwd: "/tmp/wt-1",
        kind: "spawned",
        sessionKey: "a-doc",
        slug: "a-doc",
        surfaceRef: "surface:1",
        tsIso: "t1",
        workspaceRef: "workspace:1",
      },
      { kind: "closed", sessionKey: "a-doc", tsIso: "t2", workspaceRef: "workspace:9" },
    ];

    const items = foldSessions({ events });

    expect(items[0]!.status).toBe("open");
  });
});

describe("rows the session harness writes — keyed by session id", () => {
  /** A `spawned` event for `a-doc`, the way the seam's recording launcher writes one. */
  const spawned = ({
    n,
    sessionId,
    openedBy,
    ref = `workspace:${String(n)}`,
  }: {
    n: number;
    sessionId?: string;
    openedBy?: "open" | "resume";
    ref?: string;
  }): SessionEvent => ({
    branch: "a-doc",
    cwd: `/tmp/wt-${String(n)}`,
    kind: "spawned",
    sessionKey: "a-doc",
    slug: "a-doc",
    surfaceRef: `surface:${String(n)}`,
    tsIso: `t${String(n)}`,
    workspaceRef: ref,
    ...(sessionId === undefined ? {} : { harness: "cmux", sessionId, workspaceId: sessionId }),
    ...(openedBy === undefined ? {} : { openedBy }),
  });

  it("round-trips the harness fields", () => {
    const event = spawned({ n: 1, openedBy: "resume", sessionId: "id-1" });
    expect(parseSessionLog({ text: sessionEventLine({ event }) }).events).toEqual([event]);
  });

  it("reads an openedBy naming no act as unreadable", () => {
    const line = sessionEventLine({ event: spawned({ n: 1, sessionId: "id-1" }) }).replace(
      '"kind":"spawned"',
      '"kind":"spawned","openedBy":"reopen"',
    );
    expect(parseSessionLog({ text: line }).unreadable).toEqual([1]);
  });

  it("folds an open and a resume under one slug to two rows, each naming its act", () => {
    const items = foldSessions({
      events: [
        spawned({ n: 1, openedBy: "open", sessionId: "id-1" }),
        spawned({ n: 2, openedBy: "resume", sessionId: "id-2" }),
      ],
    });
    expect(items.map((item) => [item.sessionId, item.openedBy, item.harness, item.status])).toEqual([
      ["id-2", "resume", "cmux", "open"],
      ["id-1", "open", "cmux", "open"],
    ]);
  });

  it("closes by session id, even when a restart renumbered the ref onto a sibling", () => {
    const items = foldSessions({
      events: [
        spawned({ n: 1, ref: "workspace:1", sessionId: "id-1" }),
        spawned({ n: 2, ref: "workspace:1", sessionId: "id-2" }),
        { kind: "closed", sessionId: "id-2", sessionKey: "a-doc", tsIso: "t3", workspaceRef: "workspace:1" },
      ],
    });
    expect(items.map((item) => [item.sessionId, item.status])).toEqual([
      ["id-2", "closed"],
      ["id-1", "open"],
    ]);
  });

  it("falls back to the ref only for a row that recorded no id", () => {
    const items = foldSessions({
      events: [
        spawned({ n: 1, ref: "workspace:1" }),
        spawned({ n: 2, ref: "workspace:1", sessionId: "id-other" }),
        { kind: "closed", sessionId: "id-1", sessionKey: "a-doc", tsIso: "t3", workspaceRef: "workspace:1" },
      ],
    });
    expect(items.map((item) => [item.sessionId, item.status])).toEqual([
      ["id-other", "open"],
      [undefined, "closed"],
    ]);
  });

  it("finds the open row a live session holds, by id first and by handle only for an id-less row", () => {
    const items = foldSessions({
      events: [spawned({ n: 1, ref: "workspace:1" }), spawned({ n: 2, ref: "workspace:2", sessionId: "id-2" })],
    });
    expect(
      [
        openRowForSession({ handle: "workspace:9", items, sessionId: "id-2" }),
        openRowForSession({ handle: "workspace:1", items, sessionId: "id-1" }),
        openRowForSession({ handle: "workspace:2", items, sessionId: "id-3" }),
      ].map((row) => row?.cwd),
    ).toEqual(["/tmp/wt-2", "/tmp/wt-1", undefined]);
  });

  it("agrees with the fold when a CLOSED row carries the id: no handle fallback, so no row a close would miss", () => {
    const events: SessionEvent[] = [
      spawned({ n: 1, ref: "workspace:1", sessionId: "id-A" }),
      { kind: "closed", sessionId: "id-A", sessionKey: "a-doc", tsIso: "t2", workspaceRef: "workspace:1" },
      spawned({ n: 3, ref: "workspace:1" }),
    ];
    expect(openRowForSession({ handle: "workspace:1", items: foldSessions({ events }), sessionId: "id-A" })).toBe(
      undefined,
    );
    // The fold a close naming id-A would get: it lands on the closed id-A row and the id-less row stays open.
    const closedAgain = foldSessions({
      events: [
        ...events,
        { kind: "closed", sessionId: "id-A", sessionKey: "a-doc", tsIso: "t4", workspaceRef: "workspace:1" },
      ],
    });
    expect(closedAgain.map((item) => [item.cwd, item.status])).toEqual([
      ["/tmp/wt-3", "open"],
      ["/tmp/wt-1", "closed"],
    ]);
  });

  it("round-trips a `resumed` event and reads one naming no session as unreadable", () => {
    const event: SessionEvent = { kind: "resumed", sessionId: "id-1", sessionKey: "a-doc", tsIso: "t2" };
    expect(parseSessionLog({ text: sessionEventLine({ event }) }).events).toEqual([event]);
    const empty = sessionEventLine({ event }).replace('"sessionId":"id-1"', '"sessionId":""');
    expect(parseSessionLog({ text: empty }).unreadable).toEqual([1]);
  });

  it("folds a `resumed` event onto the row its session id names, never a second row", () => {
    const items = foldSessions({
      events: [
        spawned({ n: 1, openedBy: "open", sessionId: "id-1" }),
        spawned({ n: 2, openedBy: "open", sessionId: "id-2" }),
        { kind: "resumed", sessionId: "id-1", sessionKey: "a-doc", tsIso: "t3" },
      ],
    });
    expect(items.map((item) => [item.sessionId, item.openedBy, item.status, item.lastEventIso, item.cwd])).toEqual([
      ["id-2", "open", "open", "t2", "/tmp/wt-2"],
      ["id-1", "resume", "open", "t3", "/tmp/wt-1"],
    ]);
  });

  it("reopens only the newest row when two spawned rows share the resumed session id (the r3 Codex review)", () => {
    const items = foldSessions({
      events: [
        spawned({ n: 1, openedBy: "open", sessionId: "id-1" }),
        spawned({ n: 2, openedBy: "open", sessionId: "id-1" }),
        { kind: "closed", sessionId: "id-1", sessionKey: "a-doc", tsIso: "t3" },
        { kind: "resumed", sessionId: "id-1", sessionKey: "a-doc", tsIso: "t4" },
      ],
    });
    expect(items.map((item) => [item.cwd, item.openedBy, item.status, item.lastEventIso])).toEqual([
      ["/tmp/wt-2", "resume", "open", "t4"],
      ["/tmp/wt-1", "open", "closed", "t3"],
    ]);
  });

  it("registers no row for a `resumed` session the ledger never saw spawned", () => {
    const items = foldSessions({ events: [{ kind: "resumed", sessionId: "id-9", sessionKey: "a-doc", tsIso: "t1" }] });
    expect(items).toEqual([]);
  });

  it("leaves a legacy id-less row closable by its workspace after a `resumed` naming an id no row carries", () => {
    const items = foldSessions({
      events: [
        spawned({ n: 1 }),
        { kind: "resumed", sessionId: "id-1", sessionKey: "a-doc", tsIso: "t2" },
        { kind: "closed", sessionId: "id-1", sessionKey: "a-doc", tsIso: "t3", workspaceRef: "workspace:1" },
      ],
    });
    expect(items.map((item) => [item.cwd, item.status, item.sessionId])).toEqual([["/tmp/wt-1", "closed", undefined]]);
  });
});

describe("the boot model a spawn records", () => {
  const base = {
    branch: "a-doc",
    cwd: "/tmp/wt",
    kind: "spawned",
    sessionKey: "a-doc",
    slug: "a-doc",
    surfaceRef: "surface:1",
    tsIso: "2026-08-26T00:00:00.000Z",
    workspaceRef: "workspace:1",
  } as const;

  it("round-trips a pinned tier", () => {
    const event: SessionEvent = { ...base, bootModel: { kind: "pinned", model: "opus" } };

    expect(parseSessionLog({ text: sessionEventLine({ event }) }).events).toEqual([event]);
  });

  it("round-trips an inherited default", () => {
    const event: SessionEvent = { ...base, bootModel: { kind: "inherited" } };

    expect(parseSessionLog({ text: sessionEventLine({ event }) }).events).toEqual([event]);
  });

  it("reads a row written before the field existed as recording nothing, not as inherited", () => {
    const parsed = parseSessionLog({ text: sessionEventLine({ event: base }) });

    expect(parsed.unreadable).toEqual([]);
    expect(foldSessions({ events: parsed.events })[0]!.bootModel).toBe(undefined);
  });

  it("keeps the rest of a spawned event when the boot model itself is malformed", () => {
    const text = JSON.stringify({ ...base, bootModel: { kind: "pinned" } });

    const parsed = parseSessionLog({ text });

    expect(parsed.unreadable).toEqual([]);
    expect(foldSessions({ events: parsed.events })[0]!.workspaceRef).toBe("workspace:1");
    expect(foldSessions({ events: parsed.events })[0]!.bootModel).toBe(undefined);
  });

  it("carries the pinned tier onto the folded item", () => {
    const event: SessionEvent = { ...base, bootModel: { kind: "pinned", model: "claude-sonnet-5" } };

    expect(foldSessions({ events: [event] })[0]!.bootModel).toEqual({ kind: "pinned", model: "claude-sonnet-5" });
  });

  it("leaves a session registered only by a note with no boot model at all", () => {
    const noted: SessionEvent = { kind: "noted", note: "registered by hand", sessionKey: "b-doc", tsIso: "t" };

    expect(foldSessions({ events: [noted] })[0]!.bootModel).toBe(undefined);
  });
});
