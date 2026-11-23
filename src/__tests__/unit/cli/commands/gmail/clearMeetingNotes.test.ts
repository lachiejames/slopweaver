/**
 * `gmail clear-meeting-notes`: the pure judgement per mail, and the shell's ORDER over plain fake edges.
 *
 * The property the owner asked for is "archive only on proof", so the run cases assert on which ids reached the
 * archive edge and in what order the edges ran — a mail that reached `archive` before its transcript was proven
 * would fail here, not pass quietly. Bronze is an in-memory map judged by the real `provesMeetingTranscript`, so
 * "proven" means what a real run means by it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  meetingCard,
  meetingCardArgv,
  meetingCardSlug,
} from "../../../../../cli/commands/gmail/clearMeetingNotesCard.js";
import {
  judgeMeeting,
  type KeptMeetingReason,
  keptReasonNeedsOwner,
  type MeetingDisposition,
  type MeetingEvidence,
  parseClearMeetingNotesArgs,
} from "../../../../../cli/commands/gmail/clearMeetingNotesCore.js";
import { ClearMeetingNotesErrors } from "../../../../../cli/commands/gmail/clearMeetingNotesErrors.js";
import { MEETING_DATE_ATTR } from "../../../../../cli/commands/gmail/clearMeetingNotesGather.js";
import { ensureMeetingCard, settleMeetingCard } from "../../../../../cli/commands/gmail/clearMeetingNotesProduction.js";
import {
  type ClearMeetingNotesReport,
  clearMeetingNotesExit,
  clearMeetingNotesLines,
} from "../../../../../cli/commands/gmail/clearMeetingNotesReport.js";
import {
  type ClearMeetingNotesDeps,
  runGmailClearMeetingNotes,
} from "../../../../../cli/commands/gmail/clearMeetingNotesRun.js";
import { GMAIL_CLEAR_MEETING_NOTES_USAGE } from "../../../../../cli/commands/gmail/clearMeetingNotesUsage.js";
import { resolveHandoverDir } from "../../../../../cli/commands/handover/commandSupport.js";
import type { MeetingDocFailure } from "../../../../../corpus/gmail/meetingDocs.js";
import { meetingSourceId, provesMeetingTranscript } from "../../../../../corpus/gmail/meetingProof.js";
import type { CorpusRecord } from "../../../../../corpus/types.js";
import { askExampleProblems } from "../../../../../handover/askExamples.js";
import { cardAlignmentProblems } from "../../../../../handover/cardAlignment.js";
import { accountWorkspace } from "../../../../../handover/workspace.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { DocContent } from "../../../../../live/gmail/docs.js";
import type { ParsedGmailMessage } from "../../../../../live/gmail/parse.js";
import type { Organisation } from "../../../../../organisation/core.js";
import { type OrganisationError, OrganisationErrors } from "../../../../../organisation/errors.js";
import { contentFactsOf, matchingContentIds } from "../../../../../store/contentMatch.js";
import { ACME_ORGANISATION } from "../../../../organisationFixture.js";

const HOME = "/nonexistent/clear-meeting-notes-home";

/** The mailbox the fake read answers from — the account a kept mail's card must be placed by. */
const MAILBOX = "owner@acme.com";

/** One Gemini notes mail in the inbox. */
const notesMail = ({
  id,
  title = `Meeting ${id}`,
  subject = `Notes: '${title}' 2 Oct 2026`,
  from = "Gemini <gemini-notes@google.com>",
}: {
  id: string;
  title?: string;
  subject?: string;
  from?: string;
}): ParsedGmailMessage => ({
  attachments: [],
  body: "Summary",
  bodyFormat: "text",
  cc: [],
  from,
  htmlLinks: [`https://docs.google.com/document/d/doc-${id}/edit`],
  id,
  labelIds: ["INBOX"],
  sentAtIso: "2026-10-02T03:00:00.000Z",
  snippet: undefined,
  subject,
  threadId: `t-${id}`,
  to: [],
});

/** A document holding a real transcript tab. */
const transcribed = ({ id }: { id: string }): DocContent => ({
  documentId: `doc-${id}`,
  tabs: [
    { text: "Attendees: Ana Diaz\nSummary\nThe team met.", title: "Notes" },
    { text: "Transcript\n00:00:00\nAna: shall we ship it\nBo: yes", title: "Transcript" },
  ],
  title: `Meeting ${id}`,
});

/** A document holding Gemini's summary alone — the call was never transcribed. */
const summaryOnly = ({ id }: { id: string }): DocContent => ({
  documentId: `doc-${id}`,
  tabs: [{ text: "Attendees: Ana Diaz\nSummary\nThe team met.", title: "Notes" }],
  title: `Meeting ${id}`,
});

/** A transcript row exactly as bronze would hold one for `notesMail({ id })`. */
const heldRow = ({ id }: { id: string }): CorpusRecord => ({
  attrs: { meetingDate: "2 Oct 2026" },
  container: "mail/meetings",
  kind: "transcript",
  refs: [],
  source: "gmail",
  sourceId: meetingSourceId({ messageId: id }),
  text: "Ana: shall we ship it",
  title: `Meeting ${id}`,
  tsIso: "2026-10-02T03:00:00.000Z",
  url: `https://docs.google.com/document/d/doc-${id}/edit`,
  visibility: "private",
});

