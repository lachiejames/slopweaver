import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { slackOwedDocument } from "../../../../live/slack/owedDocument.js";
import {
  readSlackOwedDocument,
  SlackOwedStoreErrors,
  writeSlackOwedDocument,
} from "../../../../live/slack/owedStore.js";
import { stateHomePaths } from "../../../../stateHome.js";

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

const freshHome = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-owedstore-"));
  homes.push(dir);
  return dir;
};

const documentAt = ({ nowIso }: { nowIso: string }) =>
  slackOwedDocument({
    nowIso,
    read: {
      couldNotSee: ["the corpus's own copy"],
      movedWithoutOwner: 0,
      movementThreads: [],
      status: "complete",
      taggedWithoutOwner: 0,
      threadsSpokenIn: 0,
      windowDays: 14,
    },
  });

describe("writeSlackOwedDocument", () => {
  it("writes to the declared state path and reads back as the same document", () => {
    const home = freshHome();
    const document = documentAt({ nowIso: "2026-09-26T00:00:00.000Z" });
    const written = unwrap(writeSlackOwedDocument({ document, home }));
    expect(written.path).toBe(stateHomePaths({ home }).live.slack.owedJson);
    expect(written.path).toBe(join(home, "live", "slack", "owed.json"));
    expect(JSON.parse(readFileSync(written.path, "utf8"))).toStrictEqual(document);
  });

  it("replaces the previous document rather than appending to it", () => {
    const home = freshHome();
    unwrap(writeSlackOwedDocument({ document: documentAt({ nowIso: "2026-09-25T00:00:00.000Z" }), home }));
    const second = documentAt({ nowIso: "2026-09-26T00:00:00.000Z" });
    const written = unwrap(writeSlackOwedDocument({ document: second, home }));
    expect(JSON.parse(readFileSync(written.path, "utf8"))).toStrictEqual(second);
  });
});

describe("readSlackOwedDocument", () => {
  it("reads back exactly the document the writer wrote", () => {
    const home = freshHome();
    const document = documentAt({ nowIso: "2026-09-26T00:00:00.000Z" });
    unwrap(writeSlackOwedDocument({ document, home }));
    expect(unwrap(readSlackOwedDocument({ home }))).toStrictEqual(document);
  });

  it("names a document never written as missing, never as an empty read", () => {
    const home = freshHome();
    const path = stateHomePaths({ home }).live.slack.owedJson;
    expect(unwrapErr(readSlackOwedDocument({ home }))).toStrictEqual(SlackOwedStoreErrors.missing({ path }));
  });

  it("names a path it cannot read as unreadable", () => {
    const home = freshHome();
    const path = stateHomePaths({ home }).live.slack.owedJson;
    mkdirSync(path, { recursive: true });
    const failure = unwrapErr(readSlackOwedDocument({ home }));
    expect(failure.code).toBe("SLACK_OWED_UNREADABLE");
    expect(failure.message).toContain("EISDIR");
  });

  it("refuses bytes that are not JSON, and leaves them exactly as they were", () => {
    const home = freshHome();
    const path = stateHomePaths({ home }).live.slack.owedJson;
    mkdirSync(join(home, "live", "slack"), { recursive: true });
    writeFileSync(path, "{not json");
    const failure = unwrapErr(readSlackOwedDocument({ home }));
    expect(failure.code).toBe("SLACK_OWED_INVALID");
    expect(failure.message).toContain("not JSON");
    expect(readFileSync(path, "utf8")).toBe("{not json");
  });

  it("refuses JSON the strict schema does not accept, naming the field", () => {
    const home = freshHome();
    const path = stateHomePaths({ home }).live.slack.owedJson;
    const document = documentAt({ nowIso: "2026-09-26T00:00:00.000Z" });
    mkdirSync(join(home, "live", "slack"), { recursive: true });
    writeFileSync(path, JSON.stringify({ ...document, status: "fine" }));
    expect(unwrapErr(readSlackOwedDocument({ home }))).toStrictEqual(
      SlackOwedStoreErrors.invalid({
        issues: ['status: Invalid option: expected one of "complete"|"incomplete"|"unavailable"'],
        path,
      }),
    );
  });
});
