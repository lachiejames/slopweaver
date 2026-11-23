import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runSlackOwed } from "../../../../../cli/commands/slack/owedRun.js";
import type { SlackSnapshotDeps } from "../../../../../cli/commands/slack/snapshotRun.js";
import { SLACK_OWED_USAGE } from "../../../../../cli/commands/slack/verbUsage.js";
import { stateHomePaths } from "../../../../../stateHome.js";

const NOW = "2026-09-26T00:00:00.000Z";
const OWNER = "U0SYNOWNER1234";
const HUMAN = "U0SYNHUMAN123";

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/**
 * A throwaway home with a profile and, when given, one Slack bronze window.
 *
 * @param ownerId the profile's declared owner id, absent to make the read unavailable
 * @param records the bronze rows to write
 * @returns the home's path
 */
function home({ ownerId, records }: { ownerId?: string; records: readonly Record<string, unknown>[] }): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-owedrun-"));
  homes.push(dir);
  mkdirSync(join(dir, "corpus", "bronze", "slack"), { recursive: true });
  writeFileSync(
    join(dir, "corpus", "bronze", "slack", "window.jsonl"),
    `${records.map((one) => JSON.stringify(one)).join("\n")}\n`,
  );
  writeFileSync(
    join(dir, "profile.json"),
    JSON.stringify({
      displayName: "",
      gitNamespace: "",
      id: "me",
      schemaVersion: 1,
      sources: [],
      ...(ownerId === undefined ? {} : { slackBot: { ownerUserId: ownerId, selfUserIds: [] } }),
    }),
  );
  return dir;
}

const message = ({ author, ts, tsIso }: { author: string; ts: string; tsIso: string }): Record<string, unknown> => ({
  attrs: { channel: "#a-channel" },
  author,
  container: "slack/C0SYNCHANNEL1",
  kind: "comment",
  source: "slack",
  sourceId: `C0SYNCHANNEL1:1790300000.000100:reply:${ts}`,
  text: "shipped it",
  tsIso,
  url: `https://example.slack.com/archives/C0SYNCHANNEL1/p${ts.replace(".", "")}`,
});

const MOVED = [
  message({ author: OWNER, ts: "1790300001.000100", tsIso: "2026-09-24T22:10:00.000Z" }),
  message({ author: HUMAN, ts: "1790300002.000100", tsIso: "2026-09-25T03:04:05.000Z" }),
];

/** Plain fakes for every edge, recording what was written. */
function fakes(): { deps: SlackSnapshotDeps; out: string[]; diagnostics: string[] } {
  const out: string[] = [];
  const diagnostics: string[] = [];
  return {
    deps: {
      clockIso: () => NOW,
      defaultHome: () => "/nonexistent/slopweaver-owedrun-default",
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: (line) => {
        out.push(line);
      },
    },
    diagnostics,
    out,
  };
}

describe("runSlackOwed", () => {
  it("prints usage for --help and exits 0 without reading anything", () => {
    const edges = fakes();
    expect(runSlackOwed({ deps: edges.deps, rest: ["--help"] })).toBe(0);
    expect(edges.out).toStrictEqual([SLACK_OWED_USAGE]);
  });

  it("refuses an unknown flag with the usage and exit 2", () => {
    const edges = fakes();
    expect(runSlackOwed({ deps: edges.deps, rest: ["--send"] })).toBe(2);
    expect(edges.diagnostics.at(-1)).toBe(SLACK_OWED_USAGE);
  });

  it("emits exactly one JSON document and writes nothing without --write", () => {
    const dir = home({ ownerId: OWNER, records: MOVED });
    const edges = fakes();
    expect(runSlackOwed({ deps: edges.deps, rest: ["--json", "--home", dir, "--now", NOW] })).toBe(0);
    expect(edges.out).toHaveLength(1);
    const document = JSON.parse(edges.out[0]!) as { threads: { nativeId: string; ownerLastWordAtIso: string }[] };
    expect(document.threads.map((row) => [row.nativeId, row.ownerLastWordAtIso])).toStrictEqual([
      ["C0SYNCHANNEL1:1790300000.000100", "2026-09-24T22:10:00.000Z"],
    ]);
    expect(existsSync(stateHomePaths({ home: dir }).live.slack.owedJson)).toBe(false);
  });

  it("persists under --write the same document --json prints", () => {
    const dir = home({ ownerId: OWNER, records: MOVED });
    const edges = fakes();
    expect(runSlackOwed({ deps: edges.deps, rest: ["--json", "--write", "--home", dir] })).toBe(0);
    const written = readFileSync(stateHomePaths({ home: dir }).live.slack.owedJson, "utf8");
    expect(JSON.parse(written)).toStrictEqual(JSON.parse(edges.out[0]!));
    expect((JSON.parse(written) as { observedAtIso: string }).observedAtIso).toBe(NOW);
  });

  it("ends the text rendering with the path it wrote", () => {
    const dir = home({ ownerId: OWNER, records: MOVED });
    const edges = fakes();
    expect(runSlackOwed({ deps: edges.deps, rest: ["--write", "--home", dir] })).toBe(0);
    expect(edges.out.at(-1)).toBe(`written: ${stateHomePaths({ home: dir }).live.slack.owedJson}`);
  });

  it("exits 1 on a read that could not see, and records it unavailable rather than empty", () => {
    const dir = home({ records: MOVED });
    const edges = fakes();
    expect(runSlackOwed({ deps: edges.deps, rest: ["--json", "--write", "--home", dir] })).toBe(1);
    const written = JSON.parse(readFileSync(stateHomePaths({ home: dir }).live.slack.owedJson, "utf8")) as {
      status: string;
      threads: unknown[];
    };
    expect(written.status).toBe("unavailable");
    expect(written.threads).toStrictEqual([]);
  });
});