/**
 * Every fake edge, recording each call in order; bronze and the store are plain in-memory maps, the store judged by
 * the real content comparator so a stale row reads as stale.
 */
function fakeDeps({
  mail,
  bronze = [],
  store = [],
  documents = {},
  failures = {},
  storeHoldsAfterReplay = true,
  archiveExit = 0,
  failProofs = false,
  unparsed = [],
  openCards = [],
  organisation = ok(ACME_ORGANISATION),
}: {
  mail: readonly ParsedGmailMessage[];
  /** What the organisation read answers; Acme unless a case drives an install with none written. */
  organisation?: Result<Organisation, OrganisationError>;
  unparsed?: readonly string[];
  bronze?: readonly CorpusRecord[];
  store?: readonly CorpusRecord[];
  documents?: Readonly<Record<string, DocContent>>;
  failures?: Readonly<Record<string, MeetingDocFailure>>;
  storeHoldsAfterReplay?: boolean;
  archiveExit?: number;
  failProofs?: boolean;
  /** The slugs of cards still open on the Queue, which `settleCard` settles. */
  openCards?: readonly string[];
}): {
  deps: ClearMeetingNotesDeps;
  calls: string[];
  archived: string[];
  cards: string[];
  /** The mailbox each placed card was handed, in order. */
  cardAccounts: string[];
  out: string[];
  diagnostics: string[];
} {
  const rows = new Map(bronze.map((record) => [record.sourceId, record]));
  const factsOf = ({ record }: { record: CorpusRecord }) => contentFactsOf({ attrKey: MEETING_DATE_ATTR, record });
  const held = new Map(store.map((record) => [record.sourceId, factsOf({ record })]));
  const open = new Set(openCards);
  const calls: string[] = [];
  const archived: string[] = [];
  const cards: string[] = [];
  const cardAccounts: string[] = [];
  const out: string[] = [];
  const diagnostics: string[] = [];
  const deps: ClearMeetingNotesDeps = {
    archive: async ({ id }) => {
      calls.push(`archive ${id}`);
      archived.push(id);
      return archiveExit;
    },
    commit: ({ records }) => {
      calls.push(`commit ${records.map((record) => record.sourceId).join(",")}`);
      for (const record of records) {
        rows.set(record.sourceId, record);
      }
      return ok({ deduped: 0, excluded: 0, window: undefined, written: records.length });
    },
    ensureCard: async ({ account, card }) => {
      calls.push("card");
      cards.push(card.slug);
      cardAccounts.push(account);
      return ok("placed");
    },
    fetchDocs: async ({ messages }) => {
      calls.push(`docs ${messages.map((message) => message.id).join(",")}`);
      return ok({
        documents: new Map(
          messages.flatMap((message) => {
            const document = documents[message.id];
            return document === undefined ? [] : [[message.id, document] as const];
          }),
        ),
        failures: new Map(Object.entries(failures)),
        warnings: [],
      });
    },
    // Kept out of `calls`, whose order each case pins around the mail; the case with none written checks it.
    readOrganisation: async () => organisation,
    readMail: async ({ scope }) => {
      calls.push(`mail ${scope}`);
      return ok({ account: MAILBOX, complete: true, messages: mail, query: `in:${scope} gemini`, unparsed });
    },
    readProofs: ({ expectations }) => {
      calls.push("proofs");
      if (failProofs) {
        return err(ClearMeetingNotesErrors.bronzeReadFailed({ message: "gmail bronze is unreadable" }));
      }
      return ok(
        new Map(
          expectations.map((expectation) => [
            expectation.messageId,
            provesMeetingTranscript({
              expectation,
              record: rows.get(meetingSourceId({ messageId: expectation.messageId })),
            }),
          ]),
        ),
      );
    },
    replayStore: async () => {
      calls.push("replay");
      if (storeHoldsAfterReplay) {
        for (const record of rows.values()) {
          held.set(record.sourceId, factsOf({ record }));
        }
      }
      return ok("store: gmail replayed");
    },
    settleCard: async ({ slug, witness }) => {
      calls.push(`settle ${slug} (${witness})`);
      return ok(open.delete(slug) ? "settled" : "none");
    },
    storeHolds: async ({ expected }) => {
      calls.push("store");
      return ok(matchingContentIds({ expected, stored: held }));
    },
    writeDiagnostic: (line) => {
      diagnostics.push(line);
    },
    writeOut: (line) => {
      out.push(line);
    },
  };
  return { archived, calls, cardAccounts, cards, deps, diagnostics, out };
}

const run = ({ deps, rest = [] }: { deps: ClearMeetingNotesDeps; rest?: readonly string[] }) =>
  runGmailClearMeetingNotes({ deps, rest: [...rest, "--home", HOME] });

