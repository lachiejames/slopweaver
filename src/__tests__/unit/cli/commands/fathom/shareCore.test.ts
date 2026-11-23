/**
 * Unit: `fathom share` end to end over a throwaway home, with the page and the store as plain injected
 * fakes. What is pinned is the replacement the owner asked for: the hand-written `share:<token>` row — with
 * its action items — is gone from bronze, the verb's recording-id row is there instead, unrelated rows
 * survive, a re-run changes nothing, and a failed page read writes nothing at all.
 */
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type FathomShareDeps,
  type FathomStoreLegReport,
  ingestNewShares,
  settleFathomStore,
  shareOne,
} from "../../../../../cli/commands/fathom/shareCore.js";
import { readShareTokens } from "../../../../../corpus/fathom/shareBronze.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";

const TOKEN = "cPAstBybUhyaoL9wD_xuMQK_byssuMG_";
const ADDRESS = { token: TOKEN, url: `https://fathom.video/share/${TOKEN}` };

const PAGE = {
  finalUrl: ADDRESS.url,
  read: {
    attendees: [{ email: "felix@vendor.test", name: "Felix" }],
    call: {
      hostEmail: "felix@vendor.test",
      id: 832123640,
      recordingStartedAt: "2026-09-23T00:59:39.542238Z",
      scheduledStartAt: null,
      title: "Compliance weekly",
    },
    cues: [{ email: "felix@vendor.test", speaker: "Felix", startSeconds: 4, text: "Shall we start?" }],
    droppedNotes: 2,
    present: true,
    ready: true,
  },
  title: "Compliance weekly",
};

/** The row a session once wrote by hand: keyed on the token, carrying Fathom's action items. */
const LEGACY = {
  attrs: { actionItems: ["Ada to send the DPA"], shareToken: TOKEN },
  container: "fathom/meetings",
  kind: "transcript",
  source: "fathom",
  sourceId: `share:${TOKEN}`,
  text: "[ACTION ITEM] Ada to send the DPA\nFelix: Shall we start?",
  tsIso: "2026-09-23T00:00:00.000Z",
  url: ADDRESS.url,
  visibility: "private",
};

/** An API-lane row that must survive the rewrite untouched. */
const UNRELATED = { ...LEGACY, attrs: {}, sourceId: "181678451", text: "[00:00:01] the owner: hello" };

