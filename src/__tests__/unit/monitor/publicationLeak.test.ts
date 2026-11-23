/**
 * `publication-leak` judges the last `audit publications` report: one card per finding, naming the class, the door and
 * the link, and a partial run never settles a card it no longer sees. Synthetic report only.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildHandStep, fleetActorPhrase, UNBLOCKS_CAP, WHAT_CAP } from "../../../hand/step.js";
import { err, ok, unwrap } from "../../../lib/result.js";
import { type PublicationAuditReport, PublicationAuditStoreErrors } from "../../../live/publicationAudit/store.js";
import type { PublicationDoorCoverage } from "../../../live/publicationAudit/types.js";
import { composeHandStep } from "../../../monitor/card.js";
import { evaluatePublicationLeak, PUBLICATION_LEAK, readPublicationLeak } from "../../../monitor/publicationLeak.js";
import { firing, unmeasurable } from "./readings.js";

const NOW = "2026-11-20T02:00:00.000Z";
const LINK = "https://github.com/acme/widgets/pull/46#issuecomment-1001";

/** One door's coverage, complete unless told otherwise. */
function door(over: Partial<PublicationDoorCoverage> = {}): PublicationDoorCoverage {
  return { attachmentsNotSwept: 0, door: "github", gaps: [], objects: 4, state: "complete", texts: 6, ...over };
}

/** A synthetic report, clean unless told otherwise. */
function report(over: Partial<PublicationAuditReport> = {}): PublicationAuditReport {
  return {
    counts: {},
    coverage: [door(), door({ door: "slack", objects: 0, state: "not-swept", texts: 0 })],
    findings: [],
    readAtIso: NOW,
    run: "evidence/publication-audit/2026-11-20T02-00-00Z-abcd1234",
    schemaVersion: 1,
    withheldLinks: 0,
    ...over,
  };
}

const FINDING = {
  className: "installation-state/session-id",
  door: "github",
  fields: ["body", "diff_hunk"],
  findingId: "0123456789abcdef",
  link: LINK,
} as const;

describe("evaluatePublicationLeak", () => {
  it("is clear on a complete clean run, a door this build does not read blocking nothing", () => {
    expect(evaluatePublicationLeak({ read: ok(report()) })).toEqual({ monitorId: "publication-leak", state: "clear" });
  });

  it("fires one subject per finding, naming class, door and link, keyed by the coordinate-only id", () => {
    const reading = firing({ reading: evaluatePublicationLeak({ read: ok(report({ findings: [FINDING] })) }) });
    expect(reading).toEqual({
      monitorId: "publication-leak",
      state: "firing",
      subjects: [
        {
          id: `github installation-state/session-id ${LINK}`,
          key: "0123456789abcdef",
          label: `installation-state/session-id on github, in body, diff_hunk: ${LINK}`,
          page: LINK,
        },
      ],
    });
  });

  it("names a withheld link as withheld and cites no page", () => {
    const reading = firing({
      reading: evaluatePublicationLeak({ read: ok(report({ findings: [{ ...FINDING, link: null }] })) }),
    });
    expect(reading.subjects).toEqual([
      {
        id: "github installation-state/session-id the link is withheld, a rule matched the address itself",
        key: "0123456789abcdef",
        label:
          "installation-state/session-id on github, in body, diff_hunk: the link is withheld, a rule matched the address itself",
      },
    ]);
  });

  it("keeps every open card when a swept door was read only partly", () => {
    const partial = report({ coverage: [door({ gaps: ["page ceiling"], state: "partial" })], findings: [FINDING] });
    const reading = firing({ reading: evaluatePublicationLeak({ read: ok(partial) }) });
    expect([reading.preservesDepartures, reading.blindSpot]).toEqual([
      true,
      "the last audit did not read github completely (evidence/publication-audit/2026-11-20T02-00-00Z-abcd1234)",
    ]);
  });

  it("is unmeasurable, never clear, when a partial run found nothing", () => {
    const partial = report({ coverage: [door({ gaps: ["read failed"], state: "partial" })] });
    expect(unmeasurable({ reading: evaluatePublicationLeak({ read: ok(partial) }) }).because).toBe(
      "the last audit did not read github completely (evidence/publication-audit/2026-11-20T02-00-00Z-abcd1234)",
    );
  });

  it("is unmeasurable, never clear, when nothing was found but an uploaded file went unread", () => {
    const unread = report({ coverage: [door({ attachmentsNotSwept: 1 })] });
    expect(evaluatePublicationLeak({ read: ok(unread) })).toEqual({
      because:
        "the last audit did not read 1 uploaded file(s) on github (evidence/publication-audit/2026-11-20T02-00-00Z-abcd1234)",
      monitorId: "publication-leak",
      state: "unmeasurable",
    });
  });

  it("is unmeasurable when no audit has run, naming the verb that runs one", () => {
    expect(
      unmeasurable({ reading: evaluatePublicationLeak({ read: err(PublicationAuditStoreErrors.absent()) }) }).because,
    ).toBe("no publication audit has run here — run `slopweaver audit publications`");
  });
});

describe("readPublicationLeak", () => {
  let home = "";
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reads an empty home as unmeasurable, never clear", () => {
    home = mkdtempSync(join(tmpdir(), "publication-leak-"));
    expect(unmeasurable({ reading: readPublicationLeak({ home }) }).because).toBe(
      "no publication audit has run here — run `slopweaver audit publications`",
    );
  });
});

describe("PUBLICATION_LEAK's card", () => {
  const subject = firing({ reading: evaluatePublicationLeak({ read: ok(report({ findings: [FINDING] })) }) })
    .subjects[0]!;

  it("asks the owner to act, naming the class and the door, inside the cap", () => {
    const what = PUBLICATION_LEAK.what({ subject });
    expect(what).toBe(
      "Edit or delete the published text at the link below — it carries leak class installation-state/session-id on github",
    );
    expect(what.length).toBeLessThanOrEqual(WHAT_CAP);
    expect(fleetActorPhrase({ what })).toBe(undefined);
  });

  it("composes a step the hand register accepts, citing the link", () => {
    const draft = unwrap(
      composeHandStep({ definition: PUBLICATION_LEAK, nowIso: NOW, postedBy: "workspace:29", subject }),
    );
    const step = unwrap(buildHandStep({ draft }));
    expect(step.context).toBe("work");
    expect(step.unblocks.length).toBeLessThanOrEqual(UNBLOCKS_CAP);
    expect(draft.cites).toEqual([LINK]);
  });
});