describe("parseClearMeetingNotesArgs", () => {
  it("defaults to a real run over 100 mails", () => {
    expect(unwrap(parseClearMeetingNotesArgs({ rest: [] }))).toEqual({
      audit: false,
      dryRun: false,
      home: undefined,
      limit: 100,
    });
  });

  it("reads --audit, --limit and --home", () => {
    expect(unwrap(parseClearMeetingNotesArgs({ rest: ["--audit", "--limit", "500", "--home", "/h"] }))).toEqual({
      audit: true,
      dryRun: false,
      home: "/h",
      limit: 500,
    });
  });

  it("refuses --audit with --dry-run, and a limit outside 1..500", () => {
    const codes = [
      ["--audit", "--dry-run"],
      ["--limit", "0"],
      ["--limit", "501"],
      ["--limit", "ten"],
    ].map((rest) => unwrapErr(parseClearMeetingNotesArgs({ rest })).code);
    expect(codes).toEqual(["FLAGS_INVALID", "INVALID_FLAG_VALUE", "INVALID_FLAG_VALUE", "INVALID_FLAG_VALUE"]);
  });
});

describe("judgeMeeting", () => {
  const evidence = (over: Partial<MeetingEvidence> = {}): MeetingEvidence => ({
    docFailure: undefined,
    inStore: true,
    ingestedNow: false,
    mode: "run",
    projection: undefined,
    recognised: true,
    sourceId: "m1:meeting",
    subjectParsed: true,
    verdict: "proven",
    ...over,
  });

  it("proves a mail only when bronze proves it AND the store holds it", () => {
    expect(judgeMeeting({ evidence: evidence({ ingestedNow: true }) })).toEqual({
      ingestedNow: true,
      kind: "proven",
      sourceId: "m1:meeting",
    });
    expect(judgeMeeting({ evidence: evidence({ inStore: false }) })).toEqual({
      kind: "kept",
      reason: { kind: "not-in-store" },
    });
  });

  it("names the first check each unproven mail fails, and a read document with no transcript as nothing to keep", () => {
    const reasons = [
      evidence({ recognised: false }),
      evidence({ subjectParsed: false }),
      evidence({ verdict: "wrong-title" }),
      evidence({ verdict: "absent" }),
      evidence({ docFailure: { kind: "no-docs-grant", messageId: "m1" }, verdict: "absent" }),
      evidence({ projection: { kind: "summary-only", messageId: "m1" }, verdict: "absent" }),
      evidence({ projection: { kind: "undated", messageId: "m1" }, verdict: "absent" }),
      evidence({
        projection: { kind: "projected", messageId: "m1", record: heldRow({ id: "m1" }) },
        verdict: "absent",
      }),
      evidence({
        mode: "dry-run",
        projection: { kind: "projected", messageId: "m1", record: heldRow({ id: "m1" }) },
        verdict: "absent",
      }),
    ].map((one) => judgeMeeting({ evidence: one }));
    expect(reasons).toEqual([
      { kind: "kept", reason: { kind: "not-a-meeting-mail" } },
      { kind: "kept", reason: { kind: "subject-unparsed" } },
      { kind: "kept", reason: { kind: "bronze-mismatch", verdict: "wrong-title" } },
      { kind: "kept", reason: { kind: "provider-error", message: "no answer was recorded for its document" } },
      { kind: "kept", reason: { kind: "no-docs-grant" } },
      { kind: "no-transcript" },
      { kind: "kept", reason: { kind: "undated" } },
      { kind: "kept", reason: { kind: "not-held-after-commit" } },
      { kind: "kept", reason: { kind: "would-ingest" } },
    ]);
  });
});

describe("keptReasonNeedsOwner", () => {
  it("cards what only the owner can act on, and leaves what the next pass repairs to the exit code", () => {
    expect(
      [
        { kind: "subject-unparsed" } as const,
        { kind: "no-docs-grant" } as const,
        { kind: "not-held-after-commit" } as const,
        { kind: "not-in-store" } as const,
        { kind: "capped" } as const,
        { kind: "would-ingest" } as const,
      ].map((reason) => keptReasonNeedsOwner({ reason })),
    ).toEqual([true, true, true, false, false, false]);
  });
});

