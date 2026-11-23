import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withConnectMembers } from "../../../../cli/commands/refresh/members.js";
import { bronzeSourceDir, memberFile } from "../../../../corpus/corpusPaths.js";
import { writeMemberRows } from "../../../../corpus/members/store.js";
import type { MemberBronzeRow } from "../../../../corpus/members/types.js";
import { projectConnectMember } from "../../../../corpus/slack/connectMembers.js";
import { projectSlackMember } from "../../../../corpus/slack/members.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";

const FETCHED = "2026-09-20T00:00:00.000Z";

/** The flat profile Slack stamps on a message whose author `users.list` cannot return. */
const PROFILE = {
  display_name: "Martin Zell",
  image_72: "https://avatars.slack-edge.com/72.png",
  is_restricted: false,
  is_ultra_restricted: false,
  name: "dr.martin.zell",
  real_name: "Dr Martin Zell",
  team: "T0SYN000002",
};

let home = "";

/** One bronze message line carrying `user_profile` for `author`. */
function bronzeLine({ author }: { author: string }): string {
  return JSON.stringify({
    author,
    container: "slack/C1",
    kind: "message",
    raw: { text: "hi", user_profile: PROFILE },
    refs: [],
    source: "slack",
    sourceId: `C1:${author}`,
    text: "hi",
    tsIso: "2026-09-01T00:00:00.000Z",
    url: "https://acme.slack.com/archives/C1/p1",
  });
}

/** Put one Slack bronze window file on disk carrying a recoverable profile for each id. */
function seedBronze({ authors }: { authors: readonly string[] }): void {
  const dir = bronzeSourceDir({ home, source: "slack" });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "2026-09-01_2026-09-02.jsonl"), authors.map((author) => bronzeLine({ author })).join("\n"));
}

/** What `users.list` returned this hydration — a successful, possibly empty, roster. */
function listedNow({ rows }: { rows: readonly MemberBronzeRow[] }) {
  return ok({ rows, warnings: [] as readonly string[] });
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "connect-recovery-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("withConnectMembers", () => {
  it("recovers an author bronze carries a profile for and users.list has never returned", () => {
    seedBronze({ authors: ["U0SYN000009"] });
    const result = unwrap(withConnectMembers({ fetchedAtIso: FETCHED, home, listed: listedNow({ rows: [] }) }));
    expect(result.rows.map((row) => row.sourceId)).toEqual(["U0SYN000009"]);
    expect(result.warnings).toEqual([
      "recovered 1 member(s) from message user_profile — people users.list cannot return (Slack Connect / another Grid workspace)",
    ]);
  });

  it("does not recover an author a PAST hydration's users.list row already covers", () => {
    seedBronze({ authors: ["U0SYN000009"] });
    const past = projectSlackMember({ fetchedAtIso: "2026-01-01T00:00:00.000Z", raw: { id: "U0SYN000009" } })!;
    expect(writeMemberRows({ home, rows: [past], source: "slack" }).isOk()).toBe(true);
    const result = unwrap(withConnectMembers({ fetchedAtIso: FETCHED, home, listed: listedNow({ rows: [] }) }));
    expect(result.rows).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  // The r1 review's counterexample. `readMemberRows` answers `{ rows: [], warnings: [message] }` for every
  // read failure that is not ENOENT, so reading only `.rows` would take an unreadable roster for an empty
  // one and write a recovered row straight over a `users.list` row it could not see.
  it("skips the recovery, loudly, when the stored roster did not read cleanly", () => {
    seedBronze({ authors: ["U0SYN000009"] });
    const rosterPath = memberFile({ home, source: "slack" });
    mkdirSync(dirname(rosterPath), { recursive: true });
    writeFileSync(rosterPath, "{not json at all\n");
    const result = unwrap(withConnectMembers({ fetchedAtIso: FETCHED, home, listed: listedNow({ rows: [] }) }));
    expect(result.rows).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain("skipped user_profile recovery");
  });

  it("passes a failed users.list straight through, recovering nothing", () => {
    seedBronze({ authors: ["U0SYN000009"] });
    const failed = withConnectMembers({
      fetchedAtIso: FETCHED,
      home,
      listed: err<{ rows: readonly MemberBronzeRow[]; warnings: readonly string[] }, readonly string[]>([
        "slack member hydration failed: boom",
      ]),
    });
    expect(failed.isErr()).toBe(true);
    expect(unwrapErr(failed)).toEqual(["slack member hydration failed: boom"]);
  });

  it("recovers nothing when bronze carries no profile at all", () => {
    const result = unwrap(withConnectMembers({ fetchedAtIso: FETCHED, home, listed: listedNow({ rows: [] }) }));
    expect(result.rows).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("projects the recovered row the same way the pure projector does", () => {
    seedBronze({ authors: ["U0SYN000009"] });
    const result = unwrap(withConnectMembers({ fetchedAtIso: FETCHED, home, listed: listedNow({ rows: [] }) }));
    const expected = projectConnectMember({ fetchedAtIso: FETCHED, profile: PROFILE, userId: "U0SYN000009" })!;
    expect(result.rows[0]!.identity).toEqual(expected.identity);
    expect(result.rows[0]!.provenance).toEqual(expected.provenance);
  });
});
