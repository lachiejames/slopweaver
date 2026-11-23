/**
 * `incident postmortem` over a throwaway home holding a REAL dispatch row (registered by the real `handover register`
 * off `postmortemRegisterArgv`) and a REAL parked reply — so every admission rule `hand post` applies is the shipped
 * one, not a restatement.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendSlackDraftEvent } from "../../../../../admit/slackDraftStore.js";
import { registerAskRow } from "../../../../../cli/commands/handover/askRowRun.js";
import { type IncidentPostmortemDeps, runIncidentPostmortem } from "../../../../../cli/commands/incident/postmortem.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { handRegisterPath, readHandRows } from "../../../../../hand/store.js";
import { type PostmortemRowIncident, postmortemRegisterArgv } from "../../../../../incident/postmortemRow.js";
import { ok, unwrap } from "../../../../../lib/result.js";
import type { OrgIncident } from "../../../../../orgHealth/types.js";
import { type ParkedSlackDraft, parkedDraftDigest } from "../../../../../outbound/slack/draftRegister.js";
import {
  type MemoryOrgHealthStore,
  memoryOrgHealthPort,
  memoryOrgHealthStore,
  seedOrgHealthSnapshot,
} from "../../../../orgHealthStoreFixture.js";
import { gitInTemp } from "../../../../tempGitRepo.js";

const INCIDENT: PostmortemRowIncident = {
  channelId: "C0SYN000004",
  homepageUrl: "https://app.incident.io/acme/incidents/98",
  ref: "INC-98",
  title: "Payment checkout regression",
};
const ROW = "postmortem-c0syn000004";
const FACILITATOR = "U0SYNSMITH1234";
/** The briefing page the fixture publishes, in the viewer on the fake console origin. */
const BRIEFING_URL = "http://127.0.0.1:4321/view?src=%2Fapi%2Fpage%2Finc-98-briefing%2Findex.html&back=%2Fqueue";

/** A whole form naming the row and the reply this home holds. */
const FORM = {
  askDraft: "sd-1234abcd",
  channel: { id: INCIDENT.channelId, name: "inc-2026-09-23-payment-checkout-regression", reference: "INC-98" },
  cites: [INCIDENT.homepageUrl],
  lean: "Yes — the room will decide the Stripe pin, and you own that client.",
  meaning: "412 customers could not pay at checkout for five hours",
  meeting: { runBy: { name: "John Smith", slackId: FACILITATOR }, state: "not-yet-scheduled" },
  proof: "inc-98-briefing",
  quotes: [
    {
      permalink: "https://example.slack.com/archives/C0SYN000004/p1790130678000100",
      text: "We should run a proper postmortem on this one.",
      who: "John Smith",
    },
    {
      permalink: "https://example.slack.com/archives/C0SYN000004/p1790128559861079",
      text: "Agreed, the Stripe pin needs a real conversation.",
      who: "Jonah Yates",
    },
  ],
  row: ROW,
  stakeholders: ["John Smith (facilitator)", "Jonah Yates"],
  stillReal: "slopweaver incident postmortems listed INC-98 at the snapshot read 2026-09-24T01:00Z",
};

/** INC-98 as the org-health snapshot keeps it, resolved, naming the fixture's channel. */
const SNAPSHOT_INCIDENT: OrgIncident = {
  channelId: INCIDENT.channelId,
  declaredIso: "2026-09-23T01:00:00.000Z",
  homepageUrl: INCIDENT.homepageUrl,
  phase: "resolved",
  phaseChangedIso: "2026-09-23T06:00:00.000Z",
  phaseProvenance: "update",
  ref: INCIDENT.ref,
  severity: "Major",
  status: "Closed",
  title: INCIDENT.title,
};

/** The reply under `id`, its digest computed the way the recorder computes it, overridable per test. */
function parked({ id, over = {} }: { id: string; over?: Partial<ParkedSlackDraft> }): ParkedSlackDraft {
  const content = {
    authorId: "U0ME",
    channel: INCIDENT.channelId,
    mentions: [{ key: "john.smith", kind: "person" as const, target: FACILITATOR }],
    payload: {
      form: "plain" as const,
      text: "can I sit in on the postmortem?",
      unfurl_links: false,
      unfurl_media: false,
    },
  };
  return {
    ...content,
    advisory: [],
    digest: parkedDraftDigest({ draft: content }),
    form: '{"sections":[{"kind":"prose","text":"can I sit in on the postmortem?"}]}',
    id,
    row: ROW,
    shape: "top-level",
    tsIso: "2026-09-24T01:00:00.000Z",
    why: "the postmortem ask under test",
    ...over,
  };
}