describe("the card and its argv", () => {
  const disposition: MeetingDisposition = {
    inInbox: true,
    meetingDate: "2 Oct 2026",
    messageId: "1A0FACC45E0519AF",
    outcome: { kind: "kept", reason: { kind: "no-docs-grant" } },
    title: "Product/Eng Lunch/Learn",
  };

  it("keys the slug by the message, so a second run finds the first run's card", () => {
    expect(meetingCardSlug({ messageId: "1A0FACC45E0519AF" })).toBe("meeting-notes-mail-1a0facc45e0519af");
  });

  it("names the meeting and why in the ask, and passes every field to handover register", () => {
    const card = meetingCard({ disposition, reason: { kind: "no-docs-grant" } });
    expect(card.ask).toBe(
      "Archive the Gemini notes mail for 'Product/Eng Lunch/Learn' 2 Oct 2026 without its transcript in the corpus? " +
        "It stays in the inbox until you answer. It stayed because the Gmail grant does not carry the Google Docs " +
        "scope, so the notes document cannot be read.",
    );
    expect(card.lean).toBe("Re-run `slopweaver gmail connect --grant manage` and approve Google Docs");
    const workspace = accountWorkspace({
      account: "Owner@Acme.com",
      organisation: ACME_ORGANISATION,
      what: "the Gemini notes mail of a meeting",
    });
    const argv = meetingCardArgv({ card, home: "/h", workspace });
    expect(argv.slice(0, 4)).toEqual(["node", "slopweaver", "handover", "register"]);
    expect(argv[argv.indexOf("--options") + 1]).toBe(card.options.join("\n"));
    expect(argv.slice(-6)).toEqual([
      "--workspace",
      "team",
      "--workspace-because",
      "the Gemini notes mail of a meeting is in owner@acme.com, an account on acme.com",
      "--home",
      "/h",
    ]);
  });

  it("states no workspace for a card whose mail was read in a mailbox off the organisation's domain", () => {
    const card = meetingCard({ disposition, reason: { kind: "no-link" } });
    const workspace = accountWorkspace({
      account: "someone@gmail.com",
      organisation: ACME_ORGANISATION,
      what: "the Gemini notes mail of a meeting",
    });
    const argv = meetingCardArgv({ card, home: "/h", workspace });
    expect([workspace, argv.includes("--workspace"), argv.slice(-2)]).toEqual([undefined, false, ["--home", "/h"]]);
  });

  it("opens every carded reason's card on a question, so handover register's alignment gate takes it", () => {
    const carded: readonly KeptMeetingReason[] = [
      { kind: "subject-unparsed" },
      { kind: "undated" },
      { kind: "no-link" },
      { kind: "malformed-link" },
      { kind: "no-docs-grant" },
      { kind: "provider-error", message: "The caller does not have permission." },
      // A provider's own words may carry a request id; the heading must not lead with it either.
      { kind: "provider-error", message: "request 1a14278e297b21e8 failed" },
      { kind: "bronze-mismatch", verdict: "wrong-title" },
      { kind: "not-held-after-commit" },
    ];
    expect(carded.length).toBeGreaterThan(0);
    // A real Gmail id is lowercase hex — a recipe firing was refused on exactly this one.
    const untitled = { ...disposition, meetingDate: undefined, messageId: "1a14278e297b21e8", title: undefined };
    // A subject title is not ours to word: punctuated (a review counterexample) or naming a hex id.
    const sentences = { ...disposition, title: "One. Two." };
    const coded = { ...disposition, title: "Retro on 1a14278e297b21e8" };
    const problems = carded.flatMap((reason) =>
      [disposition, untitled, sentences, coded].flatMap((one) =>
        cardAlignmentProblems({ question: meetingCard({ disposition: one, reason }).ask }),
      ),
    );
    expect(problems).toEqual([]);
  });

  it("moves a title the heading gate would refuse into parentheses after the words, rather than failing the run", () => {
    const coded = { ...disposition, title: "Retro on 1a14278e297b21e8" };
    const card = meetingCard({ disposition: coded, reason: { kind: "no-link" } });
    expect(card.ask).toBe(
      "Archive the Gemini notes mail for the meeting ('Retro on 1a14278e297b21e8' 2 Oct 2026) without its transcript " +
        "in the corpus? It stays in the inbox until you answer. It stayed because the mail links no notes document, so " +
        "there is no transcript to read.",
    );
  });

  it("falls to the plain ask when even the parenthesised title would be refused", () => {
    const unbalanced = { ...disposition, title: "Retro) on 1a14278e297b21e8" };
    const card = meetingCard({ disposition: unbalanced, reason: { kind: "no-link" } });
    expect([card.ask, card.problem]).toEqual([
      "Archive this Gemini notes mail without its transcript in the corpus? It stays in the inbox until you answer.",
      "the mail links no notes document, so there is no transcript to read",
    ]);
  });

  // Every open card leads with a concrete scene, so this one carries its own.
  it("leads with a scene naming the meeting and why it stayed, ending on the card's question", () => {
    const card = meetingCard({ disposition, reason: { kind: "no-link" } });
    expect(card.example).toBe(
      "You open your inbox and the Gemini notes mail for 'Product/Eng Lunch/Learn' 2 Oct 2026 is still there. It " +
        "stayed because the mail links no notes document, so there is no transcript to read. Archive it without its " +
        "transcript in the corpus?",
    );
    const argv = meetingCardArgv({ card, home: "/h", workspace: undefined });
    expect(argv[argv.indexOf("--example") + 1]).toBe(card.example);
  });

  it("falls to the plain scene when the meeting's own words would break the shape, rather than refusing the card", () => {
    const long = { kind: "provider-error", message: "word ".repeat(60).trim() } as const;
    const card = meetingCard({ disposition, reason: long });
    expect(card.example).toBe(
      "You open your inbox and a Gemini notes mail is still sitting there, kept back from archiving. Archive it " +
        "without its transcript in the corpus?",
    );
    expect(askExampleProblems({ examples: [card.example], gap: undefined })).toEqual([]);
  });
});

