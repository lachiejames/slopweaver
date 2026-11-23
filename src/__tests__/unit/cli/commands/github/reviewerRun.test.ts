/*
 * `github reviewer list|pick|read|backfill` driven end to end through injected seams: the list join, every exit
 * code a harness reads, a pick that writes exactly one row and sends nothing, a read whose quote and link are
 * checked against the message before its one row is written, and a backfill that writes only under --apply
 * and never an ask whose teams GitHub did not answer.
 */
import { describe, expect, it } from "vitest";

import { GithubVerbErrors, type GithubVerbResult } from "../../../../../cli/commands/github/errors.js";
import { type ReviewAskError, ReviewAskErrors } from "../../../../../cli/commands/github/reviewAskErrors.js";
import type { ParkedAsk } from "../../../../../cli/commands/github/reviewerAsk.js";
import type { ReviewerBackfillDeps } from "../../../../../cli/commands/github/reviewerBackfillRun.js";
import type { ReadMessage } from "../../../../../cli/commands/github/reviewerCore.js";
import { GithubReviewerErrors } from "../../../../../cli/commands/github/reviewerErrors.js";
import { type GithubReviewerDeps, runGithubReviewer } from "../../../../../cli/commands/github/reviewerRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { CorpusRecord } from "../../../../../corpus/types.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import type { SlackDraftItem } from "../../../../../outbound/slack/draftRegister.js";
import { ReadingsErrors } from "../../../../../readings/errors.js";
import type { Reading } from "../../../../../readings/types.js";
import { findPrLinkSpans, firstLinkStart, mentionRunsIn } from "../../../../../review/prLink.js";
import {
  type ReviewerAskedRow,
  ReviewerRegisterErrors,
  type ReviewerRow,
} from "../../../../../review/reviewerRegister.js";
import type { SlackMention } from "../../../../../review/slackEvidenceTypes.js";
import { type IdentityRosterError, IdentityRosterErrors } from "../../../../../silver/identityRosterErrors.js";

/** The pull request every pick here is on. */
const PR_URL = "https://github.com/acme/acme-admin/pull/17013";

/**
 * One held draft in the register, linking the pull request, addressed to `channel`.
 *
 * @returns the register item
 */
const STORE_DOWN = IdentityRosterErrors.storeUnavailable({ doing: "read the roster", reason: "disk full" });

function heldDraft({ id, channel }: { id: string; channel: string }): SlackDraftItem {
  return {
    draft: {
      advisory: [],
      channel,
      digest: "d",
      form: "{}",
      id,
      mentions: [],
      payload: {
        form: "plain",
        text: `hey, could I grab a review on <${PR_URL}|bump undici #17013>`,
        unfurl_links: true,
        unfurl_media: true,
      },
      shape: "top-level",
      tsIso: "2026-09-24T01:00:00.000Z",
      why: "w",
    },
    id,
    state: "held",
  };
}

const ASK = {
  atIso: "2026-09-23T04:46:00.000Z",
  channel: "#dev-alerts",
  isDirectMessage: false,
  leg: "corpus",
  messageKey: "C1:2",
  permalink: "https://acme.slack.com/archives/C1/p2",
  recipients: ["U0ROSA"],
} as const;

/** A landing reading with one asked row and one nobody-asked row. */
const READING: Reading = {
  document: {
    logins: { octocat: "U0SYNADAOWN" },
    people: { U0ROSA: { name: "Rosa" } },
    rows: [
      {
        askTrail: [ASK],
        authorLogin: "octocat",
        blockedOn: ["@acme/security"],
        number: 17012,
        repoSlug: "acme/acme-admin",
        slack: { asked: "yes", why: "" },
        stack: { stacked: false },
        tests: [],
        title: "bump fast-xml-parser",
        url: "https://github.com/acme/acme-admin/pull/17012",
      },
      {
        askTrail: [],
        authorLogin: "octocat",
        blockedOn: ["@acme/security"],
        number: 17013,
        repoSlug: "acme/acme-admin",
        slack: { asked: "no", why: "" },
        stack: { stacked: false },
        tests: [],
        title: "bump undici",
        url: "https://github.com/acme/acme-admin/pull/17013",
      },
    ],
  },
  record: {
    by: "tick-1",
    bytes: 1,
    file: "f.json",
    observedAtIso: "2026-09-24T00:00:00.000Z",
    producer: "github landing",
    readingId: "2026-09-24T00:00:01.000Z-github-landing",
    recordedAtIso: "2026-09-24T00:00:01.000Z",
  },
};

