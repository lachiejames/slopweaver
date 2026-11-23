import { describe, expect, it } from "vitest";

import { misplacedDecision } from "../../../hand/decision.js";
import { postingRefusal } from "../../../hand/posting.js";
import type { HandRow } from "../../../hand/row.js";
import { buildHandStep, type HandStep, WHAT_CAP } from "../../../hand/step.js";
import { MEANING_CAP } from "../../../incident/findingFields.js";
import { checkedIncidentForm, REFERENCE_CAP } from "../../../incident/form.js";
import {
  incidentDetails,
  incidentStatusLine,
  incidentStepDraft,
  nextIncidentRevision,
  shareQuestion,
} from "../../../incident/note.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const LINK = "https://example.slack.com/archives/C0SYN000004/p1790130678000100";
const DD = "https://app.datadoghq.com/rum/explorer?query=%40view.name%3Aupload";
const CONSOLE = "http://localhost:3000";
const PROOF_URL = "http://localhost:3000/view?src=%2Fapi%2Fpage%2Finc-1-receipts%2Findex.html&back=%2Fqueue";

/** A whole form, the shape the dry run's write-up takes, over a made-up upload outage. */
const FORM = {
  adds: "Logs show 37 failed uploads since 08:00; the channel has only anecdotes.",
  bugsThread: { draft: "sd-0badc0de", thread: "https://example.slack.com/archives/C0SYN000023/p1790120084887009" },
  channel: { id: "C0SYN000004", name: "inc-2001-01-01-fixture-upload-outage", reference: "INC-1" },
  channelDraft: "sd-1234abcd",
  cites: [DD, "https://github.com/example/acme-admin/pull/101"],
  impact: "Every file upload failed from about 08:00; roughly 30 errors an hour at 14:30.",
  lean: "Yes — the cause is confirmed by the merged fix and the error rate is back to its baseline.",
  meaning: "37 users could not upload a file this morning",
  proof: "inc-1-receipts",
  quotes: [
    { permalink: LINK, text: "We're pinned to an old client and never send this field.", who: "Jonah Yates" },
    {
      permalink: "https://example.slack.com/archives/C0SYN000004/p1790128559861079",
      text: "Image uploads also look down",
      who: "Kieran Mendez",
    },
  ],
  rootCause: "An outdated storage client met the storage API's new required checksum field.",
  row: "incident-c0syn000004",
  shot: { boxes: ["40,120,320,36=the upload error spike"], path: "/tmp/upload-errors.png" },
  stakeholders: ["John Smith (lead)", "Jonah Yates", "Chris Jarvis", "Rosa Lindqvist"],
  status: { telemetryClearSinceIso: "2026-09-23T05:10Z" },
  stillReal: "slopweaver datadog rum count --query @view.name:upload --since 2h read 0 errors at 06:10Z",
} as const;

const posted = ({ id, settles }: { id: string; settles?: string }): HandRow => ({
  kind: "posted",
  ...(settles === undefined
    ? {}
    : { settles: { bySession: "s", did: "re-cut", id: settles, kind: "settled", settledIso: "2026-09-23T06:00:00Z" } }),
  step: { id } as HandStep,
});