describe("clearMeetingNotesExit", () => {
  const report = (over: Partial<ClearMeetingNotesReport>): ClearMeetingNotesReport => ({
    archived: [],
    cards: new Map(),
    cardsSettled: [],
    complete: true,
    dispositions: [],
    mode: "run",
    query: "q",
    unparsed: [],
    ...over,
  });
  const keptFor = ({ kind }: { kind: "not-in-store" | "subject-unparsed" }): MeetingDisposition => ({
    inInbox: true,
    meetingDate: undefined,
    messageId: "m",
    outcome: { kind: "kept", reason: { kind } },
    title: undefined,
  });
  const untranscribed: MeetingDisposition = {
    inInbox: true,
    meetingDate: undefined,
    messageId: "m",
    outcome: { kind: "no-transcript" },
    title: undefined,
  };

  it("is 3 over an empty scope, and 1 when the read was not complete", () => {
    expect([
      clearMeetingNotesExit({ report: report({}) }),
      clearMeetingNotesExit({ report: report({ complete: false }) }),
    ]).toEqual([3, 1]);
  });

  it("in a run, passes a carded or never-transcribed mail and fails one the next pass must repair", () => {
    expect([
      clearMeetingNotesExit({ report: report({ dispositions: [keptFor({ kind: "subject-unparsed" })] }) }),
      clearMeetingNotesExit({ report: report({ dispositions: [untranscribed] }) }),
      clearMeetingNotesExit({ report: report({ dispositions: [keptFor({ kind: "not-in-store" })] }) }),
    ]).toEqual([0, 0, 1]);
  });

  it("in an audit, passes only proven or never-transcribed mail", () => {
    expect([
      clearMeetingNotesExit({ report: report({ dispositions: [untranscribed], mode: "audit" }) }),
      clearMeetingNotesExit({
        report: report({ dispositions: [keptFor({ kind: "subject-unparsed" })], mode: "audit" }),
      }),
    ]).toEqual([0, 1]);
  });
});