/** An earlier ask of Pranav on another security-owned pull request. */
const EARLIER: ReviewerRow = {
  atIso: "2026-09-10T00:00:00.000Z",
  authorLogin: "octocat",
  channel: "#dev-alerts",
  codeOwnerTeams: ["@acme/security"],
  isDirectMessage: false,
  kind: "asked",
  messageKey: "C1:9",
  names: { U0PRANAV: "Pranav" },
  number: 16900,
  permalink: "https://acme.slack.com/archives/C1/p9",
  prKey: "acme/acme-admin#16900",
  recipients: ["U0PRANAV"],
  recordedAtIso: "2026-09-10T00:00:00.000Z",
  repoSlug: "acme/acme-admin",
  schema: 1,
};

/** The owner's batch message asking two people about one pull request among others. */
const BATCH: ReadMessage = {
  atIso: "2026-09-23T08:28:21.000Z",
  channelId: "C0SYN000007",
  threadTexts: ["an older root"],
  text:
    "<@U0JASPER> <@U0JONAH> got another batch of these • <https://github.com/acme/acme-admin/pull/17013|#17013> " +
    "• <https://github.com/acme/acme-admin/pull/170130|#170130>",
  ts: "1790152101.764139",
};

/** One `parkAsk` call, as the verb made it. */
interface ParkCall {
  readonly channel: string;
  readonly form: string;
  readonly why: string;
}

/** What one run printed, appended and parked. */
interface Harness {
  readonly deps: GithubReviewerDeps;
  readonly out: string[];
  readonly diagnostics: string[];
  readonly appended: ReviewerRow[][];
  readonly parked: ParkCall[];
  /** Every lock key taken, then `released <key>` as each is let go. */
  readonly locks: string[];
}

/** The ask a fake park answers with. */
const PARKED: ParkedAsk = { consoleUrl: "http://localhost:3000/queue?open=post%3Asd-1", draftId: "sd-1" };

/** A backfill whose corpus holds nothing — the list, pick and read tests never reach it. */
const NO_BACKFILL: ReviewerBackfillDeps = {
  codeownerTeams: () => Promise.resolve(ok([])),
  corpusMentions: () => ok([]),
  githubRecords: () => ok([]),
};

/** Plain fakes over one reading and one register. */
function harness({
  reading = ok(READING),
  register = ok([EARLIER]),
  message = ok(BATCH),
  drafts = [],
  dmUsers = new Map(),
  park = ok(PARKED),
  lockBusy = undefined,
  backfill = NO_BACKFILL,
  rosterNames = new Map([["U0SADIE", "Sadie"]]),
  rosterDown = undefined,
}: {
  reading?: Result<Reading, ReturnType<typeof ReadingsErrors.noReading>>;
  register?: Result<readonly ReviewerRow[], ReturnType<typeof ReviewerRegisterErrors.unreadable>>;
  message?: GithubVerbResult<ReadMessage>;
  drafts?: readonly SlackDraftItem[];
  dmUsers?: ReadonlyMap<string, string>;
  park?: Result<ParkedAsk, ReviewAskError>;
  lockBusy?: string | undefined;
  backfill?: ReviewerBackfillDeps;
  rosterNames?: ReadonlyMap<string, string>;
  /** When set, the identity roster's store answers every read with this refusal. */
  rosterDown?: IdentityRosterError | undefined;
} = {}): Harness {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const appended: ReviewerRow[][] = [];
  const parked: ParkCall[] = [];
  const locks: string[] = [];
  return {
    appended,
    deps: {
      lockAsk: ({ key }) => {
        if (lockBusy !== undefined) {
          return err(lockBusy);
        }
        locks.push(key);
        return ok({ release: () => locks.push(`released ${key}`) });
      },
      appendRows: ({ rows }) => {
        appended.push([...rows]);
        return ok({ appended: rows.length, path: "/home/ledgers/reviewers.jsonl" });
      },
      backfill,
      excludedIds: () => new Set(["U0SYNADAOWN"]),
      dmUser: ({ channel }) => Promise.resolve(dmUsers.get(channel)),
      draftUrl: ({ id }) => Promise.resolve(`http://localhost:3000/queue?open=post%3A${id}`),
      drafts: () => drafts,
      rosterNames: async () => {
        if (rosterDown !== undefined) {
          return err(rosterDown);
        }
        return ok(rosterNames);
      },
      samePerson: async () => {
        if (rosterDown !== undefined) {
          return err(rosterDown);
        }
        return ok(new Map());
      },
      lastLanding: () => reading,
      now: () => "2026-09-24T02:00:00.000Z",
      parkAsk: ({ channel, form, why }) => {
        parked.push({ channel, form, why });
        return Promise.resolve(park);
      },
      readMessage: () => Promise.resolve(message),
      readRegister: () => register,
      writeDiagnostic: (line) => {
        diagnostics.push(line);
      },
      writeOut: (line) => {
        out.push(line);
      },
    },
    diagnostics,
    locks,
    out,
    parked,
  };
}

