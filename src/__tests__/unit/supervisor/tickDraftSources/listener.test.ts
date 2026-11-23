/** The `listen status --json` document turned into the tick's listener observation. */
import { describe, expect, it } from "vitest";

import { diagnosticOf, factsOf, redirected, refusalFor, sourcesWith } from "../tickDraftSourcesFixture.js";

describe("draftTickSources — listener", () => {
  it("records the arm, the grade and a null pid", () => {
    const capture = redirected({
      path: "listener.json",
      value: { armId: "60eb2bcb", grade: "healthy", socketState: "connected", why: "healthy — arm 60eb2bcb" },
    });
    const sources = sourcesWith({ capture, kind: "listener" });

    expect(sources.listener.status).toBe("read");
    expect(factsOf({ observation: sources.listener })).toStrictEqual({
      armId: "60eb2bcb",
      grade: "healthy",
      pid: null,
      socketState: "connected",
      why: "healthy — arm 60eb2bcb",
    });
  });

  it("is unavailable when there is no arm to name, quoting the grade rather than substituting one", () => {
    const capture = redirected({
      path: "listener.json",
      value: { grade: "unarmed", why: "no listener has been started" },
    });
    const sources = sourcesWith({ capture, kind: "listener" });

    expect(sources.listener.status).toBe("unavailable");
    expect(diagnosticOf({ observation: sources.listener })).toBe(
      "the report names no arm: it grades unarmed — no listener has been started",
    );
  });

  it("refuses a grade outside the producer's own vocabulary, rather than copying it into the ledger", () => {
    const refusal = refusalFor({
      capture: redirected({
        path: "listener.json",
        value: { armId: "a1", grade: "banana", pid: 1, socketState: "connected", why: "test" },
      }),
      kind: "listener",
    });

    expect(refusal[0]).toBe("--listener listener.json is not a `slopweaver listen status --json` document:");
    expect(refusal[1]).toContain("grade:");
  });

  it("is partial when the report carries signal problems or a stale checkout", () => {
    const capture = redirected({
      path: "listener.json",
      value: {
        armId: "a1",
        freshness: { grade: "stale" },
        grade: "healthy",
        pid: 53570,
        problems: ["two arms answered one event"],
        socketState: "connected",
        why: "healthy",
      },
    });
    const sources = sourcesWith({ capture, kind: "listener" });

    expect(sources.listener.status).toBe("partial");
    expect(diagnosticOf({ observation: sources.listener })).toBe(
      "signal problem: two arms answered one event; the loop's checkout grades stale against the base branch",
    );
    expect(factsOf({ observation: sources.listener }).pid).toBe(53570);
  });
});