describe("runGmailClearMeetingNotes", () => {
  // The owner's rule: a mail with no transcript is simply archived — so the summary-only mail is archived and nothing about it is carded.
  it("ingests what bronze lacks, proves it again, archives the proven and the never-transcribed, then cards the rest", async () => {
    const fake = fakeDeps({
      bronze: [heldRow({ id: "held" })],
      documents: { fresh: transcribed({ id: "fresh" }), lunch: summaryOnly({ id: "lunch" }) },
      failures: { locked: { kind: "no-docs-grant", messageId: "locked" } },
      mail: [
        notesMail({ id: "held" }),
        notesMail({ id: "fresh" }),
        notesMail({ id: "lunch" }),
        notesMail({ id: "locked" }),
      ],
      openCards: ["meeting-notes-mail-held", "meeting-notes-mail-lunch"],
      store: [heldRow({ id: "held" })],
    });

    const code = await run({ deps: fake.deps });

    expect(code).toBe(0);
    expect(fake.calls).toEqual([
      "mail inbox",
      "proofs",
      "docs fresh,lunch,locked",
      "commit fresh:meeting",
      "proofs",
      "store",
      "replay",
      "store",
      "archive held",
      "archive fresh",
      "archive lunch",
      "settle meeting-notes-mail-held (gmail held:meeting proven and out of the inbox)",
      "settle meeting-notes-mail-fresh (gmail fresh:meeting proven and out of the inbox)",
      "settle meeting-notes-mail-lunch (gmail lunch notes document read with no transcript to download, and out of the inbox)",
      "card",
    ]);
    expect(fake.archived).toEqual(["held", "fresh", "lunch"]);
    expect(fake.cards).toEqual(["meeting-notes-mail-locked"]);
    // The card carries the mailbox the read ran in, never the grant as it stands at placement.
    expect(fake.cardAccounts).toEqual([MAILBOX]);
    expect(fake.out).toContain(
      "  held 'Meeting held' 2 Oct 2026 — proven: gmail held:meeting (already held) · archived · card " +
        "meeting-notes-mail-held settled",
    );
    expect(fake.out).toContain(
      "  fresh 'Meeting fresh' 2 Oct 2026 — proven: gmail fresh:meeting (ingested now) · archived",
    );
    expect(fake.out).toContain(
      "  lunch 'Meeting lunch' 2 Oct 2026 — no transcript: the notes document holds Gemini's summary and no " +
        "transcript — the call was not transcribed, so there is nothing to download · archived · card " +
        "meeting-notes-mail-lunch settled",
    );
    expect(fake.out.at(-1)).toBe("proven 2 · no transcript 1 · archived 3 · kept 1 · carded 1");
  });

  it("settles an open card under a never-transcribed mail already out of the inbox, and archives nothing", async () => {
    const outOfInbox = { ...notesMail({ id: "lunch" }), labelIds: [] };
    const fake = fakeDeps({
      documents: { lunch: summaryOnly({ id: "lunch" }) },
      mail: [outOfInbox],
      openCards: ["meeting-notes-mail-lunch"],
    });

    expect(await run({ deps: fake.deps })).toBe(0);
    expect([fake.archived, fake.cards]).toEqual([[], []]);
    expect(fake.calls.filter((call) => call.startsWith("settle"))).toEqual([
      "settle meeting-notes-mail-lunch (gmail lunch notes document read with no transcript to download, and out of the inbox)",
    ]);
  });

  it("keeps a mail the store still lacks after a replay, archives nothing, and exits 1", async () => {
    const fake = fakeDeps({
      bronze: [heldRow({ id: "held" })],
      mail: [notesMail({ id: "held" })],
      storeHoldsAfterReplay: false,
    });

    const code = await run({ deps: fake.deps });

    expect([code, fake.archived, fake.cards]).toEqual([1, [], []]);
    expect(fake.calls).toEqual(["mail inbox", "proofs", "proofs", "store", "replay", "store"]);
  });

  it("reads a stale store row under the proven key as not held, replays, and archives once it matches", async () => {
    const stale = { ...heldRow({ id: "held" }), text: "Ana: an earlier draft" };
    const fake = fakeDeps({ bronze: [heldRow({ id: "held" })], mail: [notesMail({ id: "held" })], store: [stale] });

    const code = await run({ deps: fake.deps });

    expect([code, fake.archived]).toEqual([0, ["held"]]);
    expect(fake.calls.slice(0, 7)).toEqual([
      "mail inbox",
      "proofs",
      "proofs",
      "store",
      "replay",
      "store",
      "archive held",
    ]);
  });

  it("reads a store row dated other than the mail as stale, and keeps the mail while it stays so", async () => {
    const misdated = { ...heldRow({ id: "held" }), attrs: { meetingDate: "1 Oct 2026" } };
    const fake = fakeDeps({
      bronze: [heldRow({ id: "held" })],
      mail: [notesMail({ id: "held" })],
      store: [misdated],
      storeHoldsAfterReplay: false,
    });

    const code = await run({ deps: fake.deps });

    expect([code, fake.archived, fake.cards]).toEqual([1, [], []]);
    expect(fake.calls).toEqual(["mail inbox", "proofs", "proofs", "store", "replay", "store"]);
  });

  it("settles an open card under a proven mail already out of the inbox, and archives nothing", async () => {
    const outOfInbox = { ...notesMail({ id: "gone" }), labelIds: [] };
    const fake = fakeDeps({
      bronze: [heldRow({ id: "gone" })],
      mail: [outOfInbox],
      openCards: ["meeting-notes-mail-gone"],
      store: [heldRow({ id: "gone" })],
    });

    expect(await run({ deps: fake.deps })).toBe(0);
    expect(fake.archived).toEqual([]);
    expect(fake.out).toContain(
      "  gone 'Meeting gone' 2 Oct 2026 (archived) — proven: gmail gone:meeting (already held) · card " +
        "meeting-notes-mail-gone settled",
    );
  });

  it("keeps a mail whose store row stays stale after a replay, and archives nothing", async () => {
    const stale = { ...heldRow({ id: "held" }), title: "Meeting elsewhere" };
    const fake = fakeDeps({
      bronze: [heldRow({ id: "held" })],
      mail: [notesMail({ id: "held" })],
      store: [stale],
      storeHoldsAfterReplay: false,
    });

    const code = await run({ deps: fake.deps });

    expect([code, fake.archived, fake.cards]).toEqual([1, [], []]);
  });

  it("archives nothing at all when bronze cannot be read, rather than archiving on no proof", async () => {
    const fake = fakeDeps({ failProofs: true, mail: [notesMail({ id: "held" })], unparsed: ["broken"] });

    const code = await run({ deps: fake.deps });

    expect([code, fake.archived, fake.cards]).toEqual([1, [], []]);
    expect(fake.diagnostics).toEqual([
      "bronze proof: gmail bronze is unreadable",
      "nothing was archived: a mail is archived only on proof, and this run could not prove",
      "  held — kept: not judged, because the run stopped before proving anything",
      "  broken — kept: not judged, because the run stopped before proving anything",
    ]);
  });

  it("under --dry-run, commits, replays, archives and cards nothing, and names what a run would ingest", async () => {
    const fake = fakeDeps({
      documents: { fresh: transcribed({ id: "fresh" }), lunch: summaryOnly({ id: "lunch" }) },
      mail: [notesMail({ id: "fresh" }), notesMail({ id: "lunch" })],
    });

    const code = await run({ deps: fake.deps, rest: ["--dry-run"] });

    expect(code).toBe(0);
    expect(fake.calls).toEqual(["mail inbox", "proofs", "docs fresh,lunch", "proofs"]);
    expect(fake.out).toContain(
      "  fresh 'Meeting fresh' 2 Oct 2026 — kept: the transcript is readable and not yet in the corpus; a run would " +
        "ingest it, then archive",
    );
    expect(fake.out).toContain(
      "  lunch 'Meeting lunch' 2 Oct 2026 — no transcript: the notes document holds Gemini's summary and no " +
        "transcript — the call was not transcribed, so there is nothing to download; a run archives it",
    );
  });

  it("under --audit, reads the whole mailbox and changes nothing", async () => {
    const fake = fakeDeps({
      bronze: [heldRow({ id: "held" })],
      mail: [notesMail({ id: "held" })],
      store: [heldRow({ id: "held" })],
    });

    const code = await run({ deps: fake.deps, rest: ["--audit"] });

    expect(code).toBe(0);
    expect(fake.calls).toEqual(["mail anywhere", "proofs", "proofs", "store"]);
  });

  it("archives one id per call, so each exit code speaks for exactly one mail", async () => {
    const fake = fakeDeps({
      bronze: [heldRow({ id: "a" }), heldRow({ id: "b" })],
      mail: [notesMail({ id: "a" }), notesMail({ id: "b" })],
      store: [heldRow({ id: "a" }), heldRow({ id: "b" })],
    });

    expect(await run({ deps: fake.deps })).toBe(0);
    expect(fake.calls.filter((call) => call.startsWith("archive"))).toEqual(["archive a", "archive b"]);
  });

  it("exits 1 when an archive call fails, reports that mail not archived, and leaves its card open", async () => {
    const fake = fakeDeps({
      archiveExit: 1,
      bronze: [heldRow({ id: "held" })],
      mail: [notesMail({ id: "held" })],
      openCards: ["meeting-notes-mail-held"],
      store: [heldRow({ id: "held" })],
    });

    expect(await run({ deps: fake.deps })).toBe(1);
    expect(fake.calls.filter((call) => call.startsWith("settle"))).toEqual([]);
    expect(fake.out.at(-1)).toBe("proven 1 · no transcript 0 · archived 0 · kept 0 · carded 0");
  });

  it("cards a subject with no quoted title instead of guessing what to prove against", async () => {
    const fake = fakeDeps({
      mail: [notesMail({ id: "adhoc", subject: "Notes: Meeting on 7 Sept 2026 at 3:17 PM AEST" })],
    });

    expect(await run({ deps: fake.deps })).toBe(0);
    expect([fake.archived, fake.cards]).toEqual([[], ["meeting-notes-mail-adhoc"]]);
  });

  it("places no card and fails the run when no organisation is written, never a card placed by a guess", async () => {
    const notConfigured = OrganisationErrors.notConfigured({ missing: "organisation" });
    const fake = fakeDeps({
      mail: [notesMail({ id: "adhoc", subject: "Notes: Meeting on 7 Sept 2026 at 3:17 PM AEST" })],
      organisation: err(notConfigured),
    });

    expect(await run({ deps: fake.deps })).toBe(1);
    expect([fake.cards, fake.diagnostics.includes(notConfigured.message)]).toEqual([[], true]);
  });

  it("reads no organisation for a run that owes no card", async () => {
    const fake = fakeDeps({
      mail: [],
      organisation: err(OrganisationErrors.notConfigured({ missing: "organisation" })),
    });
    expect(await run({ deps: fake.deps })).toBe(3);
  });

  it("prints the usage under --help, reading nothing", async () => {
    const fake = fakeDeps({ mail: [] });
    expect(await run({ deps: fake.deps, rest: ["--help"] })).toBe(0);
    expect([fake.out, fake.calls]).toEqual([[GMAIL_CLEAR_MEETING_NOTES_USAGE], []]);
  });

  it("refuses a bad flag with exit 2, reading nothing", async () => {
    const fake = fakeDeps({ mail: [] });
    expect(await run({ deps: fake.deps, rest: ["--audit", "--dry-run"] })).toBe(2);
    expect(fake.calls).toEqual([]);
  });

  it("reads the line for an empty inbox and exits 3", async () => {
    const fake = fakeDeps({ mail: [] });
    expect(await run({ deps: fake.deps })).toBe(3);
    expect(fake.out.at(-1)).toBe("proven 0 · no transcript 0 · archived 0 · kept 0 · carded 0");
  });

  it("names each mail Gmail answered unparseably, keeps it, and exits 1 even beside an archive", async () => {
    const fake = fakeDeps({
      bronze: [heldRow({ id: "held" })],
      mail: [notesMail({ id: "held" })],
      store: [heldRow({ id: "held" })],
      unparsed: ["broken"],
    });

    expect(await run({ deps: fake.deps })).toBe(1);
    expect(fake.archived).toEqual(["held"]);
    expect(fake.out.slice(-2)).toEqual([
      "  broken — kept: Gmail answered it with no id or thread id, so it could not be judged",
      "proven 1 · no transcript 0 · archived 1 · kept 1 · carded 0",
    ]);
  });
});

