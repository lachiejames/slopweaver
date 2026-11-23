/**
 * `incident note` over a throwaway home holding a REAL dispatch row (registered by the real `handover register`) and
 * two REAL parked drafts — so every admission rule `hand post` applies is the shipped one, not a restatement.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendSlackDraftEvent } from "../../../../../admit/slackDraftStore.js";
import { handAdmissionExit } from "../../../../../cli/commands/hand/applyPost.js";
import { registerAskRow } from "../../../../../cli/commands/handover/askRowRun.js";
import { type IncidentNoteDeps, runIncidentNote } from "../../../../../cli/commands/incident/note.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { buildHandStep } from "../../../../../hand/step.js";
import { handRegisterPath, readHandRows } from "../../../../../hand/store.js";
import type { IncidentChannel } from "../../../../../incident/channel.js";
import { checkedIncidentForm } from "../../../../../incident/form.js";
import { incidentStepDraft, nextIncidentRevision } from "../../../../../incident/note.js";
import { incidentRegisterArgv, incidentRowSlug } from "../../../../../incident/row.js";
import { ok, unwrap } from "../../../../../lib/result.js";
import { type ParkedSlackDraft, parkedDraftDigest } from "../../../../../outbound/slack/draftRegister.js";
import { ACME_ORGANISATION } from "../../../../organisationFixture.js";
import { gitInTemp } from "../../../../tempGitRepo.js";

const CHANNEL: IncidentChannel = {
  createdEpochSeconds: 1790126244,
  id: "C0SYN000004",
  name: "inc-2001-01-01-fixture-upload-outage",
  topic: "INC-1",
};
const SLUG = incidentRowSlug({ channel: CHANNEL });
const DD = "https://app.datadoghq.com/rum/explorer?query=%40view.name%3Aupload";
/** The receipts page the fixture publishes, in the viewer on the fake console origin. */
const PROOF_URL = "http://127.0.0.1:4321/view?src=%2Fapi%2Fpage%2Finc-1-receipts%2Findex.html&back=%2Fqueue";

/** A whole form naming the row and two drafts this home holds, over a made-up upload outage. */
const FORM = {
  bugsThread: { draft: "sd-0badc0de", thread: "https://example.slack.com/archives/C0SYN000023/p1790120084887009" },
  channel: { id: CHANNEL.id, name: CHANNEL.name, reference: "INC-1" },
  channelDraft: "sd-1234abcd",
  cites: [DD],
  adds: "Logs count 37 failed uploads; the channel has only anecdotes.",
  impact: "Every file upload failed for about five hours.",
  lean: "Yes — the merged fix and the flat error rate both say it is over.",
  meaning: "37 users could not upload a file this morning",
  proof: "inc-1-receipts",
  quotes: [
    {
      permalink: "https://example.slack.com/archives/C0SYN000004/p1790130678000100",
      text: "We're pinned to an old client and never send this field.",
      who: "Jonah Yates",
    },
    {
      permalink: "https://example.slack.com/archives/C0SYN000004/p1790128559861079",
      text: "Image uploads also look down",
      who: "Kieran Mendez",
    },
  ],
  rootCause: "An outdated storage client met the storage API's new required checksum field.",
  row: SLUG,
  shot: { boxes: ["40,120,320,36=the upload error spike"], path: "<written per test under the home>" },
  stakeholders: ["John Smith (lead)", "Jonah Yates"],
  status: { telemetryClearSinceIso: "2026-09-23T05:10:00Z" },
  stillReal: "slopweaver datadog rum count --query @view.name:upload --since 2h read 0 errors",
};

/** The first 24 bytes of a PNG declaring this size — all `readHandShot` checks, then a little body. */
function pngBytes({ width, height }: { width: number; height: number }): Buffer {
  const bytes = Buffer.alloc(40);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]).copy(
    bytes,
  );
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

