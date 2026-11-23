import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { appendSlackDraftEvent, slackDraftLogPath } from "../../../../../admit/slackDraftStore.js";
import { readFindingFollowups } from "../../../../../cli/commands/slack/findingFollowupsRead.js";
import { runSlackFindingFollowups } from "../../../../../cli/commands/slack/findingFollowupsRun.js";
import type { SlackSnapshotDeps } from "../../../../../cli/commands/slack/snapshotRun.js";
import { SLACK_FINDING_FOLLOWUPS_USAGE } from "../../../../../cli/commands/slack/verbUsage.js";
import {
  findingFollowupsDocument,
  renderFindingFollowupsJson,
} from "../../../../../live/slack/findingFollowupsDocument.js";
import { writeFindingFollowupsDocument } from "../../../../../live/slack/findingFollowupsStore.js";
import {
  type ParkedSlackDraft,
  parkedDraftDigest,
  type SlackDraftEvent,
} from "../../../../../outbound/slack/draftRegister.js";
import { stateHomePaths } from "../../../../../stateHome.js";

/** A Monday, 11:00 Melbourne. */
const NOW = "2026-10-19T00:00:00.000Z";
const OWNER = "U0SYNOWNER1234";
const BOT = "U0SYNBOT12345";
const HUMAN = "U0SYNHUMAN123";
const CHANNEL = "C0SYN000001";
/** Lands the Thursday before, 04:46:40 Melbourne: 54 business hours before {@link NOW}. */
const QUIET_TS = "1792000000.000100";
const STALLED_TS = "1792010000.000100";
const SPENT_TS = "1792020000.000100";

const dirs: string[] = [];

