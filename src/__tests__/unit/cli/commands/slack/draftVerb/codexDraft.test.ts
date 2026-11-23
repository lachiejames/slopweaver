/**
 * `slopweaver slack draft`, where a Codex draft is journalled beside the original and the owner picks one.
 *
 * Also covers `slopweaver slack draft record` of a finding in a thread, which never parks without its proof.
 */
import { describe, expect, it } from "vitest";

import { admitCandidate } from "../../../../../../cli/commands/slack/draftCandidate.js";
import { runSlackDraftWithDeps } from "../../../../../../cli/commands/slack/draftRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import type { CodexDraftAnswer } from "../../../../../../codex/slackDraftPass.js";
import type { RawWords } from "../../../../../../handover/hisWordsResolve.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../../lib/result.js";
import { type ComparisonOutcome, pickOwed } from "../../../../../../outbound/slack/draftComparison.js";
import { SlackDraftErrors } from "../../../../../../outbound/slack/draftErrors.js";
import { foldSlackDraftLog, parseSlackDraftLog } from "../../../../../../outbound/slack/draftLog.js";
import {
  parkedDraftDigest,
  type SlackDraftEvent,
  slackDraftEventLine,
} from "../../../../../../outbound/slack/draftRegister.js";
import { ProfileReadErrors } from "../../../../../../profileStore.js";
import { CONFIG } from "./fixtures.js";
import { oneCard, parkedIn, RECORD_UNPROVEN } from "./forms.js";
import { argv, draftDeps, freshRecording } from "./world.js";