/** One parked draft under `id`, its digest computed the way the recorder computes it. */
function parked({ id }: { id: string }): ParkedSlackDraft {
  const content = {
    authorId: "U0ME",
    channel: CHANNEL.id,
    mentions: [],
    payload: { form: "plain" as const, text: "root cause", unfurl_links: false, unfurl_media: false },
  };
  return {
    ...content,
    advisory: [],
    digest: parkedDraftDigest({ draft: content }),
    form: '{"sections":[{"kind":"prose","text":"root cause"}]}',
    id,
    shape: "top-level",
    tsIso: "2026-09-23T06:00:00.000Z",
    why: "the incident cross-post under test",
  };
}

/** Seams that record every line and never reach macOS: the platform is not darwin, so no note is drawn. */
function fakeDeps(): { deps: IncidentNoteDeps; out: string[]; diag: string[] } {
  const out: string[] = [];
  const diag: string[] = [];
  return {
    deps: {
      branchesDeclaring: () => [],
      consoleBase: () => "http://127.0.0.1:4321",
      lookAt: () => {
        throw new Error("incident note looks at no page");
      },
      now: () => "2026-09-23T06:10:00.000Z",
      // The store holds the fixture's receipts page and nothing else.
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

describe("incident note", () => {
  let home: string;
  let checkout: string;
  let formPath: string;
  let shotPath: string;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "incident-note-home-"));
    checkout = realpathSync(mkdtempSync(join(tmpdir(), "incident-note-checkout-")));
    gitInTemp({ args: ["init", "--quiet"], cwd: checkout });
    const code = await registerAskRow({
      argv: incidentRegisterArgv({
        channel: CHANNEL,
        checkout,
        home,
        nowIso: "2026-09-23T01:20:00.000Z",
        organisation: ACME_ORGANISATION,
        permalink: `https://example.slack.com/archives/${CHANNEL.id}`,
      }),
      origin: "automation",
      out: () => undefined,
    });
    if (code !== EXIT_OK) {
      throw new Error(`the fixture row was not registered: handover register exited ${String(code)}`);
    }
    for (const id of ["sd-1234abcd", "sd-0badc0de"]) {
      unwrap(
        appendSlackDraftEvent({
          event: { draft: parked({ id }), id, kind: "parked", tsIso: "2026-09-23T06:00:00.000Z" },
          home,
        }),
      );
    }
    formPath = join(home, "note.json");
    shotPath = join(home, "upload-errors.png");
    writeFileSync(shotPath, pngBytes({ height: 900, width: 1440 }));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
    rmSync(checkout, { force: true, recursive: true });
  });

  const run = async ({
    form,
    extra = [],
  }: {
    form: Record<string, unknown>;
    extra?: readonly string[];
  }): Promise<
    ReturnType<typeof fakeDeps> & {
      code: number;
    }
  > => {
    writeFileSync(formPath, JSON.stringify({ ...form, shot: { ...FORM.shot, path: shotPath } }));
    const seams = fakeDeps();
    const code = await runIncidentNote({ deps: seams.deps, rest: ["--form", formPath, "--home", home, ...extra] });
    return { ...seams, code };
  };

  const register = (): readonly string[] =>
    unwrap(readHandRows({ missing: "empty", path: handRegisterPath({ home }) })).rows.map((row) =>
      row.kind === "posted" ? `posted ${row.step.id}` : `settled ${row.id}`,
    );

  it("posts revision 1 carrying the quotes above the fold and the write-up behind it", async () => {
    const { code, out, diag } = await run({ form: FORM });

    expect(diag).toEqual([]);
    expect(code).toBe(EXIT_OK);
    expect(out[0]).toBe(
      "hand post: inc-c0syn000004-r1 recorded — 37 users could not upload a file this morning: should we share it with the team (INC-1)?",
    );
    const rows = unwrap(readHandRows({ missing: "empty", path: handRegisterPath({ home }) })).rows;
    const step = rows[0]!.kind === "posted" ? rows[0]!.step : undefined;
    expect(step!.quotes!.map((quote) => quote.who)).toEqual(["Jonah Yates", "Kieran Mendez"]);
    expect(step!.url).toBe(PROOF_URL);
    expect(step!.details![0]).toBe(`Proof: ${PROOF_URL}`);
    expect(step!.details!.slice(1, 4)).toEqual([
      `Impact: ${FORM.impact}`,
      `What the channel does not have yet: ${FORM.adds}`,
      "Status: telemetry clear since 2026-09-23T05:10:00Z, customer confirmation pending",
    ]);
    expect(step!.row).toBe(SLUG);
  });

  it("amends the note: a second run supersedes the open revision", async () => {
    await run({ form: FORM });

    const { code, out } = await run({
      form: { ...FORM, status: { ...FORM.status, customerConfirmedBy: "Chris Jarvis" } },
    });

    expect(code).toBe(EXIT_OK);
    expect(out[2]).toBe("  supersedes inc-c0syn000004-r1, settled on the same register line");
    const rows = unwrap(readHandRows({ missing: "empty", path: handRegisterPath({ home }) })).rows;
    expect(unwrap(nextIncidentRevision({ channelId: CHANNEL.id, rows }))).toEqual({
      id: "inc-c0syn000004-r3",
      supersedes: "inc-c0syn000004-r2",
    });
  });

  it("dry-run admits against this home and leaves its register untouched", async () => {
    const { code, out } = await run({ extra: ["--dry-run"], form: FORM });

    expect(code).toBe(EXIT_OK);
    expect(out[0]).toContain(`incident note --dry-run: admitted against ${home}; drawn from `);
    expect(register()).toEqual([]);
  });

  it("dry-run still refuses a draft this home never parked", async () => {
    const { code, diag } = await run({ extra: ["--dry-run"], form: { ...FORM, channelDraft: "sd-99999999" } });

    expect(code).toBe(EXIT_USAGE);
    expect(diag.join("\n")).toContain("sd-99999999 is not in the drafts register");
    expect(register()).toEqual([]);
  });

  it("refuses a proof slug with no published page, naming the publish verb, posting nothing", async () => {
    const { code, diag } = await run({ form: { ...FORM, proof: "never-published" } });

    expect(code).toBe(EXIT_ERROR);
    expect(diag).toEqual([
      `incident note: proof "never-published" is no published page (the store holds none by that name) — publish the receipts with \`slopweaver page publish never-published --page <file> --review <id>\` (the review from \`slopweaver page review-prepare\`) first, so the note opens them`,
    ]);
    expect(register()).toEqual([]);
  });

  it("refuses a form carrying one quote, posting nothing", async () => {
    const { code, diag } = await run({ form: { ...FORM, quotes: [FORM.quotes[0]] } });

    expect(code).toBe(EXIT_ERROR);
    expect(diag[0]).toContain("incident note form: quotes");
    expect(register()).toEqual([]);
  });

  it("admission checks the bugs-thread draft, which only the details name", () => {
    const admit = ({ bugsDraft }: { bugsDraft: string }): { exit: number | undefined; diag: string[] } => {
      const form = unwrap(
        checkedIncidentForm({ value: { ...FORM, bugsThread: { ...FORM.bugsThread, draft: bugsDraft } } }),
      );
      const step = unwrap(
        buildHandStep({
          draft: incidentStepDraft({
            consoleBase: "http://127.0.0.1:4321",
            form,
            nowIso: "2026-09-23T06:10:00.000Z",
            postedBy: "supervisor",
            revision: { id: "inc-c0syn000004-r1" },
            shot: undefined,
          }),
        }),
      );
      const seams = fakeDeps();
      return { diag: seams.diag, exit: handAdmissionExit({ deps: seams.deps, home, step }) };
    };

    expect(admit({ bugsDraft: "sd-0badc0de" })).toEqual({ diag: [], exit: undefined });
    const refused = admit({ bugsDraft: "sd-77777777" });
    expect(refused.exit).toBe(EXIT_USAGE);
    expect(refused.diag.join("\n")).toContain("sd-77777777 is not in the drafts register");
  });

  it("refuses a form file that is not JSON", async () => {
    writeFileSync(formPath, "{");
    const seams = fakeDeps();

    const code = await runIncidentNote({ deps: seams.deps, rest: ["--form", formPath, "--home", home] });

    expect(code).toBe(EXIT_ERROR);
    expect(seams.diag[0]).toContain(`incident note: --form ${formPath}:`);
  });
});