describe("checkedIncidentForm", () => {
  it("accepts a whole write-up", () => {
    const form = unwrap(checkedIncidentForm({ value: FORM }));
    expect(form.channel).toEqual(FORM.channel);
    expect(form.quotes.length).toBe(2);
  });

  it("refuses a form with no proof page before any other field, naming the publish verb", () => {
    const { proof: _dropped, ...bare } = FORM;
    expect(unwrapErr(checkedIncidentForm({ value: { ...bare, quotes: [] } })).message).toBe(
      "incident note form: proof is the slug of the receipts page published with `slopweaver page publish <slug> --page <file> --review <id>` — the note opens it first",
    );
  });

  it("reads the proof as an own key, so an inherited one is still missing", () => {
    const { proof, ...bare } = FORM;
    const value: unknown = Object.assign(Object.create({ proof }), { ...bare, quotes: [] });
    expect(unwrapErr(checkedIncidentForm({ value })).field).toBe("proof");
  });

  it("names a mistyped proof key as unknown before saying the proof is missing", () => {
    const { proof, ...bare } = FORM;
    expect(unwrapErr(checkedIncidentForm({ value: { ...bare, proff: proof } })).message).toBe(
      'incident note form: form carries an unknown key "proff"',
    );
  });

  it("refuses a proof that is not a page slug", () => {
    expect(unwrapErr(checkedIncidentForm({ value: { ...FORM, proof: "../etc" } })).field).toBe("proof");
  });

  it("refuses an unknown key", () => {
    const refused = checkedIncidentForm({ value: { ...FORM, severity: "critical" } });
    expect(unwrapErr(refused).message).toBe('incident note form: form carries an unknown key "severity"');
  });

  it("refuses one quote — the note carries the room, not an anecdote", () => {
    const refused = checkedIncidentForm({ value: { ...FORM, quotes: [FORM.quotes[0]] } });
    expect(unwrapErr(refused).message).toBe(
      "incident note form: quotes carries 1 and the note needs 2 to 3 verbatim lines from the channel",
    );
  });

  it("refuses no quotes at all", () => {
    const { quotes: _dropped, ...bare } = FORM;
    expect(unwrapErr(checkedIncidentForm({ value: bare })).field).toBe("quotes");
  });

  it("refuses four quotes with the quotes rule's own words", () => {
    const four = [...FORM.quotes, ...FORM.quotes];
    expect(unwrapErr(checkedIncidentForm({ value: { ...FORM, quotes: four } })).message).toBe(
      "incident note form: quotes carries 4 quotes and the cap is 3 — keep the lines that carry the incident",
    );
  });

  it("refuses evidence with no Datadog link", () => {
    const refused = checkedIncidentForm({
      value: { ...FORM, cites: ["https://github.com/example/acme-admin/pull/1"] },
    });
    expect(unwrapErr(refused).message).toBe(
      "incident note form: cites carries no Datadog link — the root cause and impact rest on telemetry, so cite where it was read",
    );
  });

  it("refuses evidence that opens on a pull request rather than the Datadog link", () => {
    const refused = checkedIncidentForm({
      value: { ...FORM, cites: ["https://github.com/example/acme-admin/pull/1", DD] },
    });
    expect(unwrapErr(refused).message).toContain(
      'incident note form: cites opens on "https://github.com/example/acme-admin/pull/1" — the evidence leads',
    );
  });

  it("refuses a lean that leads with a pull request", () => {
    const refused = checkedIncidentForm({ value: { ...FORM, lean: "Approve the fix PR first, then share" } });
    expect(unwrapErr(refused).message).toContain(
      'incident note form: lean leads with a pull request ("Approve the fix") instead of the discussion',
    );
  });

  it("refuses a form naming nothing the channel does not already have", () => {
    const { adds: _dropped, ...bare } = FORM;
    expect(unwrapErr(checkedIncidentForm({ value: bare })).message).toContain(
      "incident note form: adds is required: the one thing the fleet found that the channel does not already have",
    );
  });

  it("accepts an impact past an access wall as the wall, the question and who could answer it", () => {
    const impact = {
      askWho: "Kieran Mendez (support)",
      question: "How many users saw a failed upload today?",
      wall: "the storage console refused the fleet's login",
    };
    const form = unwrap(checkedIncidentForm({ value: { ...FORM, impact } }));
    expect(incidentDetails({ form, proofUrl: PROOF_URL })[1]).toBe(
      "Impact: not measured (the storage console refused the fleet's login) — a question for Kieran Mendez (support): " +
        "How many users saw a failed upload today?",
    );
  });

  it("refuses an impact question that names no one to ask", () => {
    const refused = checkedIncidentForm({ value: { ...FORM, impact: { question: "How many?", wall: "Hex 403" } } });
    expect(unwrapErr(refused).field).toBe("impact");
  });

  // A question with no wall asserted an access gap the card never showed.
  it("refuses an impact question that names no wall", () => {
    const refused = checkedIncidentForm({ value: { ...FORM, impact: { askWho: "Alice", question: "How many?" } } });
    expect(unwrapErr(refused).field).toBe("impact");
  });

  it("accepts the EU Datadog site", () => {
    const cites = ["https://app.datadoghq.eu/logs?query=x"];
    expect(checkedIncidentForm({ value: { ...FORM, cites } }).isOk()).toBe(true);
  });

  it("refuses a lookalike Datadog host", () => {
    const cites = ["https://datadoghq.com.example.org/logs"];
    expect(unwrapErr(checkedIncidentForm({ value: { ...FORM, cites } })).field).toBe("cites");
  });

  it("refuses a plain-http evidence link", () => {
    const refused = checkedIncidentForm({ value: { ...FORM, cites: [DD, "http://example.com/x"] } });
    expect(unwrapErr(refused).message).toBe(
      'incident note form: cites carries "http://example.com/x", which is not an https link',
    );
  });

  it("refuses a form that leaves the bugs thread out rather than saying there is none", () => {
    const { bugsThread: _dropped, ...bare } = FORM;
    expect(unwrapErr(checkedIncidentForm({ value: bare })).field).toBe("bugsThread");
  });

  it("accepts a stated absence of a bugs thread", () => {
    const form = unwrap(checkedIncidentForm({ value: { ...FORM, bugsThread: { none: "no bugs thread names it" } } }));
    expect(form.bugsThread).toEqual({ none: "no bugs thread names it" });
  });

  it("refuses a draft id that is not a parked draft's", () => {
    const refused = checkedIncidentForm({ value: { ...FORM, channelDraft: "draft-1" } });
    expect(unwrapErr(refused).field).toBe("channelDraft");
  });

  it("refuses a malformed telemetry instant", () => {
    const refused = checkedIncidentForm({ value: { ...FORM, status: { telemetryClearSinceIso: "05:10" } } });
    expect(unwrapErr(refused).field).toBe("status.telemetryClearSinceIso");
  });

  it("refuses a root cause over its cap, naming the cap", () => {
    const refused = checkedIncidentForm({ value: { ...FORM, rootCause: "x".repeat(301) } });
    expect(unwrapErr(refused).message).toBe(
      `incident note form: rootCause is 301 characters and the cap is 300: "${"x".repeat(40)}…"`,
    );
  });

  it("refuses nine stakeholders", () => {
    const refused = checkedIncidentForm({ value: { ...FORM, stakeholders: Array.from({ length: 9 }, () => "A") } });
    expect(unwrapErr(refused).field).toBe("stakeholders");
  });

  it("refuses a shot with no boxes", () => {
    const refused = checkedIncidentForm({ value: { ...FORM, shot: { boxes: [], path: "/tmp/x.png" } } });
    expect(unwrapErr(refused).field).toBe("shot");
  });

  it("refuses a form with no screenshot proving the finding", () => {
    const refused = checkedIncidentForm({ value: { ...FORM, shot: undefined } });
    expect(unwrapErr(refused).message).toContain(
      "incident note form: shot is missing: a finding reaches the owner only with a screenshot proving it is real",
    );
  });

  it("refuses a form with no meaning — the card opens on the impact in people", () => {
    const refused = checkedIncidentForm({ value: { ...FORM, meaning: undefined } });
    expect(unwrapErr(refused).message).toContain(
      "incident note form: meaning is required: the impact in people, the card's first words",
    );
  });

  it("refuses a meaning past its cap", () => {
    const refused = checkedIncidentForm({ value: { ...FORM, meaning: "p".repeat(MEANING_CAP + 1) } });
    expect(unwrapErr(refused).field).toBe("meaning");
  });
});

