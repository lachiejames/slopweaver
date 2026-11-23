import { describe, expect, it } from "vitest";
import type { HistoryEventRow } from "../../../../corpus/history/types.js";
import {
  eventClauses,
  issueHistoryDigest,
  issueHistoryRows,
  parseHistoryEvent,
  parseStateSpan,
  SUMMARY_CHAR_CAP,
  SUMMARY_CLAUSE_LIMIT,
  SUMMARY_EVENT_LIMIT,
  summaryLine,
} from "../../../../corpus/linear/history.js";

const CTX = { container: "linear/ENG", subjectId: "ENG-42" };

describe("parseHistoryEvent", () => {
  it("promotes id/createdAt/actor to columns and keeps the rest as the payload", () => {
    const event = parseHistoryEvent({
      ...CTX,
      node: {
        actor: { displayName: "Seth" },
        createdAt: "2026-05-04T10:00:00.000Z",
        fromState: { name: "Todo" },
        id: "h1",
        toState: { name: "In Progress" },
      },
    })!;
    expect(event.eventId).toBe("h1");
    expect(event.tsIso).toBe("2026-05-04T10:00:00.000Z");
    expect(event.actor).toBe("Seth");
    expect(event.subjectId).toBe("ENG-42");
    expect(event.container).toBe("linear/ENG");
    expect(event.stream).toBe("history");
    // The promoted fields are NOT duplicated into the payload.
    expect(event.changes).toEqual({ fromState: { name: "Todo" }, toState: { name: "In Progress" } });
  });

  it("STRIPS every null from the payload — the 3.5x size reduction", () => {
    const event = parseHistoryEvent({
      ...CTX,
      node: {
        createdAt: "2026-05-04T10:00:00.000Z",
        fromAssignee: null,
        fromCycle: null,
        fromDueDate: null,
        fromEstimate: null,
        fromParent: null,
        fromPriority: null,
        fromProject: null,
        fromState: null,
        id: "h1",
        toState: { name: "Done" },
      },
    })!;
    // Linear returns an explicit null for every one of ~80 from*/to* fields an event did not touch; 71.2% of
    // the measured raw bytes were those nulls (~98 MB against ~27.9 MB stripped).
    expect(event.changes).toEqual({ toState: { name: "Done" } });
  });

  it("key-SORTS the payload so the same event captured twice serialises identically", () => {
    // Built by INSERTION rather than as a literal, and deliberately so: the formatter sorts object literals,
    // which silently turned the first version of this test into a comparison of two identical objects.
    const serialise = ({ keys }: { keys: readonly string[] }): string => {
      const node: Record<string, unknown> = { createdAt: "t", id: "h1" };
      for (const key of keys) {
        node[key] = { name: key };
      }
      return JSON.stringify(parseHistoryEvent({ ...CTX, node })!.changes);
    };
    expect(serialise({ keys: ["toTeam", "toState"] })).toBe(serialise({ keys: ["toState", "toTeam"] }));
  });

  it("names the integration when a bot made the change rather than leaving it authorless", () => {
    const event = parseHistoryEvent({ ...CTX, node: { botActor: { name: "GitHub" }, createdAt: "t", id: "h1" } })!;
    expect(event.actor).toBe("GitHub");
  });

  it("names the person over the bot when Linear sends both, and carries no actor key when it sends neither", () => {
    const both = parseHistoryEvent({
      ...CTX,
      node: { actor: { displayName: "Seth" }, botActor: { name: "GitHub" }, createdAt: "t", id: "h1" },
    })!;
    expect(both.actor).toBe("Seth");
    const nameless = parseHistoryEvent({
      ...CTX,
      node: { actor: { name: "no display name" }, botActor: { name: "GitHub" }, createdAt: "t", id: "h1" },
    })!;
    expect(nameless.actor).toBe("GitHub");
    const neither = parseHistoryEvent({ ...CTX, node: { actor: null, botActor: null, createdAt: "t", id: "h1" } })!;
    expect(Object.hasOwn(neither, "actor")).toBe(false);
  });

  it("returns undefined without an id, and records an empty timestamp rather than inventing one", () => {
    expect(parseHistoryEvent({ ...CTX, node: { createdAt: "t" } })).toBeUndefined();
    expect(parseHistoryEvent({ ...CTX, node: { id: "h1" } })!.tsIso).toBe("");
  });
});

