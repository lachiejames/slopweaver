import { describe, expect, it } from "vitest";

import { parseHandoverDoc } from "../../../handover/doc.js";
import type { RunEvent } from "../../../handover/ledger.js";
import {
  type BoardRunEntry,
  boardRunOf,
  inFlightRuns,
  repoNameOf,
  sessionRunOf,
} from "../../../sessionStart/inFlightRuns.js";
import type { SessionItem } from "../../../sessions/session.js";

const TEXT = [
  "---",
  "slug: acme-review-and-conflicts-16358",
  "summary: resolve the review thread on https://github.com/acme/acme-admin/pull/16358",
  "status: ready",
  "branch: feature/declared-branch",
  "repo: /repos/acme-admin",
  "---",
  "",
  "# Act on Kieran's review",
  "",
  "Also touches acme/acme-admin#16366 on the way.",
  "",
].join("\n");

const doc = parseHandoverDoc({ path: "/docs/acme-review-and-conflicts-16358.md", text: TEXT });

const started = ({ branch }: { branch: string }): RunEvent => ({
  atIso: "2026-09-03T00:00:00.000Z",
  branch,
  docHash: "0123456789abcdef",
  kind: "started",
});

const entry = ({ over = {} }: { over?: Partial<BoardRunEntry> } = {}): BoardRunEntry => ({
  doc,
  events: [started({ branch: "feature/journal-branch" })],
  holder: { kind: "live" },
  text: TEXT,
  ...over,
});

const session = ({ over = {} }: { over?: Partial<SessionItem> } = {}): SessionItem => ({
  branch: "feature/session-branch",
  lastEventIso: "2026-09-03T00:00:00.000Z",
  latestNote: "working https://github.com/acme/acme-admin/pull/16369 for the owner",
  sessionKey: "ws-57",
  slug: "pr-16369",
  status: "open",
  ...over,
});

describe("boardRunOf", () => {
  it("reads an open run's branch off its journal and every anchor off its doc", () => {
    expect(boardRunOf({ entry: entry() })).toEqual({
      anchors: ["https://github.com/acme/acme-admin/pull/16358", "acme/acme-admin#16366"],
      branch: "feature/journal-branch",
      repo: "acme-admin",
      slug: "acme-review-and-conflicts-16358",
    });
  });

  it("falls back to the doc's declared branch when the journal recorded a blank one", () => {
    const run = boardRunOf({ entry: entry({ over: { events: [started({ branch: "" })] } }) });
    expect(run!.branch).toBe("feature/declared-branch");
  });

  it("drops a doc nothing has started, since a dispatch is not a session inside the work", () => {
    expect(boardRunOf({ entry: entry({ over: { events: [] } }) })).toBe(undefined);
  });

  it("keeps a run that is waiting on the owner, because its session is still inside the work", () => {
    const waiting: readonly RunEvent[] = [
      started({ branch: "feature/journal-branch" }),
      { atIso: "2026-09-03T01:00:00.000Z", kind: "question", question: "which reading?" },
    ];
    expect(boardRunOf({ entry: entry({ over: { events: waiting } }) })!.branch).toBe("feature/journal-branch");
  });

  it("drops a closed run", () => {
    const closed: readonly RunEvent[] = [
      started({ branch: "feature/journal-branch" }),
      { atIso: "2026-09-03T01:00:00.000Z", kind: "finished", residue: [] },
    ];
    expect(boardRunOf({ entry: entry({ over: { events: closed } }) })).toBe(undefined);
  });

  it("drops a run whose holder is dead, since nobody is inside it", () => {
    expect(boardRunOf({ entry: entry({ over: { holder: { kind: "dead" } } }) })).toBe(undefined);
  });

  it("keeps a run whose holder could not be classified, the same asymmetry every other reader keeps", () => {
    const run = boardRunOf({ entry: entry({ over: { holder: { kind: "unknown", why: "a Codex writer" } } }) });
    expect(run!.slug).toBe("acme-review-and-conflicts-16358");
  });
});

describe("sessionRunOf", () => {
  it("reads an open session's branch, slug, key and the anchors in its latest note", () => {
    expect(sessionRunOf({ session: session() })).toEqual({
      anchors: ["https://github.com/acme/acme-admin/pull/16369"],
      branch: "feature/session-branch",
      sessionKey: "ws-57",
      slug: "pr-16369",
    });
  });

  it("names a session with no doc by its key", () => {
    const run = sessionRunOf({
      session: session({ over: { branch: undefined, latestNote: undefined, slug: undefined } }),
    });
    expect(run).toEqual({ anchors: [], branch: undefined, sessionKey: "ws-57", slug: "ws-57" });
  });

  it("drops a closed session", () => {
    expect(sessionRunOf({ session: session({ over: { status: "closed" } }) })).toBe(undefined);
  });
});

describe("inFlightRuns", () => {
  it("lists board runs before sessions, and only the ones somebody is inside", () => {
    const runs = inFlightRuns({
      board: [entry(), entry({ over: { holder: { kind: "dead" } } })],
      sessions: [session(), session({ over: { status: "closed" } })],
    });
    expect(runs.map((run) => run.slug)).toEqual(["acme-review-and-conflicts-16358", "pr-16369"]);
  });
});

describe("repoNameOf", () => {
  it("takes the last segment of a checkout path, ignoring a trailing slash", () => {
    expect(repoNameOf({ path: "/repos/acme-admin/" })).toBe("acme-admin");
  });

  it("names nothing for an absent or empty path", () => {
    expect(repoNameOf({ path: undefined })).toBe(undefined);
    expect(repoNameOf({ path: "/" })).toBe(undefined);
  });
});
