/**
 * The SHIPPED binary, `talk find-card`, over a throwaway board — the seam the unit lane cannot reach: the board read,
 * the ranking and the composition together, exactly as the voice's verb tool spawns it.
 *
 * The load-bearing case is the composition. The matched row is blocked by a row the owner's words never reach, and only
 * composing that blocker beside it (`compositionRoots`) places the match the way `handover list` does: waiting on
 * another row first, never ready for a session.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendSlackDraftEvent } from "../../../../../admit/slackDraftStore.js";
import { appendRunEvent } from "../../../../../handover/runStore.js";
import { unwrap } from "../../../../../lib/result.js";
import {
  type ParkedSlackDraft,
  type ParkedSlackDraftMedia,
  parkedDraftDigest,
} from "../../../../../outbound/slack/draftRegister.js";
import { accountSandboxChildEnv } from "../../../../accountHomeSandboxChild.js";
import { storeAnnotatedShot } from "../../../../annotatedShotFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

/** One board doc, synthetic words. */
const doc = ({
  slug,
  summary,
  status,
  blockedBy,
}: {
  slug: string;
  summary: string;
  status: string;
  blockedBy: readonly string[];
}): string =>
  [
    "---",
    `slug: ${slug}`,
    "kind: ask",
    `summary: "${summary}"`,
    `status: ${status}`,
    "askedIso: 2026-10-01T00:00:00.000Z",
    `blockedBy: [${blockedBy.join(", ")}]`,
    "---",
    "",
    `# ${summary}`,
    "",
  ].join("\n");

const BOARD = [
  {
    blockedBy: ["rotate-the-credentials"],
    slug: "voice-does-what-agents-do",
    status: "ready",
    summary: "The console voice can do what other agents can: open the owner's browser and run slopweaver verbs",
  },
  { blockedBy: [], slug: "rotate-the-credentials", status: "ready", summary: "Rotate the database credentials" },
  {
    blockedBy: [],
    slug: "voice-opens-a-page",
    status: "done",
    summary: "The console voice opens a page in the owner's browser",
  },
  { blockedBy: [], slug: "invoice-reconcile", status: "ready", summary: "Reconcile the quarter's invoices" },
];

/** One held plain message as the owner, shaped on the incident's two drafts. */
function parked({
  channel,
  channelName,
  id,
  media = [],
  text,
  why,
}: {
  channel: string;
  channelName: string;
  id: string;
  /** Stored attachments; empty adds no field, exactly as the recorder writes a text-only row. */
  media?: readonly ParkedSlackDraftMedia[];
  text: string;
  why: string;
}): ParkedSlackDraft {
  const content = {
    authorId: "U0ME",
    channel,
    mentions: [],
    payload: { form: "plain" as const, text, unfurl_links: false, unfurl_media: false },
    ...(media.length > 0 ? { media } : {}),
  };
  return {
    ...content,
    advisory: [],
    channelName,
    digest: parkedDraftDigest({ draft: content }),
    form: JSON.stringify({ sections: [{ kind: "prose", text }] }),
    id,
    kind: "message",
    shape: "top-level",
    tsIso: "2026-10-20T02:41:50.437Z",
    why,
  };
}

/** The Tobias draft's whole message. */
const TOBIAS_TEXT = "yep, here's the linear split i'm thinking, nothing created yet. what do you think?";

const TOBIAS = parked({
  channel: "D0SYN000003",
  channelName: "D0SYN000003",
  id: "sd-75646f68",
  text: TOBIAS_TEXT,
  why: "answers Tobias's ask for the Linear bullet points: the initiative and three projects as nested dot points",
});

/**
 * The device-check draft, a first message in a channel carrying the link and the annotated screenshot (stored under
 * `home`) that keep it held on the owner's Queue rather than sent back.
 */
const deviceCheck = ({ home }: { home: string }): ParkedSlackDraft =>
  parked({
    channel: "C0SYN000001",
    channelName: "proj-launch-room",
    id: "sd-92e4dd66",
    media: [storeAnnotatedShot({ home })],
    text: "A stand-in claim about an unrelated device check (<https://fixture.example/device-check|the test>); can its owners look at it this week?",
    why: "card action: an unrelated device check",
  });

let scratch: string;
let home: string;
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "slop-find-card-"));
  home = join(scratch, "home");
  mkdirSync(join(home, "handovers"), { recursive: true });
  for (const row of BOARD) {
    writeFileSync(join(home, "handovers", `${row.slug}.md`), doc(row));
  }
});
afterEach(() => {
  rmSync(scratch, { force: true, recursive: true });
});