let home: string;
let bronze: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "fathom-share-"));
  bronze = join(home, "corpus", "bronze", "fathom");
  mkdirSync(bronze, { recursive: true });
  writeFileSync(
    join(bronze, "2026-09-03_2026-09-23.jsonl"),
    `${JSON.stringify(LEGACY)}\n${JSON.stringify(UNRELATED)}\n${JSON.stringify(LEGACY)}\n`,
  );
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Every bronze line of the fathom source, parsed. */
function bronzeRows(): readonly Record<string, unknown>[] {
  return readdirSync(bronze)
    .toSorted()
    .flatMap((name) =>
      readFileSync(join(bronze, name), "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    );
}

/** A page read that answers at once; the fakes below wrap it into the deps' asynchronous shape. */
type PageRead = (args: { home: string; url: string }) => Awaited<ReturnType<FathomShareDeps["readPage"]>>;

/** Fakes that answer with the given page and record what the store leg was asked; `failFirst` fails its first leg. */
function fakes({ page, failFirst = false }: { page: PageRead; failFirst?: boolean }): {
  deps: FathomShareDeps;
  retired: string[][];
} {
  const retired: string[][] = [];
  const report: FathomStoreLegReport = { retired: 1, stored: 2 };
  let failing = failFirst;
  return {
    deps: {
      readPage: (args) => Promise.resolve(page(args)),
      storeLeg: ({ retire }) => {
        retired.push([...retire]);
        if (failing) {
          failing = false;
          return Promise.resolve(err(["the store is not running"]));
        }
        return Promise.resolve(ok(report));
      },
    },
    retired,
  };
}

const OTHER = "ePiRerJ33vCHFeZ1c5dDfMcAniBsMiYm";
const OTHER_ADDRESS = { token: OTHER, url: `https://fathom.video/share/${OTHER}` };
const OTHER_PAGE = {
  ...PAGE,
  finalUrl: OTHER_ADDRESS.url,
  read: { ...PAGE.read, call: { ...PAGE.read.call, id: 771000001 } },
};
const OTHER_LEGACY = {
  ...LEGACY,
  attrs: { actionItems: ["Chase the DPA"], shareToken: OTHER },
  sourceId: `share:${OTHER}`,
};

/** A page reader answering each share address with its own page. */
const pageByUrl: PageRead = ({ url }) => ok(url === OTHER_ADDRESS.url ? OTHER_PAGE : PAGE);

describe("shareOne", () => {
  it("stores the recording-id row and removes every version of the hand-written one", async () => {
    const { deps, retired } = fakes({ page: () => ok(PAGE) });
    const outcome = unwrap(await shareOne({ address: ADDRESS, deps, dryRun: false, home, store: true }));
    expect(outcome.written).toBe(true);
    expect(outcome.handWrittenLinesRemoved).toBe(2);
    expect(outcome.providerNotesDropped).toBe(2);
    expect(bronzeRows().map((row) => row["sourceId"])).toEqual(["181678451", "832123640"]);
    expect(bronzeRows().filter((row) => String(row["text"]).includes("ACTION ITEM"))).toEqual([]);
    expect(retired).toEqual([[`share:${TOKEN}`]]);
    expect([...unwrap(readShareTokens({ home, protection: () => ok([]) }))]).toEqual([TOKEN]);
  });

  it("refuses to read the held tokens when the protect list marks fathom bronze no-access", () => {
    const entry = { addedIso: "2026-01-01T00:00:00.000Z", mode: "no-access" as const, path: bronze, why: "fixture" };

    expect(unwrapErr(readShareTokens({ home, protection: () => ok([entry]) }))).toEqual([
      `refusing to read fathom: it would search ${bronze}, which the owner's protect list marks no-access at ${bronze} (fixture)`,
    ]);
  });

  it("withholds the store replay while another call's hand-written row is still in bronze", async () => {
    const other = "ePiRerJ33vCHFeZ1c5dDfMcAniBsMiYm";
    const otherRow = {
      ...LEGACY,
      attrs: { actionItems: ["Chase the DPA"], shareToken: other },
      sourceId: `share:${other}`,
    };
    writeFileSync(join(bronze, "2026-09-01_2026-09-02.jsonl"), `${JSON.stringify(otherRow)}\n`);
    const { deps, retired } = fakes({ page: () => ok(PAGE) });
    const outcome = unwrap(await shareOne({ address: ADDRESS, deps, dryRun: false, home, store: true }));
    expect(outcome.storeWithheldFor).toEqual([other]);
    expect(outcome.store).toBe(null);
    expect(retired).toEqual([]);
    expect(bronzeRows().map((row) => row["sourceId"])).toEqual([`share:${other}`, "181678451", "832123640"]);
  });

  it("changes nothing on a second run over the same page", async () => {
    const { deps } = fakes({ page: () => ok(PAGE) });
    await shareOne({ address: ADDRESS, deps, dryRun: false, home, store: false });
    const second = unwrap(await shareOne({ address: ADDRESS, deps, dryRun: false, home, store: false }));
    expect(second.written).toBe(false);
    expect(second.handWrittenLinesRemoved).toBe(0);
    expect(second.store).toBe(null);
    expect(bronzeRows().map((row) => row["sourceId"])).toEqual(["181678451", "832123640"]);
  });

  it("writes nothing on a dry run", async () => {
    const { deps, retired } = fakes({ page: () => ok(PAGE) });
    const outcome = unwrap(await shareOne({ address: ADDRESS, deps, dryRun: true, home, store: true }));
    expect(outcome.dryRun).toBe(true);
    expect(bronzeRows().map((row) => row["sourceId"])).toEqual([`share:${TOKEN}`, "181678451", `share:${TOKEN}`]);
    expect(retired).toEqual([]);
  });

  it("writes nothing and keeps the old row when the page shows a sign-in wall", async () => {
    const wall = { ...PAGE, finalUrl: `https://fathom.video/users/sign_in?share_token=${TOKEN}` };
    const { deps, retired } = fakes({ page: () => ok(wall) });
    const outcome = await shareOne({ address: ADDRESS, deps, dryRun: false, home, store: true });
    expect(outcome._unsafeUnwrapErr().code).toBe("PAGE_REFUSED");
    expect(outcome._unsafeUnwrapErr().message).toContain("NOT_SHOWN");
    expect(bronzeRows()).toHaveLength(3);
    expect(retired).toEqual([]);
  });

  it("carries a relay setup failure through as its own lines", async () => {
    const { deps } = fakes({ page: () => err(["no extension token is stored"]) });
    const outcome = await shareOne({ address: ADDRESS, deps, dryRun: false, home, store: true });
    expect(outcome._unsafeUnwrapErr()).toEqual({ code: "PAGE_UNREAD", message: "no extension token is stored" });
  });
});

describe("settling the store across shares", () => {
  it("retires EVERY replaced hand-written identity on the replay the last share runs, not only its own", async () => {
    writeFileSync(join(bronze, "2026-09-01_2026-09-02.jsonl"), `${JSON.stringify(OTHER_LEGACY)}\n`);
    const { deps, retired } = fakes({ page: pageByUrl });
    const first = unwrap(await shareOne({ address: ADDRESS, deps, dryRun: false, home, store: true }));
    expect(first.storeWithheldFor).toEqual([OTHER]);
    const last = unwrap(await shareOne({ address: OTHER_ADDRESS, deps, dryRun: false, home, store: true }));
    expect(last.store).toEqual({ retired: 1, stored: 2 });
    expect(retired).toEqual([[`share:${TOKEN}`, `share:${OTHER}`]]);
  });

  it("removes a hand-written row a run left beside its verb-read row when it died after the commit", async () => {
    const { deps, retired } = fakes({ page: () => ok(PAGE) });
    await shareOne({ address: ADDRESS, deps, dryRun: false, home, store: false });
    appendFileSync(join(bronze, "2026-09-03_2026-09-23.jsonl"), `${JSON.stringify(LEGACY)}\n`);
    const settled = unwrap(await settleFathomStore({ deps, home }));
    expect(settled.store).toEqual({ retired: 1, stored: 2 });
    expect(bronzeRows().map((row) => row["sourceId"])).toEqual(["181678451", "832123640"]);
    expect(retired).toEqual([[`share:${TOKEN}`]]);
  });
});

describe("ingestNewShares", () => {
  it("repairs a share whose store leg failed on an earlier pass, though discovery now calls it held", async () => {
    const { deps, retired } = fakes({ failFirst: true, page: () => ok(PAGE) });
    const failed = await shareOne({ address: ADDRESS, deps, dryRun: false, home, store: true });
    expect(failed._unsafeUnwrapErr().code).toBe("STORE_LEG_FAILED");
    const report = await ingestNewShares({ deps, home, shares: [{ held: true, url: ADDRESS.url }] });
    expect(report).toEqual({
      failures: [],
      outcomes: [],
      settle: { store: { retired: 1, stored: 2 }, storeWithheldFor: [] },
    });
    expect(retired).toEqual([[`share:${TOKEN}`], [`share:${TOKEN}`]]);
  });

  it("reads only the shares not yet held, and carries on past a bad link with its reason", async () => {
    const { deps, retired } = fakes({ page: () => ok(PAGE) });
    const report = await ingestNewShares({
      deps,
      home,
      shares: [
        { held: true, url: "https://fathom.video/share/heldheldheldheldheldheld" },
        { held: false, url: "https://example.test/share/not-fathom" },
        { held: false, url: ADDRESS.url },
      ],
    });
    expect(report.outcomes.map((outcome) => outcome.recordingId)).toEqual([832123640]);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toContain("is not a Fathom share link");
    expect(retired).toEqual([[`share:${TOKEN}`]]);
  });

  it("reports a failed page read as its message and stores nothing", async () => {
    const { deps } = fakes({ page: () => err(["no extension token is stored"]) });
    const report = await ingestNewShares({ deps, home, shares: [{ held: false, url: ADDRESS.url }] });
    expect(report).toEqual({
      failures: ["no extension token is stored"],
      outcomes: [],
      settle: { store: null, storeWithheldFor: [TOKEN] },
    });
    expect(bronzeRows()).toHaveLength(3);
  });
});