describe("github reviewer list", () => {
  it("joins the reading with the register: the ask on one row, a suggestion on the other", async () => {
    const run = harness();
    expect(await runGithubReviewer({ deps: run.deps, rest: ["list", "--json"] })).toBe(EXIT_OK);
    const document = JSON.parse(run.out[0]!) as {
      readingId: string;
      registerAsks: number;
      people: Record<string, string>;
      rows: { number: number; hook: { kind: string }; suggestion?: { primary: { reviewer: string; tier: string } } }[];
    };
    expect([document.readingId, document.registerAsks, document.people]).toEqual([
      "2026-09-24T00:00:01.000Z-github-landing",
      1,
      { U0PRANAV: "Pranav", U0ROSA: "Rosa" },
    ]);
    expect(document.rows.map((row) => [row.number, row.hook.kind, row.suggestion?.primary.reviewer])).toEqual([
      [17012, "asked", undefined],
      [17013, "nobody-asked", "U0PRANAV"],
    ]);
  });

  it("renders one line per pull request, and the suggestion under the one that has it", async () => {
    const run = harness();
    expect(await runGithubReviewer({ deps: run.deps, rest: ["list"] })).toBe(EXIT_OK);
    expect(run.out.slice(1)).toEqual([
      "acme/acme-admin#17012  asked Rosa (U0ROSA) #dev-alerts 2026-09-23T04:46:00.000Z",
      "acme/acme-admin#17013  nobody asked in Slack yet",
      "    suggest Pranav (U0PRANAV) — you asked them on 1 earlier pull request owned by @acme/security — history, not ownership",
    ]);
  });

  it("exits expected-empty with no reading, and errors on an unreadable register rather than an empty history", async () => {
    const none = harness({ reading: err(ReadingsErrors.noReading({ producer: "github landing" })) });
    const unreadable = harness({
      register: err(ReviewerRegisterErrors.unreadable({ cause: "EACCES", path: "/home/ledgers/reviewers.jsonl" })),
    });
    expect([
      await runGithubReviewer({ deps: none.deps, rest: ["list"] }),
      await runGithubReviewer({ deps: unreadable.deps, rest: ["list"] }),
    ]).toEqual([EXIT_EXPECTED_EMPTY, EXIT_ERROR]);
    expect([none.out, unreadable.out]).toEqual([[], []]);
  });

  it("errors, printing no list, when the roster store cannot say which ids are one person", async () => {
    const run = harness({ rosterDown: STORE_DOWN });
    expect(await runGithubReviewer({ deps: run.deps, rest: ["list"] })).toBe(EXIT_ERROR);
    expect(run.out).toEqual([]);
    expect(run.diagnostics).toEqual([`github reviewer: ${STORE_DOWN.message}`]);
  });
});