/** Run the verb over the throwaway board and parse its JSON answer. */
const findCard = ({
  words,
}: {
  words: readonly string[];
}): { status: number | null; answer: Record<string, unknown> } => {
  const ran = spawnSync(BIN, ["talk", "find-card", ...words, "--home", home, "--json"], {
    cwd: scratch,
    encoding: "utf8",
    env: { ...accountSandboxChildEnv(), HOME: scratch, PATH: process.env["PATH"]!, SLOPWEAVER_HOME: home },
  });
  return { answer: JSON.parse(ran.stdout) as Record<string, unknown>, status: ran.status };
};

describe("bin/slopweaver talk find-card", () => {
  it("names the row about the owner's words, placed behind the blocker those words never reached, then the closed one", () => {
    const { answer, status } = findCard({ words: ["voice", "other", "agents", "browser", "slopweaver", "verbs"] });
    expect(status).toBe(0);
    expect(answer["cards"]).toEqual([
      {
        matched: ["voice", "other", "agent", "browser", "slopweaver", "verb"],
        ownerWait: "not-waiting",
        section: "NOT YET",
        slug: "voice-does-what-agents-do",
        summary: "The console voice can do what other agents can: open the owner's browser and run slopweaver verbs",
        unchecked: false,
      },
      {
        matched: ["voice", "browser"],
        ownerWait: "not-waiting",
        section: "DONE",
        slug: "voice-opens-a-page",
        summary: "The console voice opens a page in the owner's browser",
        unchecked: false,
      },
    ]);
    expect(answer["rowsSearched"]).toBe(4);
  });

  it("says there is no card when no row is about the owner's words", () => {
    const { answer, status } = findCard({ words: ["kubernetes"] });
    expect(status).toBe(0);
    expect(answer["answer"]).toBe(
      `nothing matches "kubernetes" — there is no card for that yet (searched 4 board rows' summaries, the owner's words and open questions, and 0 held drafts on the owner's Queue)`,
    );
    expect(answer["cards"]).toEqual([]);
    expect(answer["drafts"]).toEqual([]);
  });

  // The owner asked for the Tobias Linear draft held on their Queue, find-card searched only board rows, and the
  // voice named the device-check draft open on their screen instead. The register is read by the
  // shipped binary off a real `--home`, so this is the seam the voice's verb tool spawns.
  it("finds the held draft the owner asked for by their exact words, by its Queue key, and never the other held draft", () => {
    parkDrafts({ drafts: [deviceCheck({ home }), TOBIAS] });
    const { answer, status } = findCard({ words: ["Where's that linear briefing? Or queue card draft"] });
    expect(status).toBe(0);
    expect(answer["drafts"]).toEqual([
      {
        as: "you",
        id: "sd-75646f68",
        key: "post:sd-75646f68",
        matched: ["linear"],
        says: TOBIAS_TEXT,
        to: "a direct message",
        why: TOBIAS.why,
      },
    ]);
    expect(answer["draftsSearched"]).toBe(2);
    expect(String(answer["answer"]).split("\n").slice(1, 3)).toEqual([
      "held drafts on your Queue (open_card the key to put one in front of the owner):",
      `  post:sd-75646f68 — on your Queue, a held draft waiting on your word, to a direct message as you — ${TOBIAS.why} — it says "${TOBIAS_TEXT}" (matched linear)`,
    ]);
    expect(answer["answer"]).not.toContain("sd-92e4dd66");
  });

  it("never names a draft that was sent or dropped, which the Queue no longer draws", () => {
    parkDrafts({ drafts: [TOBIAS, { ...TOBIAS, id: "sd-dropped0" }] });
    unwrap(
      appendSlackDraftEvent({
        event: {
          channel: TOBIAS.channel,
          id: TOBIAS.id,
          kind: "released",
          ts: "1.2",
          tsIso: "2026-10-20T04:27:00.000Z",
        },
        home,
      }),
    );
    unwrap(
      appendSlackDraftEvent({
        event: { id: "sd-dropped0", kind: "dropped", note: "superseded", tsIso: "2026-10-20T04:26:00.000Z" },
        home,
      }),
    );
    const { answer, status } = findCard({ words: ["linear", "tobias", "draft"] });
    expect(status).toBe(0);
    expect(answer["drafts"]).toEqual([]);
    expect(answer["draftsSearched"]).toBe(0);
  });

  // Two docs carrying one slug collapsed to the later one, so a blocker the board counts
  // done (the earlier doc is) left the match NOT YET where `handover list` puts it in RUN NOW.
  it("counts a blocker done when any doc carrying its slug is, as the whole board does", () => {
    const shared = [
      { blockedBy: [], file: "00-done.md", slug: "shared-blocker", status: "done", summary: "Finished prerequisite" },
      { blockedBy: [], file: "01-ready.md", slug: "shared-blocker", status: "ready", summary: "Unused prerequisite" },
      {
        blockedBy: ["shared-blocker"],
        file: "02-target.md",
        slug: "voice-target",
        status: "ready",
        summary: "Telephony transport",
      },
    ];
    for (const row of shared) {
      writeFileSync(join(home, "handovers", row.file), doc(row));
    }
    const { answer, status } = findCard({ words: ["telephony"] });
    expect(status).toBe(0);
    expect(answer["cards"]).toEqual([
      {
        matched: ["telephony"],
        ownerWait: "not-waiting",
        section: "RUN NOW",
        slug: "voice-target",
        summary: "Telephony transport",
        unchecked: false,
      },
    ]);
  });

  // A row the owner had already ruled on was named as on their Queue, the voice called
  // open_card on it, and the console refused it in front of them. The journal is what makes it already-ruled, so only
  // a real run directory read by the shipped binary proves the verdict reaches the line.
  it("says a row the owner already ruled on is not on their Queue, off its journal", () => {
    const slug = "onboarding-flow-briefing";
    writeFileSync(
      join(home, "handovers", `${slug}.md`),
      doc({ blockedBy: [], slug, status: "ready", summary: "Onboarding flow implementation briefing" }),
    );
    waitingJournal({ question: "Are the mockups buildable?", slug });
    unwrap(
      appendRunEvent({
        event: {
          anchor: "transcript:a#b",
          atIso: "2026-10-19T11:21:34.000Z",
          decidedIso: "2026-10-19T11:21:34.000Z",
          kind: "ruling",
          ruling: "prep the installer while approval waits",
        },
        runsDir: join(home, "runs"),
        slug,
      }),
    );
    const { answer, status } = findCard({ words: ["onboarding", "flow", "briefing"] });
    expect(status).toBe(0);
    expect(answer["cards"]).toEqual([
      {
        matched: ["onboarding", "flow", "briefing"],
        ownerWait: "already-ruled",
        section: "WAITING ON OWNER",
        slug,
        summary: "Onboarding flow implementation briefing",
        unchecked: false,
      },
    ]);
    expect(answer["answer"]).toContain(
      `${slug} — not on your Queue: you already ruled on it, and it waits on a session to act on that [WAITING ON OWNER]`,
    );
  });

  // The Queue draws a run waiting on the owner's word whose doc left the board, and find-card searched
  // only the board's docs, so it answered "there is no card for that yet" for one the owner could see.
  it("finds a run waiting on the owner's word whose doc is gone, by its question, on their Queue", () => {
    waitingJournal({ question: "Should the gateway retry quarantine rollouts?", slug: "gone-gateway-ask" });
    const { answer, status } = findCard({ words: ["gateway", "quarantine"] });
    expect(status).toBe(0);
    expect(answer["cards"]).toEqual([
      {
        matched: ["gateway", "quarantine"],
        ownerWait: "owner",
        section: "WAITING ON OWNER",
        slug: "gone-gateway-ask",
        summary: "Should the gateway retry quarantine rollouts?",
        unchecked: false,
      },
    ]);
    expect(answer["rowsSearched"]).toBe(5);
  });

  it("finds a run waiting on the owner's word whose doc was archived, by its own text, on their Queue", () => {
    const slug = "archived-ledger-ask";
    mkdirSync(join(home, "handovers", "archive"), { recursive: true });
    writeFileSync(
      join(home, "handovers", "archive", `${slug}.md`),
      doc({ blockedBy: [], slug, status: "ready", summary: "Ledger compaction schedule" }),
    );
    waitingJournal({ question: "Which night should it run?", slug });
    const { answer, status } = findCard({ words: ["ledger", "compaction"] });
    expect(status).toBe(0);
    expect(answer["cards"]).toEqual([
      {
        matched: ["ledger", "compaction"],
        ownerWait: "owner",
        section: "WAITING ON OWNER",
        slug,
        summary: "Ledger compaction schedule",
        unchecked: false,
      },
    ]);
  });
});

/** Park each draft into the throwaway home's register, held. */
function parkDrafts({ drafts }: { drafts: readonly ParkedSlackDraft[] }): void {
  for (const draft of drafts) {
    unwrap(appendSlackDraftEvent({ event: { draft, id: draft.id, kind: "parked", tsIso: draft.tsIso }, home }));
  }
}

/** A run journal for `slug` that started and then asked the owner `question`, nothing after. */
function waitingJournal({ question, slug }: { question: string; slug: string }): void {
  const runsDir = join(home, "runs");
  mkdirSync(runsDir, { recursive: true });
  unwrap(
    appendRunEvent({
      event: { atIso: "2026-10-19T10:00:00.000Z", branch: slug, docHash: "h", kind: "started" },
      runsDir,
      slug,
    }),
  );
  unwrap(appendRunEvent({ event: { atIso: "2026-10-19T10:05:00.000Z", kind: "question", question }, runsDir, slug }));
}