afterEach(() => {
  dirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/** One parked bot row in the shape the recorder writes. */
function draft({ id, kind, followupOf }: { id: string; kind?: "finding"; followupOf?: string }): ParkedSlackDraft {
  const content = {
    authorId: BOT,
    channel: CHANNEL,
    mentions: [],
    payload: { form: "plain" as const, text: "the words", unfurl_links: false, unfurl_media: false },
  };
  return {
    ...content,
    advisory: [],
    digest: parkedDraftDigest({ draft: content }),
    form: "{}",
    id,
    shape: "top-level",
    tsIso: "2026-10-14T17:00:00.000Z",
    why: `the ${id} row`,
    ...(kind === undefined ? {} : { kind }),
    ...(followupOf === undefined ? {} : { act: "bump" as const, followupOf }),
  };
}

/** A home holding three shared findings — one quiet, one stalled on an untimed ack, one whose card is spent. */
function homeWithFindings({ ownerId, members = true }: { ownerId?: string; members?: boolean }): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-findingfollowups-"));
  dirs.push(home);
  const events: SlackDraftEvent[] = [];
  for (const [id, ts] of [
    ["sd-aa000001", QUIET_TS],
    ["sd-aa000002", STALLED_TS],
    ["sd-aa000003", SPENT_TS],
  ] as const) {
    const row = draft({ id, kind: "finding" });
    events.push({ draft: row, id, kind: "parked", tsIso: row.tsIso });
    events.push({ channel: CHANNEL, id, kind: "released", ts, tsIso: "2026-10-14T18:00:00.000Z" });
  }
  const card = draft({ followupOf: "sd-aa000003", id: "sd-bb000001" });
  events.push({ draft: card, id: card.id, kind: "parked", tsIso: card.tsIso });
  for (const event of events) {
    expect(appendSlackDraftEvent({ event, home }).isOk()).toBe(true);
  }
  const reply = ({
    root,
    ts,
    tsIso,
    author,
    text,
  }: {
    root: string;
    ts: string;
    tsIso: string;
    author: string;
    text: string;
  }) => ({
    author,
    container: `slack/${CHANNEL}`,
    kind: "comment",
    raw: { text },
    source: "slack",
    sourceId: `${CHANNEL}:${root}:reply:${ts}`,
    text,
    tsIso,
    url: `https://example.slack.com/archives/${CHANNEL}/p${ts.replace(".", "")}`,
  });
  const bronze = join(home, "corpus", "bronze", "slack");
  mkdirSync(bronze, { recursive: true });
  writeFileSync(
    join(bronze, "window.jsonl"),
    [
      reply({
        author: BOT,
        root: QUIET_TS,
        text: "screenshots below",
        ts: "1792000001.000100",
        tsIso: "2026-10-14T17:46:41.000Z",
      }),
      reply({
        author: HUMAN,
        root: STALLED_TS,
        text: "thanks, looking into it",
        ts: "1792030000.000100",
        tsIso: "2026-10-15T00:00:00.000Z",
      }),
    ]
      .map((one) => `${JSON.stringify(one)}\n`)
      .join(""),
  );
  if (members) {
    mkdirSync(join(home, "corpus", "members"), { recursive: true });
    writeFileSync(
      join(home, "corpus", "members", "slack.jsonl"),
      `${JSON.stringify({
        fetchedAtIso: "2026-08-01T00:00:00.000Z",
        identity: { emailTrust: "missing", name: "A Colleague", nativeId: HUMAN, source: "slack" },
        profile: { bot: false },
        provenance: ["slack.users.list"],
        raw: {},
        source: "slack",
        sourceId: HUMAN,
        version: 1,
        warnings: [],
      })}\n`,
    );
  }
  const slackBot = ownerId === undefined ? {} : { slackBot: { ownerUserId: ownerId, selfUserIds: [BOT] } };
  writeFileSync(
    join(home, "profile.json"),
    JSON.stringify({ displayName: "", gitNamespace: "", id: "me", schemaVersion: 1, sources: [], ...slackBot }),
  );
  return home;
}

/** Plain fakes for the verb's edges. */
function edges(): { deps: SlackSnapshotDeps; out: string[] } {
  const out: string[] = [];
  return {
    deps: {
      clockIso: () => NOW,
      defaultHome: () => "/nonexistent/slopweaver-findingfollowups-default",
      writeDiagnostic: () => undefined,
      writeOut: (line) => {
        out.push(line);
      },
    },
    out,
  };
}

describe("runSlackFindingFollowups", () => {
  it("prints its own usage for --help", () => {
    const run = edges();
    expect(runSlackFindingFollowups({ deps: run.deps, rest: ["--help"] })).toBe(0);
    expect(run.out).toStrictEqual([SLACK_FINDING_FOLLOWUPS_USAGE]);
  });

  it("lists the quiet and the stalled finding, counts the spent one, and writes nothing without --write", () => {
    const home = homeWithFindings({ ownerId: OWNER });
    const run = edges();
    expect(runSlackFindingFollowups({ deps: run.deps, rest: ["--json", "--home", home] })).toBe(0);
    const document = JSON.parse(run.out[0]!) as {
      status: string;
      counts: { owed: number; quiet: number; stalled: number; cardSpent: number };
      followups: { findingId: string; verdict: string; businessHoursQuiet?: number; teamWord?: { authorId: string } }[];
    };
    expect(document.status).toBe("complete");
    expect([
      document.counts.owed,
      document.counts.quiet,
      document.counts.stalled,
      document.counts.cardSpent,
    ]).toStrictEqual([2, 1, 1, 1]);
    expect(
      document.followups.map((row) => [row.findingId, row.verdict, row.businessHoursQuiet, row.teamWord?.authorId]),
    ).toStrictEqual([
      ["sd-aa000001", "quiet", 54, undefined],
      ["sd-aa000002", "stalled", 48, HUMAN],
    ]);
    expect(existsSync(stateHomePaths({ home }).live.slack.findingFollowupsJson)).toBe(false);
  });

  it("keeps a card spent when a line the register cannot read names the row that spent it", () => {
    const home = homeWithFindings({ ownerId: OWNER });
    appendFileSync(
      slackDraftLogPath({ home }),
      `${JSON.stringify({ id: "sd-bb000001", kind: "future-event", tsIso: "2026-10-15T00:00:00.000Z" })}\n`,
    );
    const run = edges();
    expect(runSlackFindingFollowups({ deps: run.deps, rest: ["--json", "--home", home] })).toBe(1);
    const document = JSON.parse(run.out[0]!) as {
      status: string;
      counts: { owed: number; cardSpent: number };
      followups: { findingId: string }[];
    };
    expect([document.status, document.counts.owed, document.counts.cardSpent]).toStrictEqual(["incomplete", 2, 1]);
    expect(document.followups.map((row) => row.findingId)).toStrictEqual(["sd-aa000001", "sd-aa000002"]);
  });

  it("reads incomplete, never complete, when a finding is owed and the members index is absent", () => {
    const home = homeWithFindings({ members: false, ownerId: OWNER });
    const run = edges();
    expect(runSlackFindingFollowups({ deps: run.deps, rest: ["--json", "--home", home] })).toBe(1);
    const document = JSON.parse(run.out[0]!) as { status: string; coverage: { residue: string[] } };
    expect(document.status).toBe("incomplete");
    expect(document.coverage.residue[0]).toBe(
      "this home holds no Slack members index, so a bot in a finding's thread may read as a person",
    );
  });

  it("reads unavailable, never an unanswered thread, when a finding is owed and the home holds no Slack corpus", () => {
    const home = homeWithFindings({ ownerId: OWNER });
    rmSync(join(home, "corpus", "bronze", "slack"), { force: true, recursive: true });
    const run = edges();
    expect(runSlackFindingFollowups({ deps: run.deps, rest: ["--json", "--home", home] })).toBe(1);
    const document = JSON.parse(run.out[0]!) as {
      status: string;
      followups: unknown[];
      coverage: { residue: string[] };
    };
    expect([document.status, document.followups]).toStrictEqual(["unavailable", []]);
    expect(document.coverage.residue[0]).toBe(
      "this home holds no Slack corpus, so no reply in a finding's thread can be seen",
    );
  });

  // The register is the only door a finding leaves by, so a home that never parked a draft shared nothing.
  it("answers complete and empty on a home whose draft register was never written", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-findingfollowups-"));
    dirs.push(home);
    const run = edges();
    expect(runSlackFindingFollowups({ deps: run.deps, rest: ["--json", "--home", home] })).toBe(0);
    const document = JSON.parse(run.out[0]!) as { status: string; followups: unknown[] };
    expect([document.status, document.followups]).toStrictEqual(["complete", []]);
  });

  it("answers complete off the register alone when no finding is owed, with no owner id declared", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-findingfollowups-"));
    dirs.push(home);
    const row = draft({ id: "sd-aa000003", kind: "finding" });
    const card = draft({ followupOf: "sd-aa000003", id: "sd-bb000001" });
    for (const event of [
      { draft: row, id: row.id, kind: "parked", tsIso: row.tsIso },
      { channel: CHANNEL, id: row.id, kind: "released", ts: SPENT_TS, tsIso: "2026-10-14T18:00:00.000Z" },
      { draft: card, id: card.id, kind: "parked", tsIso: card.tsIso },
    ] satisfies SlackDraftEvent[]) {
      expect(appendSlackDraftEvent({ event, home }).isOk()).toBe(true);
    }
    writeFileSync(
      join(home, "profile.json"),
      JSON.stringify({ displayName: "", gitNamespace: "", id: "me", schemaVersion: 1, sources: [] }),
    );
    const run = edges();
    expect(runSlackFindingFollowups({ deps: run.deps, rest: ["--json", "--home", home] })).toBe(0);
    const document = JSON.parse(run.out[0]!) as { status: string; counts: { owed: number; cardSpent: number } };
    expect([document.status, document.counts.owed, document.counts.cardSpent]).toStrictEqual(["complete", 0, 1]);
  });

  it("persists an unavailable read as unavailable under --write and exits 1", () => {
    const home = homeWithFindings({});
    const run = edges();
    expect(runSlackFindingFollowups({ deps: run.deps, rest: ["--write", "--home", home] })).toBe(1);
    const path = stateHomePaths({ home }).live.slack.findingFollowupsJson;
    const written = JSON.parse(readFileSync(path, "utf8")) as { status: string; followups: unknown[] };
    expect([written.status, written.followups]).toStrictEqual(["unavailable", []]);
    expect(run.out.at(-1)).toBe(`written: ${path}`);
  });
});

describe("readFindingFollowups", () => {
  it("reads the owed findings and the spent card straight off the home, below the verb", () => {
    const read = readFindingFollowups({ home: homeWithFindings({ ownerId: OWNER }), nowIso: NOW });
    expect(read.status).toBe("complete");
    expect(read.owed.map((owed) => owed.finding.draftId)).toStrictEqual(["sd-aa000001", "sd-aa000002"]);
    expect(read.spent).toStrictEqual([{ by: ["sd-bb000001"], findingId: "sd-aa000003" }]);
  });
});

describe("writeFindingFollowupsDocument", () => {
  it("replaces the one document under the home and answers the path it wrote", () => {
    const home = homeWithFindings({ ownerId: OWNER });
    const document = findingFollowupsDocument({ nowIso: NOW, read: readFindingFollowups({ home, nowIso: NOW }) });
    const path = stateHomePaths({ home }).live.slack.findingFollowupsJson;
    const written = writeFindingFollowupsDocument({ document, home });
    expect(written.isOk()).toBe(true);
    expect(written._unsafeUnwrap().path).toBe(path);
    expect(JSON.parse(readFileSync(path, "utf8"))).toStrictEqual(JSON.parse(renderFindingFollowupsJson({ document })));
  });
});