describe("slack draft — a Codex draft beside the original", () => {
  const ANCHOR = "talk-call:7bbd1a8c-0000-4000-8000-000000000001#turn_PickB";
  const HEARD: RawWords = {
    atIso: "2026-10-09T11:10:00.000Z",
    context: { kind: "call-segment", open: "post:sd-deadbeef" },
    headKnown: true,
    headLost: false,
    tailKnown: true,
    tailLost: false,
    text: "Codex's one, send it",
    where: "call",
  };
  const FORM = JSON.stringify(oneCard({ lines: ["Four groups, one question.", "Which is the right state?"] }));
  /**
   * The recording these cases make: into a DM. Codex drafts beside a row that carries no media (`draftCompareRun.ts`),
   * and a first message at the top level of a channel always carries its screenshot, so a channel
   * row never gets a comparison; a DM owes no proof and gets one exactly as the channel row did before.
   */
  const DM_TAIL = RECORD_UNPROVEN.map((flag) => (flag === "C0ISO" ? "D0DM" : flag));
  const CODEX_FORM = JSON.stringify({
    kind: "drip",
    messages: [{ runs: [{ text: "Which of the four groups is the right state?", type: "text" }] }],
    opening: { asks: { kind: "reply", text: "the right state" }, what: "the four groups" },
    problem: { kind: "none" },
  });
  const READY: CodexDraftAnswer = { elapsedMs: 4200, form: CODEX_FORM, kind: "answered", requestedModel: "gpt-test" };

  /** The register a run left behind, as the next invocation reads it. */
  function logOf({ events }: { events: readonly SlackDraftEvent[] }): string {
    return events.map((event) => slackDraftEventLine({ event })).join("\n");
  }

  /** Record FORM with Codex answering `codex`, and hand back what it appended. */
  async function recorded({ codex }: { codex: CodexDraftAnswer }): Promise<readonly SlackDraftEvent[]> {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: DM_TAIL }),
      deps: draftDeps({ codex, recording: seen, stdin: FORM }),
    });
    expect(code).toBe(EXIT_OK);
    return seen.appended;
  }

  /** The one comparison outcome a run journalled. */
  function outcomeIn({ events }: { events: readonly SlackDraftEvent[] }): ComparisonOutcome {
    return events.flatMap((event) => (event.kind === "compared" ? [event.outcome] : []))[0]!;
  }

  /** The one ready comparison a run journalled. */
  function readyIn({ events }: { events: readonly SlackDraftEvent[] }): Extract<ComparisonOutcome, { state: "ready" }> {
    return events.flatMap((event) =>
      event.kind === "compared" && event.outcome.state === "ready" ? [event.outcome] : [],
    )[0]!;
  }

  it("parks the original owing a comparison, then journals Codex's admitted draft beside it", async () => {
    const events = await recorded({ codex: READY });
    const parked = parkedIn({ events });
    expect(parked.composer).toBe("undetected");
    expect(parked.comparison).toEqual({ state: "pending" });
    expect(outcomeIn({ events }).state).toBe("ready");
  });

  it("gives Codex's draft its own digest over the original's destination", async () => {
    const events = await recorded({ codex: READY });
    const ready = readyIn({ events });
    expect(ready.candidate.digest).not.toBe(parkedIn({ events }).digest);
    expect(ready.requestedModel).toBe("gpt-test");
  });

  it("REFUSES Codex's draft on the owner's exact voice rules, keeping the original", async () => {
    const seen = freshRecording();
    const deps = draftDeps({ codex: READY, recording: seen, stdin: FORM });
    // A word only Codex's draft carries, so the original parks clean and only B meets the rule.
    const ruled = { ...CONFIG, exactVoiceRules: [{ kind: "word" as const, value: "of" }] };
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: DM_TAIL }),
      deps: { ...deps, dripConfig: () => ok(ruled) },
    });
    expect(code).toBe(EXIT_OK);
    expect(outcomeIn({ events: seen.appended })).toMatchObject({ stage: "voice-rules", state: "refused" });
    expect(parkedIn({ events: seen.appended }).advisory).toEqual([]);
  });

  it("admits Codex's form over the original's destination, its digest binding its own words", async () => {
    const parked = parkedIn({ events: await recorded({ codex: READY }) });
    const deps = draftDeps({ recording: freshRecording() });
    const admitted = await admitCandidate({ deps, draft: parked, form: CODEX_FORM, home: "/tmp/no-home", token: "t" });
    const candidate = unwrap(admitted);
    const { authorId, channel, priorAsk, threadTs } = parked;
    const { mentions, payload } = candidate;
    expect(candidate.payload.text).toBe("Which of the four groups is the right state?");
    expect(candidate.digest).toBe(
      parkedDraftDigest({ draft: { authorId, channel, mentions, payload, priorAsk, threadTs } }),
    );
  });

  it("refuses Codex's form at admission when it raises a finding the original row cannot prove", async () => {
    const parked = parkedIn({ events: await recorded({ codex: READY }) });
    const deps = draftDeps({ recording: freshRecording() });
    const finding = JSON.stringify({
      kind: "drip",
      messages: [
        {
          runs: [{ text: "The four groups: many customers cannot check out. Which is the right state?", type: "text" }],
        },
      ],
      opening: { asks: { kind: "reply", text: "the right state" }, what: "the four groups" },
      problem: { affects: "many", kind: "possible" },
    });
    const admitted = await admitCandidate({ deps, draft: parked, form: finding, home: "/tmp/no-home", token: "t" });
    const refusal = unwrapErr(admitted);
    expect(refusal.stage).toBe("admission");
    expect(refusal.reasons[0]).toContain("is missing screenshot, link, impact");
  });

  it("refuses a candidate at admission when the drip config cannot be read, naming why", async () => {
    const parked = parkedIn({ events: await recorded({ codex: READY }) });
    const unreadable = ProfileReadErrors.unreadable({ detail: "not JSON: Unexpected token", path: "/x/profile.json" });
    const deps = { ...draftDeps({ recording: freshRecording() }), dripConfig: () => err(unreadable) };
    const admitted = await admitCandidate({ deps, draft: parked, form: CODEX_FORM, home: "/tmp/no-home", token: "t" });
    expect(unwrapErr(admitted)).toEqual({ reasons: [unreadable.message], stage: "admission" });
  });

  it("runs no pass on a row a Codex session composed, and says why on the row", async () => {
    const seen = freshRecording();
    const deps = draftDeps({ codex: READY, recording: seen, stdin: FORM });
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: DM_TAIL }),
      deps: { ...deps, doorEnv: () => ({ CODEX_THREAD_ID: "codex-thread-1" }) },
    });
    expect(code).toBe(EXIT_OK);
    expect(seen.appended.map((event) => event.kind)).toEqual(["parked"]);
    expect(parkedIn({ events: seen.appended }).comparison).toEqual({ reason: "composed-by-codex", state: "skipped" });
  });

  it("REFUSES an approve naming no variant while the owner's pick is owed, and appends nothing", async () => {
    const log = logOf({ events: await recorded({ codex: READY }) });
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: ["approve", "sd-deadbeef", "--anchor", ANCHOR] }),
      deps: draftDeps({ hisWords: ok(HEARD), log, recording: seen }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
  });

  it("records the owner's pick and yes together, the row's words becoming Codex's", async () => {
    const events = await recorded({ codex: READY });
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: ["approve", "sd-deadbeef", "--anchor", ANCHOR, "--variant", "codex", "--json"] }),
      deps: draftDeps({ hisWords: ok(HEARD), log: logOf({ events }), recording: seen }),
    });
    const lines = logOf({ events: [...events, ...seen.appended] }).split("\n");
    const row = foldSlackDraftLog({ log: parseSlackDraftLog({ lines }) })[0]!;
    expect(code).toBe(EXIT_OK);
    expect(seen.appended.map((event) => event.kind)).toEqual(["picked", "approved"]);
    expect(row.draft.digest).toBe(readyIn({ events }).candidate.digest);
    expect(row.original!.digest).toBe(parkedIn({ events }).digest);
    expect(row.draft.approval!.heard).toBe(HEARD.text);
    // The receipt's release binds B's digest, never the one the row was first read with.
    const release = seen.lines.find((line) => line.includes("release it:"))!;
    expect(release).toContain(`--approve ${readyIn({ events }).candidate.digest}`);
    expect(release).not.toContain(parkedIn({ events }).digest);
  });

  it("retries over the page ending where the recording's read ended, cutting a message posted since", async () => {
    const seenThen = { text: "who owns the staging pool?", ts: "1790000000.000100", user: "U0SETH" };
    const postedSince = { text: "never mind", ts: "1790000900.000100", user: "U0SETH" };
    const first = freshRecording();
    const read = ({ rows }: { rows: readonly unknown[] }) =>
      ok({ hasMore: false, rows, workspaceUrl: "https://acme.slack.com" });
    await runSlackDraftWithDeps({
      argv: argv({ tail: DM_TAIL }),
      deps: draftDeps({
        codex: { kind: "unavailable", reason: "capped" },
        conversation: read({ rows: [seenThen] }),
        recording: first,
        stdin: FORM,
      }),
    });
    const retried = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: ["compare", "sd-deadbeef"] }),
      deps: draftDeps({
        codex: READY,
        conversation: read({ rows: [postedSince, seenThen] }),
        log: logOf({ events: first.appended }),
        recording: retried,
      }),
    });
    expect(code).toBe(EXIT_OK);
    // A post since cannot page one the recording saw out of the read, and is cut from what Codex sees.
    expect(retried.calls).toContain(`through:${seenThen.ts}`);
    expect(outcomeIn({ events: retried.appended }).state).toBe("ready");
  });

  it("frees a pending row whose retry finds a message it read edited since", async () => {
    const seenThen = { text: "who owns the staging pool?", ts: "1790000000.000100", user: "U0SETH" };
    const editedSince = { ...seenThen, edited: { ts: "1790000950.000000" }, text: "who owns prod?" };
    const read = ({ rows }: { rows: readonly unknown[] }) =>
      ok({ hasMore: false, rows, workspaceUrl: "https://acme.slack.com" });
    const first = freshRecording();
    await runSlackDraftWithDeps({
      argv: argv({ tail: DM_TAIL }),
      deps: draftDeps({ codex: READY, conversation: read({ rows: [seenThen] }), recording: first, stdin: FORM }),
    });
    // The record died mid-pass: only its park reached the register, so the row reads `pending`.
    const parked = first.appended.filter((event) => event.kind === "parked");
    const retried = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: ["compare", "sd-deadbeef"] }),
      deps: draftDeps({
        codex: READY,
        conversation: read({ rows: [editedSince] }),
        log: logOf({ events: parked }),
        recording: retried,
      }),
    });
    const lines = logOf({ events: [...parked, ...retried.appended] }).split("\n");
    const row = foldSlackDraftLog({ log: parseSlackDraftLog({ lines }) })[0]!;
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(outcomeIn({ events: retried.appended })).toMatchObject({ stage: "evidence", state: "refused" });
    expect(row.comparison!.state).toBe("refused");
    expect(pickOwed({ item: row })).toBe(false);
  });

  it("frees a pending row whose retry cannot read the conversation", async () => {
    const seenThen = { text: "who owns the staging pool?", ts: "1790000000.000100", user: "U0SETH" };
    const first = freshRecording();
    await runSlackDraftWithDeps({
      argv: argv({ tail: DM_TAIL }),
      deps: draftDeps({
        codex: READY,
        conversation: ok({ hasMore: false, rows: [seenThen], workspaceUrl: "https://acme.slack.com" }),
        recording: first,
        stdin: FORM,
      }),
    });
    const parked = first.appended.filter((event) => event.kind === "parked");
    const retried = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: ["compare", "sd-deadbeef"] }),
      deps: draftDeps({
        codex: READY,
        conversation: err(SlackDraftErrors.contextUnreadable({ cause: "not_in_channel", channel: "D0DM" })),
        log: logOf({ events: parked }),
        recording: retried,
      }),
    });
    const lines = logOf({ events: [...parked, ...retried.appended] }).split("\n");
    const row = foldSlackDraftLog({ log: parseSlackDraftLog({ lines }) })[0]!;
    expect(code).toBe(EXIT_ERROR);
    expect(outcomeIn({ events: retried.appended }).state).toBe("unavailable");
    expect(pickOwed({ item: row })).toBe(false);
  });

  it("REFUSES a pass whose --why quotes the original, before Codex is asked", async () => {
    const seen = freshRecording();
    const quoting = DM_TAIL.map((flag) =>
      flag === "the ISO group question" ? "ask: four groups, one question, which is the right state" : flag,
    );
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: quoting }),
      deps: draftDeps({ codex: READY, recording: seen, stdin: FORM }),
    });
    // Codex answers READY here, so a pass that ran would have journalled `ready`; the refusal proves none did.
    expect(code).toBe(EXIT_OK);
    expect(outcomeIn({ events: seen.appended })).toMatchObject({
      reasons: [
        "a line its session chose (--why, --act, the re-ask or the destination) quotes the draft, so a pass would see A",
      ],
      stage: "evidence",
      state: "refused",
    });
  });

  it("frees the row when the pass throws after the park, never leaving it pending", async () => {
    const seen = freshRecording();
    const deps = draftDeps({ recording: seen, stdin: FORM });
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: DM_TAIL }),
      deps: {
        ...deps,
        codexDraft: () => Promise.reject(new Error("ENOSPC: no space left on device, mkdtemp")),
      },
    });
    const lines = logOf({ events: seen.appended }).split("\n");
    const row = foldSlackDraftLog({ log: parseSlackDraftLog({ lines }) })[0]!;
    expect(code).toBe(EXIT_OK);
    expect(outcomeIn({ events: seen.appended })).toEqual({
      reason: "the comparison failed unexpectedly: ENOSPC: no space left on device, mkdtemp",
      state: "unavailable",
    });
    expect(pickOwed({ item: row })).toBe(false);
  });

  it("reads an approval written while the owner's pick is owed as no approval at all", async () => {
    const events = await recorded({ codex: READY });
    const approval = { anchor: ANCHOR, atIso: "2026-09-23T01:02:03.000Z", heard: HEARD.text };
    const handWritten: SlackDraftEvent = {
      approval,
      id: "sd-deadbeef",
      kind: "approved",
      tsIso: "2026-09-23T01:03:00.000Z",
    };
    const lines = logOf({ events: [...events, handWritten] }).split("\n");
    const row = foldSlackDraftLog({ log: parseSlackDraftLog({ lines }) })[0]!;
    expect(row.draft.approval).toBeUndefined();
    expect(pickOwed({ item: row })).toBe(true);
  });

  it("picks the original without approving it, and refuses a different pick after", async () => {
    const events = await recorded({ codex: READY });
    const first = freshRecording();
    const picked = await runSlackDraftWithDeps({
      argv: argv({ tail: ["pick", "sd-deadbeef", "--variant", "original"] }),
      deps: draftDeps({ log: logOf({ events }), recording: first }),
    });
    const second = freshRecording();
    const changed = await runSlackDraftWithDeps({
      argv: argv({ tail: ["pick", "sd-deadbeef", "--variant", "codex"] }),
      deps: draftDeps({ log: logOf({ events: [...events, ...first.appended] }), recording: second }),
    });
    expect(picked).toBe(EXIT_OK);
    expect(first.appended.map((event) => event.kind)).toEqual(["picked"]);
    expect(changed).toBe(EXIT_USAGE);
    expect(second.appended).toEqual([]);
  });

  it("marks a row owing the owner's pick on the list", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: ["list"] }),
      deps: draftDeps({ log: logOf({ events: await recorded({ codex: READY }) }), recording: seen }),
    });
    expect(code).toBe(EXIT_OK);
    expect(seen.lines[0]).toContain("PICK OWED · the ISO group question");
  });

  it("retries a comparison no Codex seat could take, and refuses one already ready", async () => {
    const unavailable = await recorded({ codex: { kind: "unavailable", reason: "capped" } });
    const waiting = logOf({ events: unavailable });
    const retried = freshRecording();
    const recomparedCode = await runSlackDraftWithDeps({
      argv: argv({ tail: ["compare", "sd-deadbeef"] }),
      deps: draftDeps({ codex: READY, log: waiting, recording: retried }),
    });
    const ready = logOf({ events: await recorded({ codex: READY }) });
    const again = freshRecording();
    const final = await runSlackDraftWithDeps({
      argv: argv({ tail: ["compare", "sd-deadbeef"] }),
      deps: draftDeps({ codex: READY, log: ready, recording: again }),
    });
    expect(recomparedCode).toBe(EXIT_OK);
    expect(retried.appended.map((event) => event.kind)).toEqual(["compared"]);
    // Its recording read an empty channel, so the retry reads nothing either, and never sends Slack the sentinel.
    expect(parkedIn({ events: unavailable }).readThrough!.seen).toEqual([]);
    expect(retried.calls.filter((call) => call.startsWith("readConversation"))).toEqual([]);
    expect(final).toBe(EXIT_EXPECTED_EMPTY);
    expect(again.appended).toEqual([]);
  });
});

