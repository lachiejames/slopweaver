import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { lookPicture } from "../../../../../cli/commands/hand/postLook.js";
import { pullPageOf, readRowPullRequests } from "../../../../../cli/commands/hand/rowPullRequestsRead.js";
import type { ReadShot } from "../../../../../hand/shotStore.js";
import { ok } from "../../../../../lib/result.js";

const SHA = "a".repeat(64);

describe("lookPicture", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "post-look-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("carries the look's picture as a shot with no boxes when no earlier posting holds one", () => {
    const taken: ReadShot = { bytes: Buffer.from("png"), height: 800, sha256: SHA, width: 1280 };
    expect(lookPicture({ home, id: "ask-1", taken })).toEqual({
      read: taken,
      shot: { boxes: [], height: 800, sha256: SHA, width: 1280 },
    });
  });

  it("carries nothing when the look took no picture", () => {
    expect(lookPicture({ home, id: "ask-1", taken: undefined })).toBe(undefined);
  });
});

describe("readRowPullRequests", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "row-pulls-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("answers unread, naming the row, when the board holds no such row — and asks GitHub nothing", async () => {
    const asked: string[] = [];
    const answer = await readRowPullRequests({
      graphql: ({ variables }) => {
        asked.push(String(variables["head"]));
        return Promise.resolve(ok({}));
      },
      home,
      row: "no-such-row",
    });
    expect(answer).toEqual({ kind: "unread", why: `no board row no-such-row under ${join(home, "handovers")}` });
    expect(asked).toEqual([]);
  });
});

describe("pullPageOf", () => {
  const page = ({ more }: { more: unknown }): unknown => ({
    repository: {
      pullRequests: {
        nodes: [{ number: 3784, state: "OPEN", url: "https://github.com/acme/widget/pull/3784" }],
        pageInfo: { hasNextPage: more },
      },
    },
  });

  it("reads a whole page as its pull requests with nothing past it", () => {
    expect(pullPageOf({ value: page({ more: false }) })).toEqual({
      more: false,
      pulls: [{ number: 3784, state: "OPEN", url: "https://github.com/acme/widget/pull/3784" }],
    });
  });

  it("says when GitHub holds more past the page, so the caller cannot read it as all of them", () => {
    expect(pullPageOf({ value: page({ more: true }) })).toEqual({
      more: true,
      pulls: [{ number: 3784, state: "OPEN", url: "https://github.com/acme/widget/pull/3784" }],
    });
  });

  it("refuses a page that does not say whether more lie past it", () => {
    expect(pullPageOf({ value: page({ more: undefined }) })).toBe(undefined);
  });
});