describe("github reviewer pick", () => {
  const PICK = ["pick", "--repo", "acme-admin", "--number", "17013", "--reviewer", "U0PRANAV", "--by-session", "s1"];

  const APPROVE_ROW = {
    atIso: "2026-09-24T02:00:00.000Z",
    bySession: "s1",
    kind: "pick",
    number: 17013,
    prKey: "acme/acme-admin#17013",
    repoSlug: "acme/acme-admin",
    reviewer: "U0PRANAV",
    schema: 1,
    verdict: "approve",
  };

  it("writes one pick row, parks one ask as a DM to the person picked, and says nothing was sent", async () => {
    const run = harness();
    expect(await runGithubReviewer({ deps: run.deps, rest: [...PICK, "--verdict", "approve", "--json"] })).toBe(
      EXIT_OK,
    );
    expect(run.appended).toEqual([[APPROVE_ROW]]);
    expect(run.parked).toEqual([
      {
        channel: "U0PRANAV",
        form: JSON.stringify({
          kind: "drip",
          messages: [
            {
              runs: [
                { text: "hey, could I grab a review on ", type: "text" },
                {
                  label: "bump undici #17013",
                  type: "link",
                  url: "https://github.com/acme/acme-admin/pull/17013",
                },
                { text: " when you get a sec? no rush", type: "text" },
              ],
            },
          ],
        }),
        why: "first review ask for acme/acme-admin#17013 to U0PRANAV, your approved pick from the suggested reviewer",
      },
    ]);
    expect(JSON.parse(run.out[0]!)).toEqual({
      ask: { ...PARKED, reused: false },
      path: "/home/ledgers/reviewers.jsonl",
      recorded: true,
      row: APPROVE_ROW,
      sent: false,
    });
  });

  it("names the person in the ask's why when the reading knows them", async () => {
    const run = harness();
    const onRosa = ["pick", "--repo", "acme-admin", "--number", "17013", "--reviewer", "U0ROSA", "--by-session", "s1"];
    expect(await runGithubReviewer({ deps: run.deps, rest: [...onRosa, "--verdict", "approve"] })).toBe(EXIT_OK);
    expect(run.parked.map((call) => call.why)).toEqual([
      "first review ask for acme/acme-admin#17013 to Rosa, your approved pick from the suggested reviewer",
    ]);
    expect(run.out).toEqual([
      "github reviewer: recorded approve of U0ROSA for acme/acme-admin#17013, and parked the ask sd-1 for your " +
        "yes: http://localhost:3000/queue?open=post%3Asd-1. Nothing was sent; the page reads 'picked' until a later " +
        "reading sees the ask.",
    ]);
  });

  it("names a person the reading never named from the identity roster", async () => {
    const run = harness();
    const onSadie = [
      "pick",
      "--repo",
      "acme-admin",
      "--number",
      "17013",
      "--reviewer",
      "U0SADIE",
      "--by-session",
      "s1",
    ];
    expect(await runGithubReviewer({ deps: run.deps, rest: [...onSadie, "--verdict", "approve"] })).toBe(EXIT_OK);
    expect(run.parked.map((call) => [call.channel, call.why])).toEqual([
      [
        "U0SADIE",
        "first review ask for acme/acme-admin#17013 to Sadie, your approved pick from the suggested reviewer",
      ],
    ]);
  });

  it("reuses the ask already held for that person and pull request rather than parking a second", async () => {
    const run = harness({ drafts: [heldDraft({ channel: "U0PRANAV", id: "sd-0" })] });
    expect(await runGithubReviewer({ deps: run.deps, rest: [...PICK, "--verdict", "approve", "--json"] })).toBe(
      EXIT_OK,
    );
    expect(run.parked).toEqual([]);
    expect(JSON.parse(run.out[0]!)).toEqual(
      expect.objectContaining({
        ask: { consoleUrl: "http://localhost:3000/queue?open=post%3Asd-0", draftId: "sd-0", reused: true },
      }),
    );
  });

  it("reuses a held ask a session addressed by the DM's D id, once Slack says whose DM it is", async () => {
    const drafts = [heldDraft({ channel: "D0OTHER", id: "sd-other" }), heldDraft({ channel: "D0PRANAV", id: "sd-d" })];
    const run = harness({
      dmUsers: new Map([
        ["D0OTHER", "U0ROSA"],
        ["D0PRANAV", "U0PRANAV"],
      ]),
      drafts,
    });
    expect(await runGithubReviewer({ deps: run.deps, rest: [...PICK, "--verdict", "approve", "--json"] })).toBe(
      EXIT_OK,
    );
    expect(run.parked).toEqual([]);
    expect((JSON.parse(run.out[0]!) as { ask: { draftId: string } }).ask.draftId).toBe("sd-d");
  });

  it("parks nothing, and keeps the pick, when Slack cannot say whose DM a held draft on this pull request is", async () => {
    const run = harness({ drafts: [heldDraft({ channel: "D0SYNUNKNOWN", id: "sd-d" })] });
    expect(await runGithubReviewer({ deps: run.deps, rest: [...PICK, "--verdict", "approve"] })).toBe(EXIT_ERROR);
    expect(run.appended).toEqual([[APPROVE_ROW]]);
    expect(run.parked).toEqual([]);
    expect(run.diagnostics[0]).toBe(
      "github reviewer: a held draft linking this pull request is a DM (D0SYNUNKNOWN) Slack would not say whose it " +
        "is, so it may already be this ask; read it with `slopweaver slack draft list` and park by hand if it is not",
    );
  });

  it("keeps the pick, parks nothing and exits an error when the roster store cannot name the person", async () => {
    const run = harness({ rosterDown: STORE_DOWN });
    expect(await runGithubReviewer({ deps: run.deps, rest: [...PICK, "--verdict", "approve", "--json"] })).toBe(
      EXIT_ERROR,
    );
    expect(run.appended).toEqual([[APPROVE_ROW]]);
    expect(run.parked).toEqual([]);
    expect(run.diagnostics).toEqual([
      `github reviewer: ${ReviewAskErrors.rosterUnreadable({ detail: STORE_DOWN.message }).message}`,
      "github reviewer: recorded approve of U0PRANAV for acme/acme-admin#17013, but NO ask was parked and " +
        "nothing was sent. Park it with `slopweaver slack draft record` once the reason above is fixed.",
    ]);
  });

  it("keeps the pick and exits an error naming both facts when the ask cannot park", async () => {
    const run = harness({ park: err(ReviewAskErrors.parkRefused({ exitCode: 1 })) });
    expect(await runGithubReviewer({ deps: run.deps, rest: [...PICK, "--verdict", "approve", "--json"] })).toBe(
      EXIT_ERROR,
    );
    expect(run.appended).toEqual([[APPROVE_ROW]]);
    expect(run.out).toEqual([]);
    expect(run.diagnostics).toEqual([
      "github reviewer: slack draft record refused the ask (exit 1); its reasons are above",
      "github reviewer: recorded approve of U0PRANAV for acme/acme-admin#17013, but NO ask was parked and " +
        "nothing was sent. Park it with `slopweaver slack draft record` once the reason above is fixed.",
    ]);
  });

  it("checks and parks under one lock per PERSON, released after, since asks to one person are one batch", async () => {
    const run = harness();
    expect(await runGithubReviewer({ deps: run.deps, rest: [...PICK, "--verdict", "approve"] })).toBe(EXIT_OK);
    expect(run.locks).toEqual(["review-ask|U0PRANAV", "released review-ask|U0PRANAV"]);
  });

  it("parks nothing while another approve for the same person holds the lock, and keeps the pick", async () => {
    const run = harness({ lockBusy: "held by pid 42" });
    expect(await runGithubReviewer({ deps: run.deps, rest: [...PICK, "--verdict", "approve"] })).toBe(EXIT_ERROR);
    expect(run.appended).toEqual([[APPROVE_ROW]]);
    expect(run.parked).toEqual([]);
    expect(run.diagnostics[0]).toBe(
      "github reviewer: another approve of U0PRANAV is parking an ask to them right now (held by pid 42); asks to " +
        "one person are one batch, so this press parked nothing. Once that one has parked, re-run this approve and " +
        "the recorder names the batch to write",
    );
  });

  it("parks once when two approves of the same pick race, where each alone would find nothing held", async () => {
    // One shared world: a held-ask register the park writes into only after a turn of the event loop, and a
    // lock that refuses a key already taken — the in-process shape of two console presses at once.
    const register: SlackDraftItem[] = [];
    const taken = new Set<string>();
    const parked: string[] = [];
    const racer = (): Harness => {
      const run = harness();
      return {
        ...run,
        deps: {
          ...run.deps,
          drafts: () => register,
          lockAsk: ({ key }) => {
            if (taken.has(key)) {
              return err("held by the other press");
            }
            taken.add(key);
            return ok({ release: () => taken.delete(key) });
          },
          parkAsk: async ({ channel }) => {
            await new Promise((resolve) => {
              setImmediate(resolve);
            });
            parked.push(channel);
            register.push(heldDraft({ channel, id: PARKED.draftId }));
            return ok(PARKED);
          },
        },
      };
    };
    const [first, second] = [racer(), racer()];
    const codes = await Promise.all([
      runGithubReviewer({ deps: first.deps, rest: [...PICK, "--verdict", "approve"] }),
      runGithubReviewer({ deps: second.deps, rest: [...PICK, "--verdict", "approve"] }),
    ]);
    expect(parked).toEqual(["U0PRANAV"]);
    expect(codes).toEqual([EXIT_OK, EXIT_ERROR]);
    expect(taken.size).toBe(0);
  });

  it("carries a decline's feedback, and parks nothing", async () => {
    const run = harness();
    expect(
      await runGithubReviewer({ deps: run.deps, rest: [...PICK, "--verdict", "decline", "--feedback", "on leave"] }),
    ).toBe(EXIT_OK);
    expect(run.appended[0]![0]).toEqual(expect.objectContaining({ feedback: "on leave", verdict: "decline" }));
    expect(run.parked).toEqual([]);
  });

  it("refuses the owner as a reviewer, a pull request outside the reading, and a decline with no feedback", async () => {
    const owner = harness();
    const absent = harness();
    const bare = harness();
    expect([
      await runGithubReviewer({
        deps: owner.deps,
        rest: [
          "pick",
          "--repo",
          "acme-admin",
          "--number",
          "17013",
          "--reviewer",
          "U0SYNADAOWN",
          "--verdict",
          "approve",
          "--by-session",
          "s",
        ],
      }),
      await runGithubReviewer({
        deps: absent.deps,
        rest: [
          "pick",
          "--repo",
          "acme-admin",
          "--number",
          "1",
          "--reviewer",
          "U0PRANAV",
          "--verdict",
          "approve",
          "--by-session",
          "s",
        ],
      }),
      await runGithubReviewer({ deps: bare.deps, rest: [...PICK, "--verdict", "decline"] }),
    ]).toEqual([EXIT_USAGE, EXIT_USAGE, EXIT_USAGE]);
    expect([owner.appended, absent.appended, bare.appended]).toEqual([[], [], []]);
    expect([owner.parked, absent.parked, bare.parked]).toEqual([[], [], []]);
    expect([owner.diagnostics[0], absent.diagnostics[0], bare.diagnostics[0]]).toEqual([
      "github reviewer: U0SYNADAOWN is you or your bot — never a reviewer",
      "github reviewer: acme-admin#1 is not an open pull request in the last github landing reading",
      "a decline needs --feedback saying why, so the suggestion can learn from it",
    ]);
  });

  it("refuses an unknown sub-verb, naming the ones it expected", () => {
    const run = harness();
    expect(runGithubReviewer({ deps: run.deps, rest: ["approve"] })).toBe(EXIT_USAGE);
    expect(run.diagnostics[0]).toBe("github reviewer: expected list, pick, read or backfill, got approve");
  });
});

