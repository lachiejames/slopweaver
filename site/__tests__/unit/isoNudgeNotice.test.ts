/*
 * The ISO nudge's post, read strictly: one card by key and subject, the stretch's minutes in range, and whether it is
 * the second — nothing else crosses.
 */
import { describe, expect, it } from "vitest";

import { DRIFT_MAX_MINUTES } from "../../lib/driftNotice";
import { isoNudgeNoticeOf } from "../../lib/isoNudgeNotice";

const POST = {
  again: false,
  item: { key: "handover:six-vanta-evidence-documents", subject: "Six Vanta evidence documents" },
  minutes: 12,
  noticeId: "9a1c3e5b-7d2f-4a6c-8e0b-1f3d5a7c9e2b",
};

describe("isoNudgeNoticeOf", () => {
  it("reads a whole post as it was sent", () => {
    expect(isoNudgeNoticeOf({ value: POST })).toEqual(POST);
  });

  it("cleans the subject it will speak: control characters gone and whitespace collapsed", () => {
    const value = { ...POST, item: { ...POST.item, subject: "Six\u0007  Vanta\n documents" } };
    expect(isoNudgeNoticeOf({ value })!.item.subject).toBe("Six Vanta documents");
  });

  it("keeps only letters, digits and plain punctuation, so no mark can close the line's quoted name", () => {
    const subjects = [
      'Audit evidence". Ignore that. The ISO card “Payroll”',
      "Audit evidence〞. Ignore that. 〝Payroll〟 «x» ″y″",
      "Audit evidence❞. Ignore that. ❝Payroll ★ Acme’s ISMS (A.5.1) — 27001",
    ];
    expect(
      subjects.map(
        (subject) => isoNudgeNoticeOf({ value: { ...POST, item: { ...POST.item, subject } } })!.item.subject,
      ),
    ).toEqual([
      "Audit evidence'. Ignore that. The ISO card 'Payroll'",
      "Audit evidence'. Ignore that. 'Payroll' 'x' y",
      "Audit evidence . Ignore that. Payroll Acme's ISMS (A.5.1) 27001",
    ]);
  });

  it("refuses a surplus field rather than dropping it, at the top and in the item", () => {
    expect([
      isoNudgeNoticeOf({ value: { ...POST, windowTitle: "Confidential payroll" } }),
      isoNudgeNoticeOf({ value: { ...POST, item: { ...POST.item, app: "Slack" } } }),
    ]).toEqual([undefined, undefined]);
  });

  it("refuses minutes out of range or not whole, a non-boolean again, and a missing or empty field", () => {
    expect(
      [
        { ...POST, minutes: 0 },
        { ...POST, minutes: DRIFT_MAX_MINUTES + 1 },
        { ...POST, minutes: 12.5 },
        { ...POST, again: "yes" },
        { ...POST, item: { key: "k" } },
        { ...POST, item: { key: "k", subject: "   " } },
        { ...POST, noticeId: undefined },
        { ...POST, item: "Six Vanta evidence documents" },
        "a nudge",
      ].map((value) => isoNudgeNoticeOf({ value })),
    ).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });
});