describe("parseStateSpan", () => {
  it("keys the span on startedAt, since a span has no createdAt at all", () => {
    const event = parseStateSpan({
      ...CTX,
      node: {
        endedAt: "2026-05-06T00:00:00.000Z",
        id: "s1",
        startedAt: "2026-05-04T00:00:00.000Z",
        state: { name: "In Progress" },
        stateId: "st1",
      },
    })!;
    expect(event.tsIso).toBe("2026-05-04T00:00:00.000Z");
    expect(event.stream).toBe("state");
    expect(event.changes).toEqual({
      endedAt: "2026-05-06T00:00:00.000Z",
      state: { name: "In Progress" },
      stateId: "st1",
    });
  });

  it("carries NO actor, by construction — a span cannot say who moved anything", () => {
    const event = parseStateSpan({ ...CTX, node: { id: "s1", startedAt: "t" } })!;
    expect(event.actor).toBeUndefined();
  });

  it("drops the open end of an unfinished span rather than storing a null", () => {
    const event = parseStateSpan({ ...CTX, node: { endedAt: null, id: "s1", startedAt: "t" } })!;
    expect(Object.hasOwn(event.changes, "endedAt")).toBe(false);
  });
});

describe("issueHistoryRows", () => {
  it("combines both streams and drops unusable nodes", () => {
    const rows = issueHistoryRows({
      ...CTX,
      historyNodes: [{ createdAt: "t1", id: "h1" }, { createdAt: "t2" }],
      stateNodes: [{ id: "s1", startedAt: "t0" }, "not-an-object"],
    });
    expect(rows.map((r) => `${r.stream}:${r.eventId}`)).toEqual(["history:h1", "state:s1"]);
  });

  it("returns nothing for an issue with no activity", () => {
    expect(issueHistoryRows({ ...CTX, historyNodes: [], stateNodes: [] })).toEqual([]);
  });
});

describe("eventClauses (pure)", () => {
  it("names every transition, rendering objects by their most human field", () => {
    expect(
      eventClauses({
        changes: {
          fromAssignee: { displayName: "Seth" },
          fromState: { name: "Todo" },
          toAssignee: { displayName: "Dana" },
          toState: { name: "Done" },
        },
      }),
    ).toEqual(["state Todo→Done", "assignee Seth→Dana"]);
  });

  it("names a transition object by the first of displayName, name, identifier, key and title it carries", () => {
    const named = ({ value }: { value: unknown }): readonly string[] => eventClauses({ changes: { toState: value } });
    expect(named({ value: { displayName: "Dana", name: "Dana Smith" } })).toEqual(["state —→Dana"]);
    expect(named({ value: { identifier: "ENG-7", key: "ENG" } })).toEqual(["state —→ENG-7"]);
    expect(named({ value: { key: "ENG", title: "Engineering" } })).toEqual(["state —→ENG"]);
    expect(named({ value: { title: "Engineering" } })).toEqual(["state —→Engineering"]);
    expect(named({ value: { displayName: "", id: "u1" } })).toEqual(["state —→—"]);
    expect(named({ value: 3 })).toEqual(["state —→3"]);
  });

  it("renders a one-sided transition with a dash for the absent side", () => {
    expect(eventClauses({ changes: { toAssignee: { displayName: "Dana" } } })).toEqual(["assignee —→Dana"]);
  });

  it("reports an ID-only transition as a FACT rather than a pair of UUIDs", () => {
    // `fromCycleId`/`toCycleId` rather than the cycle objects: resolving twenty-two nested objects per event is
    // what took a five-issue page to 9,454 complexity points against a 10,000 ceiling. The ids ARE stored, so a
    // reader can resolve them locally; a digest line has nothing readable to show inline.
    expect(eventClauses({ changes: { fromCycleId: "cy1", toCycleId: "cy2" } })).toEqual(["cycle changed"]);
    expect(eventClauses({ changes: { toProjectId: "p1" } })).toEqual(["project changed"]);
    expect(eventClauses({ changes: { fromTitle: "old", toTitle: "new" } })).toEqual(["title changed"]);
  });

  it("counts added and removed labels from their id lists", () => {
    expect(eventClauses({ changes: { addedLabelIds: ["l1", "l2"], removedLabelIds: ["l3"] } })).toEqual([
      "+2 label(s)",
      "-1 label(s)",
    ]);
  });

  it("names the boolean flags whose presence IS the event", () => {
    expect(eventClauses({ changes: { archived: true, updatedDescription: true } })).toEqual([
      "archived",
      "description edited",
    ]);
  });

  it("ignores a flag that is explicitly false", () => {
    expect(eventClauses({ changes: { archived: false } })).toEqual([]);
  });

  it("returns nothing for an event that describes no change worth naming", () => {
    expect(eventClauses({ changes: {} })).toEqual([]);
  });
});

/** One history row, with the fields a digest test cares about. */
function row({
  eventId,
  tsIso,
  actor,
  changes,
  stream = "history",
}: {
  eventId: string;
  tsIso: string;
  actor?: string;
  changes: Readonly<Record<string, unknown>>;
  stream?: HistoryEventRow["stream"];
}): HistoryEventRow {
  return {
    changes,
    container: "linear/ENG",
    eventId,
    source: "linear",
    stream,
    subjectId: "ENG-42",
    tsIso,
    version: 1,
    ...(actor !== undefined ? { actor } : {}),
  };
}