describe("github reviewer read", () => {
  const PERMALINK = "https://acme.slack.com/archives/C0SYN000007/p1790152101764139";
  const READ = ["read", "--repo", "acme-admin", "--number", "17013", "--message", PERMALINK, "--by-session", "s1"];
  const QUOTE = "<@U0JASPER> <@U0JONAH> got another batch of these";

  it("writes one read row from the message's own identity, quoting the line, and says nothing was sent", async () => {
    const run = harness();
    const code = await runGithubReviewer({
      deps: run.deps,
      rest: [...READ, "--ask", "--to", "U0JASPER,U0JONAH", "--quote", QUOTE],
    });
    expect(code).toBe(EXIT_OK);
    expect(run.appended).toEqual([
      [
        {
          atIso: "2026-09-23T08:28:21.000Z",
          bySession: "s1",
          channel: "C0SYN000007",
          isDirectMessage: false,
          kind: "read",
          messageKey: "C0SYN000007:1790152101.764139",
          number: 17013,
          permalink: PERMALINK,
          prKey: "acme/acme-admin#17013",
          quote: QUOTE,
          readAtIso: "2026-09-24T02:00:00.000Z",
          recipients: ["U0JASPER", "U0JONAH"],
          repoSlug: "acme/acme-admin",
          schema: 1,
          verdict: "ask",
        },
      ],
    ]);
    expect(run.out[0]).toBe(
      "github reviewer: recorded C0SYN000007:1790152101.764139 as an ask of U0JASPER, U0JONAH on " +
        "acme/acme-admin#17013. Nothing was sent — the next github landing reading carries it.",
    );
  });

  it("carries a non-ask's why and names nobody", async () => {
    const run = harness();
    const code = await runGithubReviewer({
      deps: run.deps,
      rest: [...READ, "--non-ask", "--why", "a status line", "--quote", "got another batch"],
    });
    expect(code).toBe(EXIT_OK);
    expect(run.appended[0]![0]).toMatchObject({
      kind: "read",
      recipients: [],
      verdict: "non-ask",
      why: "a status line",
    });
  });

  it("refuses a quote the message does not hold, writing nothing", async () => {
    const run = harness();
    const code = await runGithubReviewer({
      deps: run.deps,
      rest: [...READ, "--ask", "--to", "U0JASPER", "--quote", "pls review"],
    });
    expect([code, run.appended.length]).toEqual([EXIT_USAGE, 0]);
    expect(run.diagnostics[0]).toContain("--quote is not in");
  });

  it("refuses a message that does not link the pull request — a longer number is not a match", async () => {
    const run = harness({
      message: ok({ ...BATCH, text: `${QUOTE} <https://github.com/acme/acme-admin/pull/170130|x>` }),
    });
    const code = await runGithubReviewer({
      deps: run.deps,
      rest: [...READ, "--ask", "--to", "U0JASPER", "--quote", QUOTE],
    });
    expect([code, run.appended.length]).toEqual([EXIT_USAGE, 0]);
    expect(run.diagnostics[0]).toContain("does not link acme/acme-admin#17013");
  });

  it("accepts a message whose pull request is linked by another message of its thread", async () => {
    const run = harness({
      message: ok({
        ...BATCH,
        text: QUOTE,
        threadTexts: ["the root", "<https://github.com/acme/acme-admin/pull/17013|#17013>"],
      }),
    });
    const code = await runGithubReviewer({
      deps: run.deps,
      rest: [...READ, "--ask", "--to", "S0GROUP", "--quote", QUOTE],
    });
    expect([code, run.appended.length]).toEqual([EXIT_OK, 1]);
  });

  it("refuses the owner as the one asked, an unreadable message, and a flag set naming no verdict", async () => {
    const self = harness();
    const selfCode = await runGithubReviewer({
      deps: self.deps,
      rest: [...READ, "--ask", "--to", "U0SYNADAOWN", "--quote", QUOTE],
    });
    const unread = harness({
      message: err(
        GithubVerbErrors.upstreamRefused({ operation: "slack read-thread", reasons: ["channel_not_found"] }),
      ),
    });
    const unreadCode = await runGithubReviewer({
      deps: unread.deps,
      rest: [...READ, "--ask", "--to", "U0JASPER", "--quote", QUOTE],
    });
    const neither = harness();
    const neitherCode = await runGithubReviewer({ deps: neither.deps, rest: [...READ, "--quote", QUOTE] });
    expect([selfCode, unreadCode, neitherCode]).toEqual([EXIT_USAGE, EXIT_ERROR, EXIT_USAGE]);
    expect([self.appended.length, unread.appended.length, neither.appended.length]).toEqual([0, 0, 0]);
    expect(unread.diagnostics[0]).toBe("github reviewer: channel_not_found");
    expect(neither.diagnostics[0]).toBe("pass exactly one of --ask or --non-ask");
  });
});