describe("incidentStatusLine", () => {
  it("never reads solved on telemetry alone", () => {
    expect(incidentStatusLine({ status: { telemetryClearSinceIso: "2026-09-23T05:10Z" } })).toBe(
      "telemetry clear since 2026-09-23T05:10Z, customer confirmation pending",
    );
  });

  it("never reads solved on a customer's word alone", () => {
    expect(incidentStatusLine({ status: { customerConfirmedBy: "Kieran Mendez" } })).toBe(
      "Kieran Mendez says solved, telemetry not yet clear",
    );
  });

  it("reads solved only with both halves", () => {
    const status = { customerConfirmedBy: "Kieran Mendez", telemetryClearSinceIso: "2026-09-23T05:10Z" };
    expect(incidentStatusLine({ status })).toBe(
      "solved — telemetry clear since 2026-09-23T05:10Z; confirmed by Kieran Mendez",
    );
  });

  it("names both halves missing", () => {
    expect(incidentStatusLine({ status: {} })).toBe("telemetry not yet clear, customer confirmation pending");
  });
});

describe("nextIncidentRevision", () => {
  it("starts at r1 on an empty register", () => {
    expect(unwrap(nextIncidentRevision({ channelId: "C0SYN000004", rows: [] }))).toEqual({
      id: "inc-c0syn000004-r1",
    });
  });

  it("supersedes the one open revision", () => {
    const rows = [posted({ id: "inc-c0syn000004-r1" })];
    expect(unwrap(nextIncidentRevision({ channelId: "C0SYN000004", rows }))).toEqual({
      id: "inc-c0syn000004-r2",
      supersedes: "inc-c0syn000004-r1",
    });
  });

  it("counts a re-cut's settlement written on its own posting line", () => {
    const rows = [
      posted({ id: "inc-c0syn000004-r1" }),
      posted({ id: "inc-c0syn000004-r2", settles: "inc-c0syn000004-r1" }),
    ];
    expect(unwrap(nextIncidentRevision({ channelId: "C0SYN000004", rows }))).toEqual({
      id: "inc-c0syn000004-r3",
      supersedes: "inc-c0syn000004-r2",
    });
  });

  it("never reuses a settled revision's number", () => {
    const rows: readonly HandRow[] = [
      posted({ id: "inc-c0syn000004-r4" }),
      {
        bySession: "s",
        did: "the owner said no",
        id: "inc-c0syn000004-r4",
        kind: "settled",
        settledIso: "2026-09-23T07:00:00Z",
      },
    ];
    expect(unwrap(nextIncidentRevision({ channelId: "C0SYN000004", rows }))).toEqual({ id: "inc-c0syn000004-r5" });
  });

  it("ignores another channel's revisions and a look-alike id", () => {
    const rows = [posted({ id: "inc-c0other-r7" }), posted({ id: "inc-c0syn000004-r2x" })];
    expect(unwrap(nextIncidentRevision({ channelId: "C0SYN000004", rows }))).toEqual({ id: "inc-c0syn000004-r1" });
  });

  it("refuses two open revisions, naming both", () => {
    const rows = [posted({ id: "inc-c0syn000004-r1" }), posted({ id: "inc-c0syn000004-r2" })];
    const refused = nextIncidentRevision({ channelId: "C0SYN000004", rows });
    expect(unwrapErr(refused).code).toBe("REVISIONS_OPEN");
    expect(unwrapErr(refused).message).toContain("(inc-c0syn000004-r1, inc-c0syn000004-r2)");
  });
});

