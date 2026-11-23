import { describe, expect, it } from "vitest";

import { foldSessions, type SessionEvent } from "../../../sessions/session.js";
import { openAppSessionForSlug } from "../../../sessions/sessionRow.js";

describe("openAppSessionForSlug", () => {
  const appRow = ({ n, slug, harness }: { n: number; slug: string; harness: string }): SessionEvent => ({
    branch: slug,
    cwd: `/tmp/wt-${String(n)}`,
    harness,
    kind: "spawned",
    sessionId: `id-${String(n)}`,
    sessionKey: slug,
    slug,
    surfaceRef: `surface:${String(n)}`,
    tsIso: `2026-11-10T0${String(n)}:00:00.000Z`,
    workspaceRef: `app:${String(n)}`,
  });

  it("names the newest open app row for the slug, past a closed one, a cmux one and another slug's", () => {
    const items = foldSessions({
      events: [
        appRow({ harness: "app", n: 1, slug: "a-doc" }),
        appRow({ harness: "app", n: 2, slug: "a-doc" }),
        appRow({ harness: "cmux", n: 3, slug: "a-doc" }),
        appRow({ harness: "app", n: 4, slug: "b-doc" }),
        appRow({ harness: "app", n: 5, slug: "a-doc" }),
        { kind: "closed", sessionId: "id-5", sessionKey: "a-doc", tsIso: "2026-11-10T06:00:00.000Z" },
      ],
    });
    expect(openAppSessionForSlug({ items, slug: "a-doc" })).toBe("id-2");
  });

  it("names none when the newest open app row recorded no id, never an older row's", () => {
    const idless: SessionEvent = {
      branch: "a-doc",
      cwd: "/tmp/wt-2",
      harness: "app",
      kind: "spawned",
      sessionKey: "a-doc",
      slug: "a-doc",
      surfaceRef: "surface:2",
      tsIso: "2026-11-10T02:00:00.000Z",
      workspaceRef: "app:2",
    };
    const items = foldSessions({ events: [appRow({ harness: "app", n: 1, slug: "a-doc" }), idless] });
    expect(openAppSessionForSlug({ items, slug: "a-doc" })).toBeUndefined();
  });

  it("names none when the newest open app row recorded an empty id, which no resume could name", () => {
    const emptyId: SessionEvent = {
      branch: "a-doc",
      cwd: "/tmp/wt-2",
      harness: "app",
      kind: "spawned",
      sessionId: "",
      sessionKey: "a-doc",
      slug: "a-doc",
      surfaceRef: "surface:2",
      tsIso: "2026-11-10T02:00:00.000Z",
      workspaceRef: "app:2",
    };
    const items = foldSessions({ events: [appRow({ harness: "app", n: 1, slug: "a-doc" }), emptyId] });
    expect(openAppSessionForSlug({ items, slug: "a-doc" })).toBeUndefined();
  });

  it("names the row written last though a clock set back stamped it earlier", () => {
    const items = foldSessions({
      events: [appRow({ harness: "app", n: 2, slug: "a-doc" }), appRow({ harness: "app", n: 1, slug: "a-doc" })],
    });
    expect(openAppSessionForSlug({ items, slug: "a-doc" })).toBe("id-1");
  });

  it("passes over an open app row for the slug kept under another key, which a resumed event would not reopen", () => {
    const items = foldSessions({
      events: [
        appRow({ harness: "app", n: 1, slug: "a-doc" }),
        { ...appRow({ harness: "app", n: 2, slug: "a-doc" }), sessionKey: "legacy-key" },
      ],
    });
    expect(openAppSessionForSlug({ items, slug: "a-doc" })).toBe("id-1");
  });

  it("names none when the slug holds no open app row", () => {
    const items = foldSessions({ events: [appRow({ harness: "cmux", n: 1, slug: "a-doc" })] });
    expect(openAppSessionForSlug({ items, slug: "a-doc" })).toBeUndefined();
  });
});