/** The owner's batch asking one person per line about two pull requests, as the corpus scan hands it over. */
const BACKFILL_TEXT =
  "for your review:\n" +
  "• <@U0SYN000004> <https://github.com/acme/acme-admin/pull/16996|#16996> bump relay\n" +
  "• <@U0SYN000002> <https://github.com/acme/acme-admin/pull/17001|#17001> bump simple-git";

/**
 * The batch as a mention of one of its pull requests.
 *
 * @returns the mention
 */
function batchMention({ number }: { number: number }): SlackMention {
  const spans = findPrLinkSpans({ text: BACKFILL_TEXT });
  return {
    association: "linked",
    atIso: "2026-06-01T01:00:00.000Z",
    authorId: "U0SYNADAOWN",
    authorRole: "owner",
    authoredPrCount: 2,
    authoredText: BACKFILL_TEXT,
    channel: "#dev-alerts",
    conversation: "channel",
    counterpartId: "",
    excerpt: "for your review",
    firstLinkAt: firstLinkStart({ spans }),
    isDirectMessage: false,
    leg: "corpus",
    linkSpans: spans.filter((entry) => entry.ref.number === number).map((entry) => entry.span),
    mentions: mentionRunsIn({ text: BACKFILL_TEXT }),
    messageKey: "C1:1.1",
    permalink: "https://acme.slack.com/archives/C1/p11",
    prKey: `acme/acme-admin#${String(number)}`,
    quotedPrKeys: [],
    tagged: mentionRunsIn({ text: BACKFILL_TEXT }).map((run) => run.id),
    threadKey: "C1:1.1",
    threadPrKeys: [],
    versionsDisagree: false,
  };
}

