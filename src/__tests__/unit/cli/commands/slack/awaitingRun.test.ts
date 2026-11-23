import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runSlackAwaiting } from "../../../../../cli/commands/slack/awaitingRun.js";
import type { SlackSnapshotDeps } from "../../../../../cli/commands/slack/snapshotRun.js";
import { SLACK_AWAITING_USAGE } from "../../../../../cli/commands/slack/verbUsage.js";
import { stateHomePaths } from "../../../../../stateHome.js";

/** A Tuesday morning in Melbourne — 25 business hours after the owner's question below, inside the chase wait. */
const TUESDAY = "2026-09-29T01:00:00.000Z";
/** A Wednesday morning in Melbourne — 49 business hours after it, past the two-business-day wait. */
const WEDNESDAY = "2026-09-30T01:00:00.000Z";
const OWNER = "U0SYNOWNER1234";
const HUMAN = "U0SYNHUMAN123";

const dirs: string[] = [];

afterEach(() => {
  dirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/**
 * A home holding one thread: a colleague's word, then the owner's tagged question nobody has answered.
 *
 * @param ownerId the profile's owner id, absent to make the read unavailable
 * @returns the home's path
 */
function homeWithQuietAsk({ ownerId }: { ownerId?: string }): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-awaitingrun-"));
  dirs.push(dir);
  const reply = ({ author, ts, tsIso, text }: { author: string; ts: string; tsIso: string; text: string }) => ({
    author,
    container: "slack/C0SYNCHANNEL1",
    kind: "comment",
    raw: { text },
    source: "slack",
    sourceId: `C0SYNCHANNEL1:1790500000.000100:reply:${ts}`,
    text,
    tsIso,
    url: `https://example.slack.com/archives/C0SYNCHANNEL1/p${ts.replace(".", "")}`,
  });
  const bronze = join(dir, "corpus", "bronze", "slack");
  mkdirSync(bronze, { recursive: true });
  writeFileSync(
    join(bronze, "window.jsonl"),
    [
      reply({ author: HUMAN, text: "looking into it", ts: "1790500001.000100", tsIso: "2026-09-27T23:00:00.000Z" }),
      reply({
        author: OWNER,
        text: `<@${HUMAN}> any update?`,
        ts: "1790500002.000100",
        tsIso: "2026-09-28T00:00:00.000Z",
      }),
    ]
      .map((one) => `${JSON.stringify(one)}\n`)
      .join(""),
  );
  const slackBot = ownerId === undefined ? {} : { slackBot: { ownerUserId: ownerId, selfUserIds: [] } };
  writeFileSync(
    join(dir, "profile.json"),
    JSON.stringify({ displayName: "", gitNamespace: "", id: "me", schemaVersion: 1, sources: [], ...slackBot }),
  );
  return dir;
}

/**
 * Plain fakes for the verb's edges.
 *
 * @param nowIso the instant the verb's clock reads
 * @returns the deps, and the lines it wrote out
 */
function edges({ nowIso = WEDNESDAY }: { nowIso?: string } = {}): { deps: SlackSnapshotDeps; out: string[] } {
  const out: string[] = [];
  return {
    deps: {
      clockIso: () => nowIso,
      defaultHome: () => "/nonexistent/slopweaver-awaitingrun-default",
      writeDiagnostic: () => undefined,
      writeOut: (line) => {
        out.push(line);
      },
    },
    out,
  };
}

describe("runSlackAwaiting", () => {
  it("prints its own usage for --help", () => {
    const run = edges();
    expect(runSlackAwaiting({ deps: run.deps, rest: ["--help"] })).toBe(0);
    expect(run.out).toStrictEqual([SLACK_AWAITING_USAGE]);
  });

  it("lists the thread quiet on the owner's ask as one JSON document, and writes nothing without --write", () => {
    const home = homeWithQuietAsk({ ownerId: OWNER });
    const run = edges();
    expect(runSlackAwaiting({ deps: run.deps, rest: ["--json", "--home", home] })).toBe(0);
    const document = JSON.parse(run.out[0]!) as {
      threads: { nativeId: string; businessHoursQuiet: number; people: { id: string; tagged: boolean }[] }[];
    };
    expect(
      document.threads.map((row) => [
        row.nativeId,
        row.businessHoursQuiet,
        row.people.map((one) => [one.id, one.tagged]),
      ]),
    ).toStrictEqual([["C0SYNCHANNEL1:1790500000.000100", 49, [[HUMAN, true]]]]);
    expect(existsSync(stateHomePaths({ home }).live.slack.awaitingJson)).toBe(false);
  });

  it("holds an ask 25 business hours old out of the worklist, counted as inside the chase wait", () => {
    const home = homeWithQuietAsk({ ownerId: OWNER });
    const run = edges({ nowIso: TUESDAY });
    expect(runSlackAwaiting({ deps: run.deps, rest: ["--json", "--home", home] })).toBe(0);
    const document = JSON.parse(run.out[0]!) as {
      counts: { awaiting: number; insideChaseWait: number };
      threads: unknown[];
    };
    expect([document.threads, document.counts.awaiting, document.counts.insideChaseWait]).toStrictEqual([[], 0, 1]);
  });

  it("persists an unavailable read as unavailable under --write and exits 1", () => {
    const home = homeWithQuietAsk({});
    const run = edges();
    expect(runSlackAwaiting({ deps: run.deps, rest: ["--write", "--home", home] })).toBe(1);
    const written = JSON.parse(readFileSync(stateHomePaths({ home }).live.slack.awaitingJson, "utf8")) as {
      status: string;
      threads: unknown[];
    };
    expect([written.status, written.threads]).toStrictEqual(["unavailable", []]);
    expect(run.out.at(-1)).toBe(`written: ${stateHomePaths({ home }).live.slack.awaitingJson}`);
  });
});
