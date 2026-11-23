/** The `session watch --json-report` document turned into the tick's watch observation. */
import { describe, expect, it } from "vitest";

import { watchDocument, watchRow } from "../tickDraftDocumentsFixture.js";
import { diagnosticOf, factsOf, redirected, refusalFor, sourcesWith } from "../tickDraftSourcesFixture.js";

describe("draftTickSources — watch", () => {
  it("takes each row's name and detail from the producer's own phrases, and carries the suppressed count", () => {
    const rows = [
      watchRow({
        attentionKind: "notification",
        signal: "needs-input",
        title: "✳ Ask and facts answer from the store",
      }),
      watchRow({ mapped: false, signal: "silent", title: undefined }),
    ];
    const sources = sourcesWith({
      capture: redirected({ path: "watch.json", value: watchDocument({ rows }) }),
      kind: "watch",
    });
    const facts = factsOf({ observation: sources.watch });

    expect(sources.watch.status).toBe("read");
    expect(sources.watch.observedAtIso).toBe("2026-09-12T21:24:00.000Z");
    expect(facts.rows[0]).toStrictEqual({
      on: "waiting on you (notification)",
      session: "✳ Ask and facts answer from the store",
      state: "needs-input",
    });
    expect(facts.rows[1]!.session).toBe(
      "workspace:14 [unmapped: id BF7D007A not in cmux inventory — check `cmux list --json` / `session list --json`]",
    );
    expect(facts.rows[1]!.on).toBe("quiet 12m after agent.hook.Stop");
    expect(facts.suppressed).toBe(0);
  });

  it("carries a limit-retrying row through the tick path as its own state, naming the re-seat verb", () => {
    const rows = [watchRow({ signal: "limit-retrying", title: "✳ console archive port" })];
    const sources = sourcesWith({
      capture: redirected({ path: "watch.json", value: watchDocument({ rows }) }),
      kind: "watch",
    });

    expect(sources.watch.status).toBe("read");
    expect(factsOf({ observation: sources.watch }).rows[0]).toStrictEqual({
      on: "usage-limit retry banner on screen — it answers nothing until its plan resets; run slopweaver session re-seat",
      session: "✳ console archive port",
      state: "limit-retrying",
    });
  });

  it("is partial when the drain says what it could not see", () => {
    const document = watchDocument({
      diagnostics: ["the cmux inventory could not be read (socket closed)"],
      rows: [watchRow({ signal: "working", title: "◐ a session" })],
    });
    const sources = sourcesWith({ capture: redirected({ path: "watch.json", value: document }), kind: "watch" });

    expect(sources.watch.status).toBe("partial");
    expect(diagnosticOf({ observation: sources.watch })).toBe("the cmux inventory could not be read (socket closed)");
  });

  it("is unavailable when it reported no session and the drain says what it missed", () => {
    const document = watchDocument({ diagnostics: ["some events were MISSED"], rows: [] });
    const sources = sourcesWith({ capture: redirected({ path: "watch.json", value: document }), kind: "watch" });

    expect(sources.watch.status).toBe("unavailable");
    expect(diagnosticOf({ observation: sources.watch })).toBe(
      "watch.json reported no session at all, and the drain says what it missed, so the fleet is unread: some events were MISSED",
    );
  });

  it("reads no rows as a real reading when the drain saw everything", () => {
    const sources = sourcesWith({
      capture: redirected({ path: "watch.json", value: watchDocument({ rows: [] }) }),
      kind: "watch",
    });

    expect(sources.watch.status).toBe("read");
    expect(factsOf({ observation: sources.watch }).rows.length).toBe(0);
  });

  it("refuses the bare --json row array, naming the mode that carries the whole reading", () => {
    const refusal = refusalFor({
      capture: redirected({ path: "watch.json", value: [watchRow({ signal: "idle", title: "a" })] }),
      kind: "watch",
    });

    expect(refusal.length).toBe(1);
    expect(refusal[0]).toContain("capture `slopweaver session watch --json-report` instead");
  });
});