/** GitHub bronze records for the owner's two pull requests and somebody else's. */
const BACKFILL_RECORDS: readonly CorpusRecord[] = [16996, 17001, 17002].map((number) => ({
  author: number === 17002 ? "someone" : "octocat",
  container: "acme/acme-admin",
  kind: "pr",
  refs: [],
  source: "github",
  sourceId: `#${String(number)}`,
  text: "",
  tsIso: "2026-06-01T00:00:00Z",
  url: `https://github.com/acme/acme-admin/pull/${String(number)}`,
}));

/**
 * Backfill fakes over those records and that batch, recording which pull requests GitHub was read for.
 *
 * @returns the seams and the reads they saw
 */
function backfillFakes({
  failing = new Set<number>(),
  overflowing = new Set<number>(),
  mentions = ok([batchMention({ number: 16996 }), batchMention({ number: 17001 })]),
}: {
  failing?: ReadonlySet<number>;
  overflowing?: ReadonlySet<number>;
  mentions?: Result<readonly SlackMention[]>;
} = {}): { readonly backfill: ReviewerBackfillDeps; readonly readFor: number[] } {
  const readFor: number[] = [];
  return {
    backfill: {
      codeownerTeams: ({ ref }) => {
        readFor.push(ref.number);
        if (failing.has(ref.number)) {
          return Promise.resolve(err(GithubReviewerErrors.teamsUnread({ cause: "GitHub answered 502" })));
        }
        if (overflowing.has(ref.number)) {
          return Promise.resolve(err(GithubReviewerErrors.teamsTruncated()));
        }
        return Promise.resolve(ok(["@acme/security"]));
      },
      corpusMentions: () => mentions,
      githubRecords: () => ok(BACKFILL_RECORDS),
    },
    readFor,
  };
}

const BACKFILL = ["backfill", "--repo", "acme/acme-admin", "--author", "octocat"];