describe("clearMeetingNotesLines", () => {
  it("marks a mail outside the inbox and names a placed card", () => {
    const lines = clearMeetingNotesLines({
      report: {
        archived: [],
        cards: new Map([["m2", "existing"]]),
        cardsSettled: [],
        complete: false,
        dispositions: [
          {
            inInbox: false,
            meetingDate: "1 Oct 2026",
            messageId: "m1",
            outcome: { ingestedNow: false, kind: "proven", sourceId: "m1:meeting" },
            title: "Standup",
          },
          {
            inInbox: true,
            meetingDate: undefined,
            messageId: "m2",
            outcome: { kind: "kept", reason: { kind: "no-link" } },
            title: undefined,
          },
        ],
        mode: "audit",
        query: "q",
        unparsed: [],
      },
    });
    expect(lines).toEqual([
      "gmail clear-meeting-notes (audit): 2 meeting-notes mail(s) for `q` — NOT every match was read; raise --limit",
      "  m1 'Standup' 1 Oct 2026 (archived) — proven: gmail m1:meeting (already held)",
      "  m2 an untitled meeting (message m2) — kept: the mail links no notes document, so there is no transcript to read · card " +
        "meeting-notes-mail-m2 (existing)",
      "proven 1 · no transcript 0 · archived 0 · kept 1 · carded 1",
    ]);
  });

  it("names a settled card as off the Queue, with the archive the owner's answer may leave", () => {
    const lines = clearMeetingNotesLines({
      report: {
        archived: [],
        cards: new Map([["m2", "settled"]]),
        cardsSettled: [],
        complete: true,
        dispositions: [
          {
            inInbox: true,
            meetingDate: "2 Oct 2026",
            messageId: "m2",
            outcome: { kind: "kept", reason: { kind: "no-link" } },
            title: "Lunch",
          },
        ],
        mode: "run",
        query: "q",
        unparsed: [],
      },
    });
    expect(lines[1]).toBe(
      "  m2 'Lunch' 2 Oct 2026 — kept: the mail links no notes document, so there is no transcript to read · card " +
        "meeting-notes-mail-m2 (settled, off the Queue: if the owner said archive it, run `slopweaver gmail archive m2`)",
    );
  });
});