describe("summaryLine (pure)", () => {
  it("renders the day, the actor and the clauses", () => {
    expect(
      summaryLine({
        row: row({
          actor: "Seth",
          changes: { fromState: { name: "Todo" }, toState: { name: "Done" } },
          eventId: "h1",
          tsIso: "2026-05-04T10:00:00.000Z",
        }),
      }),
    ).toBe("2026-05-04 Seth: state Todo→Done");
  });

  it("caps the clauses per event and says how many it elided", () => {
    const line = summaryLine({
      row: row({
        actor: "Seth",
        changes: {
          addedLabelIds: ["l1"],
          fromAssignee: { displayName: "A" },
          fromEstimate: 1,
          fromPriority: 1,
          fromState: { name: "Todo" },
          toAssignee: { displayName: "B" },
          toEstimate: 3,
          toPriority: 2,
          toProjectId: "p1",
          toState: { name: "Done" },
        },
        eventId: "h1",
        tsIso: "2026-05-04T10:00:00.000Z",
      }),
    })!;
    expect(line.split(" · ").length).toBe(SUMMARY_CLAUSE_LIMIT);
    expect(line).toContain("(+3 more)");
  });

  it("says `someone` rather than dropping an actorless event", () => {
    expect(summaryLine({ row: row({ changes: { archived: true }, eventId: "h1", tsIso: "2026-05-04" }) })).toBe(
      "2026-05-04 someone: archived",
    );
  });

  it("renders a state span as the interval it is", () => {
    expect(
      summaryLine({
        row: row({ changes: { state: { name: "In Review" } }, eventId: "s1", stream: "state", tsIso: "2026-05-04" }),
      }),
    ).toBe("2026-05-04 in In Review");
  });

  it("returns undefined for an event with nothing to say", () => {
    expect(summaryLine({ row: row({ changes: {}, eventId: "h1", tsIso: "t" }) })).toBeUndefined();
  });
});

describe("issueHistoryDigest (the only history retrieval ever sees)", () => {
  it("renders oldest-first even though the most recent events are the ones kept", () => {
    const digest = issueHistoryDigest({
      rows: [
        row({ actor: "B", changes: { toState: { name: "Done" } }, eventId: "h2", tsIso: "2026-05-05T00:00:00.000Z" }),
        row({ actor: "A", changes: { toState: { name: "Todo" } }, eventId: "h1", tsIso: "2026-05-04T00:00:00.000Z" }),
      ],
    });
    expect(digest.split("\n")).toEqual(["Activity:", "2026-05-04 A: state —→Todo", "2026-05-05 B: state —→Done"]);
  });

  it("keeps the LATEST events when there are more than the limit, and says how many it hid", () => {
    const rows = Array.from({ length: SUMMARY_EVENT_LIMIT + 5 }, (_, index) =>
      row({
        actor: "Seth",
        changes: { toEstimate: index },
        eventId: `h${String(index)}`,
        tsIso: `2026-05-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      }),
    );
    const digest = issueHistoryDigest({ rows });
    const lines = digest.split("\n");
    expect(lines.length).toBe(SUMMARY_EVENT_LIMIT + 1); // the header plus the capped events
    expect(lines[0]!).toBe(`Activity (latest ${String(SUMMARY_EVENT_LIMIT)} of ${String(rows.length)}):`);
    // The newest event survived and the oldest did not — "what happened lately" is what a digest can answer.
    expect(digest).toContain("estimate —→16");
    expect(digest.includes("estimate —→0")).toBe(false);
  });

  it("EXCLUDES state spans, which would double every line a transition already made", () => {
    const digest = issueHistoryDigest({
      rows: [
        row({ actor: "A", changes: { toState: { name: "Done" } }, eventId: "h1", tsIso: "2026-05-04" }),
        row({ changes: { state: { name: "Done" } }, eventId: "s1", stream: "state", tsIso: "2026-05-04" }),
      ],
    });
    expect(digest.split("\n").length).toBe(2); // header + the ONE history line
  });

  it("hard-caps the digest length, so a pathological issue cannot swamp its own record", () => {
    // A very long ACTOR name, because the clause renderer now prints "title changed" rather than two full
    // titles — the digest's own bound removed the easiest way to blow the character cap, so this exercises the
    // cap through a field it still prints verbatim.
    const rows = Array.from({ length: SUMMARY_EVENT_LIMIT }, (_, index) =>
      row({
        actor: "S".repeat(400),
        changes: { fromState: { name: "N".repeat(200) }, toState: { name: "M".repeat(200) } },
        eventId: `h${String(index)}`,
        tsIso: `2026-05-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      }),
    );
    const digest = issueHistoryDigest({ rows });
    expect(digest.length).toBe(SUMMARY_CHAR_CAP);
    expect(digest.endsWith("…")).toBe(true);
  });

  it("is empty for an issue with no history, so no header is invented", () => {
    expect(issueHistoryDigest({ rows: [] })).toBe("");
    expect(issueHistoryDigest({ rows: [row({ changes: {}, eventId: "h1", tsIso: "t" })] })).toBe("");
  });
});