describe("github reviewer backfill", () => {
  it("reports what it would write and writes nothing without --apply", async () => {
    const fakes = backfillFakes();
    const run = harness({ backfill: fakes.backfill });
    expect(await runGithubReviewer({ deps: run.deps, rest: [...BACKFILL, "--json"] })).toBe(EXIT_OK);
    expect(run.appended).toEqual([]);
    expect(JSON.parse(run.out[0]!)).toEqual({
      applied: false,
      asks: 2,
      author: "octocat",
      fresh: 2,
      heldBack: [],
      prs: 2,
      prsMentioned: 2,
      prsRead: 2,
      repo: "acme/acme-admin",
      unread: [],
      written: 0,
    });
    expect(fakes.readFor).toEqual([16996, 17001]);
  });

  it("writes nothing and exits an error when the roster store cannot name the people, even under --apply", async () => {
    const run = harness({ backfill: backfillFakes().backfill, rosterDown: STORE_DOWN });
    expect(await runGithubReviewer({ deps: run.deps, rest: [...BACKFILL, "--apply"] })).toBe(EXIT_ERROR);
    expect(run.appended).toEqual([]);
    expect(run.diagnostics).toEqual([`github reviewer backfill: ${STORE_DOWN.message}`]);
  });

  it("appends every new ask under --apply, each scoped to its own line's reviewer with GitHub's teams", async () => {
    const run = harness({ backfill: backfillFakes().backfill, rosterNames: new Map([["U0SYN000002", "Rosa"]]) });
    expect(await runGithubReviewer({ deps: run.deps, rest: [...BACKFILL, "--apply"] })).toBe(EXIT_OK);
    const asked = run.appended[0]!.filter((row): row is ReviewerAskedRow => row.kind === "asked");
    expect(asked.map((row) => [row.prKey, row.recipients, row.codeOwnerTeams, row.names])).toEqual([
      ["acme/acme-admin#16996", ["U0SYN000004"], ["@acme/security"], {}],
      ["acme/acme-admin#17001", ["U0SYN000002"], ["@acme/security"], { U0SYN000002: "Rosa" }],
    ]);
    expect(run.appended[0]!.length).toBe(2);
    expect(run.out[0]).toBe(
      "github reviewer backfill: octocat in acme/acme-admin — 2 pull request(s), 2 reached from Slack, " +
        "2 read for teams; 2 ask(s) found, 2 new; wrote 2",
    );
  });

  it("reads GitHub only for a pull request still owed an ask", async () => {
    const held: ReviewerRow = {
      ...EARLIER,
      messageKey: "C1:1.1",
      number: 16996,
      prKey: "acme/acme-admin#16996",
    };
    const fakes = backfillFakes();
    const run = harness({ backfill: fakes.backfill, register: ok([held]) });
    expect(await runGithubReviewer({ deps: run.deps, rest: [...BACKFILL, "--apply"] })).toBe(EXIT_OK);
    expect(fakes.readFor).toEqual([17001]);
    expect(run.appended[0]!.map((row) => row.prKey)).toEqual(["acme/acme-admin#17001"]);
  });

  it("writes none of a pull request's asks when its GitHub read fails, writes the rest, and exits 1 naming it", async () => {
    const run = harness({ backfill: backfillFakes({ failing: new Set([17001]) }).backfill });
    expect(await runGithubReviewer({ deps: run.deps, rest: [...BACKFILL, "--apply"] })).toBe(EXIT_ERROR);
    expect(run.appended[0]!.map((row) => row.prKey)).toEqual(["acme/acme-admin#16996"]);
    expect(run.diagnostics).toEqual([
      "github reviewer backfill: acme/acme-admin#17001 not written — GitHub answered 502; a rerun reads it again",
    ]);
  });

  it("holds back a pull request whose code owners overflow the fixed page, writes the rest, and exits 0", async () => {
    const run = harness({ backfill: backfillFakes({ overflowing: new Set([17001]) }).backfill });
    expect(await runGithubReviewer({ deps: run.deps, rest: [...BACKFILL, "--apply", "--json"] })).toBe(EXIT_OK);
    expect(run.appended[0]!.map((row) => row.prKey)).toEqual(["acme/acme-admin#16996"]);
    expect(JSON.parse(run.out[0]!).heldBack).toEqual([
      { prKey: "acme/acme-admin#17001", why: GithubReviewerErrors.teamsTruncated().message },
    ]);
    expect(run.diagnostics).toEqual([
      `github reviewer backfill: acme/acme-admin#17001 held back — ${GithubReviewerErrors.teamsTruncated().message}`,
    ]);
  });

  it("refuses a missing --author, an author with no pull request, and an unreadable corpus — writing nothing", async () => {
    const bare = harness({ backfill: backfillFakes().backfill });
    const stranger = harness({ backfill: backfillFakes().backfill });
    const unscanned = harness({
      backfill: backfillFakes({ mentions: err(["the Slack bronze could not be listed"]) }).backfill,
    });
    expect([
      await runGithubReviewer({ deps: bare.deps, rest: ["backfill", "--repo", "acme/acme-admin"] }),
      await runGithubReviewer({
        deps: stranger.deps,
        rest: ["backfill", "--repo", "acme/acme-admin", "--author", "nobody"],
      }),
      await runGithubReviewer({ deps: unscanned.deps, rest: [...BACKFILL, "--apply"] }),
    ]).toEqual([EXIT_USAGE, EXIT_EXPECTED_EMPTY, EXIT_ERROR]);
    expect([bare.appended, stranger.appended, unscanned.appended]).toEqual([[], [], []]);
    expect([bare.diagnostics[0], stranger.diagnostics[0], unscanned.diagnostics[0]]).toEqual([
      "--author <login> is required: whose pull requests' asks to backfill",
      "github reviewer backfill: the GitHub corpus holds no pull request by nobody in acme/acme-admin",
      "github reviewer backfill: the Slack bronze could not be listed",
    ]);
  });
});