describe("slack draft record — a finding without its proof never parks", () => {
  const THREAD = "1785979873.891449";
  const ROOT = [{ text: "Pending pricing for the widget export from Globex.", ts: THREAD, user: "U0SYNDOC" }];
  const LINEAR = "https://linear.app/acme/issue/SUP-9381/example-ticket";
  /** sd-b5a68451's own shape: a thread reply, no `--kind`, a possible problem reaching "many", one ticket link. */
  const incident = ({ first }: { first: string }): string =>
    JSON.stringify({
      kind: "one-card",
      lines: [
        { runs: [{ text: first, type: "text" }] },
        {
          runs: [
            { label: "SUP-9381", type: "link", url: LINEAR },
            { text: " counted the re-orders over the last year. it's in backlog with no assignee yet", type: "text" },
          ],
        },
        {
          runs: [
            { text: "is the renewal SR workaround from up-thread still worth doing in the meantime?", type: "text" },
          ],
        },
      ],
      problem: { affects: "many", kind: "possible" },
    });
  const TAIL: readonly string[] = [
    "record",
    "--channel",
    "C0ISO",
    "--form",
    "-",
    "--why",
    "thread reply: SUP-9381 tier-3 repeat orders",
    "--thread-ts",
    THREAD,
    "--asked-before",
    "none",
  ];
  const UNPROVEN = "just fyi, i think we're still re-sending repeat orders for many tier 3 customers";

  it("REFUSES sd-b5a68451's shape — one ticket link, no screenshot, no impact — storing and appending nothing", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: TAIL }),
      deps: draftDeps({ recording: seen, replies: ROOT, stdin: incident({ first: UNPROVEN }) }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
    expect(seen.calls.some((call) => call.startsWith("storeMedia"))).toBe(false);
  });

  it("REFUSES the same shape declaring --tried: a finding that could not get its proof does not park", async () => {
    const seen = freshRecording();
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...TAIL, "--tried", "the Hex query would not load signed out"] }),
      deps: draftDeps({ recording: seen, replies: ROOT, stdin: incident({ first: UNPROVEN }) }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
  });

  it("REFUSES a screenshot and an impact whose count the first line does not carry", async () => {
    const seen = freshRecording();
    const proof = ["--media", "/tmp/still.png", "--impact", "2,480 customers re-ordered a test they had"];
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...TAIL, ...proof] }),
      deps: draftDeps({ recording: seen, replies: ROOT, stdin: incident({ first: UNPROVEN }) }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(seen.appended).toEqual([]);
  });

  it("parks the recut that brings a screenshot, the link and the impact in people in its first line", async () => {
    const seen = freshRecording();
    const impact = "2,480 customers re-ordered a test they already had";
    const code = await runSlackDraftWithDeps({
      argv: argv({ tail: [...TAIL, "--media", "/tmp/still.png", "--impact", impact] }),
      deps: draftDeps({
        recording: seen,
        replies: ROOT,
        stdin: incident({ first: "2,480 customers, many of them tier 3, were sent a repeat order they already had" }),
      }),
    });
    expect(code).toBe(EXIT_OK);
    const draft = parkedIn({ events: seen.appended });
    expect([draft.shape, draft.kind, draft.impact, draft.media!.length]).toEqual(["thread", undefined, impact, 1]);
  });
});