describe("incidentStepDraft", () => {
  const form = unwrap(checkedIncidentForm({ value: FORM }));
  const draft = incidentStepDraft({
    consoleBase: CONSOLE,
    form,
    nowIso: "2026-09-23T06:15:00.000Z",
    postedBy: "dry-run",
    revision: { id: "inc-c0syn000004-r1" },
    shot: undefined,
  });

  it("opens on the impact in people, then asks one yes-or-no question naming the reference", () => {
    expect(draft.what).toBe("37 users could not upload a file this morning: should we share it with the team (INC-1)?");
  });

  it("builds a step from a meaning and a reference both at their caps, exactly the headline cap long", () => {
    const longest = unwrap(
      checkedIncidentForm({
        value: {
          ...FORM,
          channel: { ...FORM.channel, reference: "R".repeat(REFERENCE_CAP) },
          meaning: "p".repeat(MEANING_CAP),
        },
      }),
    );
    const step = unwrap(
      buildHandStep({
        draft: incidentStepDraft({
          consoleBase: CONSOLE,
          form: longest,
          nowIso: "2026-09-23T06:15:00.000Z",
          postedBy: "dry-run",
          revision: { id: "inc-c0syn000004-r1" },
          shot: undefined,
        }),
      }),
    );
    expect(step.what.length).toBe(WHAT_CAP);
    expect(step.what).toBe(shareQuestion({ channel: longest.channel, meaning: longest.meaning }));
  });

  it("puts the proof, impact, what the channel lacks, status, root cause, stakeholders and both drafts behind the disclosure row", () => {
    expect(incidentDetails({ form, proofUrl: PROOF_URL })).toEqual([
      `Proof: ${PROOF_URL}`,
      `Impact: ${FORM.impact}`,
      `What the channel does not have yet: ${FORM.adds}`,
      "Status: telemetry clear since 2026-09-23T05:10Z, customer confirmation pending",
      `Root cause: ${FORM.rootCause}`,
      "Stakeholders: John Smith (lead), Jonah Yates, Chris Jarvis, Rosa Lindqvist",
      "Draft for #inc-2001-01-01-fixture-upload-outage: sd-1234abcd",
      "Draft for the bugs thread https://example.slack.com/archives/C0SYN000023/p1790120084887009: sd-0badc0de",
    ]);
  });

  it("builds a step every posting rule admits, carrying the quotes and the decision", () => {
    const step = unwrap(buildHandStep({ draft }));
    expect(postingRefusal({ step })).toBeUndefined();
    expect(step.quotes).toEqual(FORM.quotes);
    expect(step.decision!.options.map((option) => option.letter)).toEqual(["A", "B"]);
    expect(step.row).toBe(FORM.row);
    expect(step.witness).toBe("slopweaver slack draft show sd-1234abcd");
  });

  it("lets the decision sit beside the proof only on an incident row", () => {
    const elsewhere = unwrap(buildHandStep({ draft: { ...draft, row: "proxy-down-follow-up" } }));
    expect(misplacedDecision({ step: elsewhere })!.message).toBe(
      "decision is carried beside a link to another record — link the record that holds the choice, or carry it here, never both",
    );
    expect(misplacedDecision({ step: unwrap(buildHandStep({ draft })) })).toBeUndefined();
  });

  it("refuses the decision beside a pull request even on an incident row", () => {
    const pr = unwrap(buildHandStep({ draft: { ...draft, url: "https://github.com/example/acme-admin/pull/101" } }));
    expect(misplacedDecision({ step: pr })).toMatchObject({ code: "INVALID_FIELD", field: "decision" });
    expect(postingRefusal({ step: pr })!.message).toContain("opens a pull request on a step for an incident's row");
  });

  it("opens the receipts page first, never the Queue", () => {
    const step = unwrap(buildHandStep({ draft }));
    expect(step.url).toBe(PROOF_URL);
    expect(step.unaddressed).toBeUndefined();
    expect(step.details![0]).toBe(`Proof: ${PROOF_URL}`);
  });

  it("builds a step for a channel with no reference and no bugs thread", () => {
    const bare = unwrap(
      checkedIncidentForm({
        value: { ...FORM, bugsThread: { none: "no bugs thread names it" }, channel: { id: "C1234567", name: "inc-x" } },
      }),
    );
    const step = unwrap(
      buildHandStep({
        draft: incidentStepDraft({
          consoleBase: CONSOLE,
          form: bare,
          nowIso: "2026-09-23T06:15:00.000Z",
          postedBy: "dry-run",
          revision: { id: "inc-c1234567-r1" },
          shot: undefined,
        }),
      }),
    );
    expect(step.what).toBe("37 users could not upload a file this morning: should we share it with the team?");
    expect(step.unblocks).toBe("this incident's write-up reaching #inc-x");
    expect(postingRefusal({ step })).toBeUndefined();
  });
});