describe("ensureMeetingCard over a real handover directory", () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  /** A home whose handover directory holds the card for `m2`, live or archived. */
  const homeWithCard = ({ archived }: { archived: boolean }): string => {
    const home = mkdtempSync(join(tmpdir(), "meeting-card-"));
    homes.push(home);
    const handovers = resolveHandoverDir({ dir: undefined, home });
    const dir = archived ? join(handovers, "archive") : handovers;
    mkdirSync(dir, { recursive: true });
    const slug = meetingCardSlug({ messageId: "m2" });
    writeFileSync(join(dir, `${slug}.md`), `---\nslug: ${slug}\nstatus: ready\n---\n`, "utf8");
    return home;
  };

  const card = meetingCard({
    disposition: {
      inInbox: true,
      meetingDate: "2 Oct 2026",
      messageId: "m2",
      outcome: { kind: "kept", reason: { kind: "no-link" } },
      title: "Lunch",
    },
    reason: { kind: "no-link" },
  });

  it("reads a live card as still standing, and an archived one as settled, placing neither again", async () => {
    const live = await ensureMeetingCard({
      account: MAILBOX,
      organisation: ACME_ORGANISATION,
      card,
      home: homeWithCard({ archived: false }),
    });
    const settled = await ensureMeetingCard({
      account: MAILBOX,
      organisation: ACME_ORGANISATION,
      card,
      home: homeWithCard({ archived: true }),
    });
    expect([unwrap(live), unwrap(settled)]).toEqual(["existing", "settled"]);
  });

  it("places a card once, settles it once its mail is proven out of the inbox, and then reads it as settled", async () => {
    const home = mkdtempSync(join(tmpdir(), "meeting-card-"));
    homes.push(home);
    const witness = "gmail m2:meeting proven and out of the inbox";

    const placed = await ensureMeetingCard({ account: MAILBOX, organisation: ACME_ORGANISATION, card, home });
    const closed = await settleMeetingCard({ home, slug: card.slug, witness });
    const again = await settleMeetingCard({ home, slug: card.slug, witness });
    const read = await ensureMeetingCard({ account: MAILBOX, organisation: ACME_ORGANISATION, card, home });

    expect([unwrap(placed), unwrap(closed), unwrap(again), unwrap(read)]).toEqual([
      "placed",
      "settled",
      "none",
      "settled",
    ]);
  });

  // A recipe firing: an untitled mail's card, through the real `handover register` gate.
  it("places the card of an untitled mail whose id is lowercase hex", async () => {
    const home = mkdtempSync(join(tmpdir(), "meeting-card-"));
    homes.push(home);
    const untitled = meetingCard({
      disposition: {
        inInbox: true,
        meetingDate: undefined,
        messageId: "1a14278e297b21e8",
        outcome: { kind: "kept", reason: { kind: "subject-unparsed" } },
        title: undefined,
      },
      reason: { kind: "subject-unparsed" },
    });
    expect(
      unwrap(await ensureMeetingCard({ account: MAILBOX, organisation: ACME_ORGANISATION, card: untitled, home })),
    ).toBe("placed");
  });

  it("places the card of a mail whose provider error runs to several sentences", async () => {
    const home = mkdtempSync(join(tmpdir(), "meeting-card-"));
    homes.push(home);
    const reason = {
      kind: "provider-error",
      message: "The caller does not have permission. Request 1a14278e297b21e8 was denied.",
    } as const;
    const denied = meetingCard({
      disposition: {
        inInbox: true,
        meetingDate: "2 Oct 2026",
        messageId: "1a14278e297b21e8",
        outcome: { kind: "kept", reason },
        title: "Lunch",
      },
      reason,
    });
    expect(
      unwrap(await ensureMeetingCard({ account: MAILBOX, organisation: ACME_ORGANISATION, card: denied, home })),
    ).toBe("placed");
  });

  it("settles nothing where no card stands", async () => {
    const home = mkdtempSync(join(tmpdir(), "meeting-card-"));
    homes.push(home);
    expect(unwrap(await settleMeetingCard({ home, slug: card.slug, witness: "w" }))).toBe("none");
  });
});