/**
 * Seams that record every line and never reach macOS: the platform is not darwin, so no note is drawn. The snapshot
 * is read off `store`, the memory store the test seeded.
 */
function fakeDeps({ store }: { store: MemoryOrgHealthStore }): {
  deps: IncidentPostmortemDeps;
  out: string[];
  diag: string[];
} {
  const out: string[] = [];
  const diag: string[] = [];
  return {
    deps: {
      branchesDeclaring: () => [],
      consoleBase: () => "http://127.0.0.1:4321",
      lookAt: () => {
        throw new Error("incident postmortem looks at no page");
      },
      now: () => "2026-09-24T01:10:00.000Z",
      orgHealthPort: memoryOrgHealthPort({ store }),
      // The store holds the fixture's briefing page and nothing else.
      pagePublished: async ({ slug }) => ok(slug === FORM.proof),
      platform: "linux",
      rowPullRequests: () => ({ kind: "not-asked" }),
      run: () => {
        throw new Error("no macOS command runs in this test");
      },
      writeDiagnostic: (line) => diag.push(line),
      writeOut: (line) => out.push(line),
    },
    diag,
    out,
  };
}

describe("incident postmortem", () => {
  let home: string;
  let checkout: string;
  let formPath: string;
  let store: MemoryOrgHealthStore;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "incident-pm-home-"));
    store = memoryOrgHealthStore();
    checkout = realpathSync(mkdtempSync(join(tmpdir(), "incident-pm-checkout-")));
    gitInTemp({ args: ["init", "--quiet"], cwd: checkout });
    const code = await registerAskRow({
      argv: postmortemRegisterArgv({ checkout, home, incident: INCIDENT, nowIso: "2026-09-24T01:00:00.000Z" }),
      origin: "automation",
      out: () => undefined,
    });
    if (code !== EXIT_OK) {
      throw new Error(`the fixture row was not registered: handover register exited ${String(code)}`);
    }
    snapshot({ incidents: [SNAPSHOT_INCIDENT] });
    formPath = join(home, "card.json");
  });

  const snapshot = ({ incidents }: { incidents: readonly OrgIncident[] }): void => {
    seedOrgHealthSnapshot({
      home,
      snapshot: {
        announcementCount: incidents.length,
        channelId: "C0SYNINCIDENTS",
        incidents,
        readIso: "2026-09-24T01:00:00.000Z",
        schemaVersion: 1,
        state: "measured",
      },
      store,
    });
  };

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
    rmSync(checkout, { force: true, recursive: true });
  });

  const park = ({ over = {} }: { over?: Partial<ParkedSlackDraft> } = {}): void => {
    unwrap(
      appendSlackDraftEvent({
        event: {
          draft: parked({ id: FORM.askDraft, over }),
          id: FORM.askDraft,
          kind: "parked",
          tsIso: "2026-09-24T01:00:00.000Z",
        },
        home,
      }),
    );
  };

  const run = async ({
    form = FORM,
    extra = [],
  }: {
    form?: Record<string, unknown>;
    extra?: readonly string[];
  } = {}): Promise<ReturnType<typeof fakeDeps> & { code: number }> => {
    writeFileSync(formPath, JSON.stringify(form));
    const seams = fakeDeps({ store });
    const code = await runIncidentPostmortem({
      deps: seams.deps,
      rest: ["--form", formPath, "--home", home, ...extra],
    });
    return { ...seams, code };
  };

  const register = (): readonly string[] =>
    unwrap(readHandRows({ missing: "empty", path: handRegisterPath({ home }) })).rows.map((row) =>
      row.kind === "posted" ? `posted ${row.step.id}` : `settled ${row.id}`,
    );

  it("posts revision 1 opening the briefing, the channel's lines above the fold and the reply last", async () => {
    park();

    const { code, out, diag } = await run();

    expect(diag).toEqual([]);
    expect(code).toBe(EXIT_OK);
    expect(out[0]).toBe(
      "hand post: pm-c0syn000004-r1 recorded — 412 customers could not pay at checkout for five hours: should we send this to join the postmortem (INC-98)?",
    );
    const rows = unwrap(readHandRows({ missing: "empty", path: handRegisterPath({ home }) })).rows;
    const step = rows[0]!.kind === "posted" ? rows[0]!.step : undefined;
    expect(step!.url).toBe(BRIEFING_URL);
    expect(step!.quotes!.map((quote) => quote.who)).toEqual(["John Smith", "Jonah Yates"]);
    expect(step!.details).toEqual([
      `Briefing: ${BRIEFING_URL}`,
      "Meeting: not scheduled yet; John Smith runs it",
      "In the room: John Smith (facilitator), Jonah Yates",
      "Reply for #inc-2026-09-23-payment-checkout-regression: sd-1234abcd",
    ]);
    expect(step!.witness).toBe("slopweaver slack draft show sd-1234abcd");
    expect(step!.row).toBe(ROW);
  });

  it("amends the card: a second run supersedes the open revision", async () => {
    park();
    await run();

    const { code, out } = await run({
      form: { ...FORM, meeting: { atIso: "2026-09-25T04:00Z", runBy: FORM.meeting.runBy, state: "scheduled" } },
    });

    expect(code).toBe(EXIT_OK);
    expect(out[2]).toBe("  supersedes pm-c0syn000004-r1, settled on the same register line");
  });

  it("dry-run admits against this home and leaves its register untouched", async () => {
    park();

    const { code, out } = await run({ extra: ["--dry-run"] });

    expect(code).toBe(EXIT_OK);
    expect(out[0]).toContain(`incident postmortem --dry-run: admitted against ${home}; drawn from `);
    expect(register()).toEqual([]);
  });

  it("refuses a reply this home never parked, posting nothing", async () => {
    const { code, diag } = await run({ extra: ["--dry-run"] });

    expect(code).toBe(EXIT_ERROR);
    expect(diag).toEqual([
      "incident postmortem: the ask sd-1234abcd is not in the draft register — park it with `slopweaver slack draft record` first",
    ]);
    expect(register()).toEqual([]);
  });

  it("refuses a reply parked as the bot, posting nothing", async () => {
    park({ over: { actor: "bot" } });

    const { code, diag } = await run({ extra: ["--dry-run"] });

    expect(code).toBe(EXIT_ERROR);
    expect(diag).toEqual([
      "incident postmortem: the ask sd-1234abcd is parked as the bot — asking to join a meeting goes out in the owner's name",
    ]);
  });

  it("refuses a reply that does not tag whoever runs the postmortem", async () => {
    park({ over: { mentions: [] } });

    const { code, diag } = await run({ extra: ["--dry-run"] });

    expect(code).toBe(EXIT_ERROR);
    expect(diag).toEqual([
      `incident postmortem: the ask sd-1234abcd does not tag John Smith (${FACILITATOR}), who runs the postmortem`,
    ]);
  });

  it("refuses a briefing slug with no published page, naming the publish verb", async () => {
    park();

    const { code, diag } = await run({ form: { ...FORM, proof: "never-published" } });

    expect(code).toBe(EXIT_ERROR);
    expect(diag).toEqual([
      `incident postmortem: proof "never-published" is no published page (the store holds none by that name) — publish the briefing with \`slopweaver page publish never-published --page <file> --review <id>\` (the review from \`slopweaver page review-prepare\`) first, so the card opens it`,
    ]);
    expect(register()).toEqual([]);
  });

  it("refuses a card whose channel and row belong to another incident than the one it references, posting nothing", async () => {
    park();
    snapshot({
      incidents: [SNAPSHOT_INCIDENT, { ...SNAPSHOT_INCIDENT, channelId: "C0SYNBBBBBBBB", ref: "INC-97" }],
    });

    const { code, diag } = await run({
      form: {
        ...FORM,
        channel: { ...FORM.channel, reference: "INC-97" },
        cites: ["https://app.incident.io/acme/incidents/97"],
      },
    });

    expect(code).toBe(EXIT_ERROR);
    expect(diag).toEqual([
      "incident postmortem: channel C0SYN000004 cannot be bound to INC-97 — INC-97's own channel is C0SYNBBBBBBBB",
    ]);
    expect(register()).toEqual([]);
  });

  it("refuses a form file that is not JSON", async () => {
    writeFileSync(formPath, "{");
    const seams = fakeDeps({ store });

    const code = await runIncidentPostmortem({ deps: seams.deps, rest: ["--form", formPath, "--home", home] });

    expect(code).toBe(EXIT_ERROR);
    expect(seams.diag[0]).toContain(`incident postmortem: --form ${formPath}:`);
  });
});
