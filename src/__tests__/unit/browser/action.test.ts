import { describe, expect, it } from "vitest";

import {
  admitBrowserAction,
  BROWSER_ACTION_KINDS,
  isBrowserActionKind,
  isWriteCapableAction,
  judgeWhereItLanded,
} from "../../../browser/action.js";
import { BrowserActionErrors } from "../../../browser/actionErrors.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const JUMPCLOUD = "https://console.jumpcloud.com/#/users";
const DATADOG = "https://app.datadoghq.com/monitors";
const NOW = "2026-09-12T04:00:00.000Z";

describe("the interaction vocabulary", () => {
  it("names nineteen interactions", () => {
    expect(BROWSER_ACTION_KINDS.length).toBe(19);
  });

  it("treats a hover as write-capable, because it fires the page's own handlers", () => {
    expect(isWriteCapableAction({ kind: "hover" })).toBe(true);
  });

  it("treats a scroll as write-capable for the same reason", () => {
    expect(isWriteCapableAction({ kind: "scroll" })).toBe(true);
  });

  it("leaves a reload out, so a read-only page is never a trap you cannot leave", () => {
    expect(isWriteCapableAction({ kind: "reload" })).toBe(false);
  });

  it("leaves going back out", () => {
    expect(isWriteCapableAction({ kind: "back" })).toBe(false);
  });

  it("leaves dismissing a dialog out, so a modal cannot wedge a session", () => {
    expect(isWriteCapableAction({ kind: "dialog-dismiss" })).toBe(false);
  });

  it("rejects a word that is not an interaction", () => {
    expect(isBrowserActionKind("eval")).toBe(false);
  });

  it("accepts one that is", () => {
    expect(isBrowserActionKind("click")).toBe(true);
  });
});

describe("the per-page read-only rail", () => {
  it("HARD FAILS a click on the JumpCloud console, a hard owner ruling", () => {
    const decided = admitBrowserAction({ kind: "click", nowIso: NOW, url: JUMPCLOUD, waiver: undefined });
    expect(unwrapErr(decided).code).toBe("ACTION_REFUSED");
    expect(unwrapErr(decided).message).toContain(JUMPCLOUD);
  });

  it("names the interaction and the page in the refusal", () => {
    const decided = admitBrowserAction({ kind: "click", nowIso: NOW, url: JUMPCLOUD, waiver: undefined });
    expect(unwrapErr(decided).message).toContain("--do click on https://console.jumpcloud.com/#/users");
  });

  it("carries the code a caller branches on", () => {
    const decided = admitBrowserAction({ kind: "click", nowIso: NOW, url: JUMPCLOUD, waiver: undefined });
    expect(unwrapErr(decided).code).toBe("ACTION_REFUSED");
  });

  it("prints the escape hatch the owner asked for", () => {
    const decided = admitBrowserAction({ kind: "click", nowIso: NOW, url: JUMPCLOUD, waiver: undefined });
    expect(unwrapErr(decided).message).toContain("slopweaver browser break-glass --page");
  });

  it("still allows a READ on that same page", () => {
    const decided = admitBrowserAction({ kind: "back", nowIso: NOW, url: JUMPCLOUD, waiver: undefined });
    expect(unwrap(decided).url).toBe(JUMPCLOUD);
    expect(unwrap(decided).waivedBecause).toBe(null);
  });

  it("allows a click on Datadog, which is ruled read-before-write", () => {
    const decided = admitBrowserAction({ kind: "click", nowIso: NOW, url: DATADOG, waiver: undefined });
    expect(unwrap(decided).url).toBe(DATADOG);
    expect(unwrap(decided).waivedBecause).toBe(null);
  });

  it("allows a click on Vanta, because the ruling is WE WRITE IN VANTA NOW", () => {
    const decided = admitBrowserAction({
      kind: "click",
      nowIso: NOW,
      url: "https://app.vanta.com/policies",
      waiver: undefined,
    });
    expect(unwrap(decided).url).toBe("https://app.vanta.com/policies");
    expect(unwrap(decided).waivedBecause).toBe(null);
  });

  it("refuses a click on a host in no register at all", () => {
    const decided = admitBrowserAction({
      kind: "click",
      nowIso: NOW,
      url: "https://admin.example.invalid/settings",
      waiver: undefined,
    });
    expect(unwrapErr(decided).code).toBe("ACTION_REFUSED");
  });
});

describe("the escape hatch", () => {
  const waiver = {
    expiresAtIso: "2026-09-12T04:30:00.000Z",
    reason: "the owner asked for this exact change",
    url: JUMPCLOUD,
  };

  it("lets a click through on the page it names", () => {
    const decided = admitBrowserAction({ kind: "click", nowIso: NOW, url: JUMPCLOUD, waiver });
    expect(unwrap(decided).waivedBecause).toBe("the owner asked for this exact change");
  });

  it("does NOT let it through on a different page of the same host", () => {
    const decided = admitBrowserAction({
      kind: "click",
      nowIso: NOW,
      url: "https://console.jumpcloud.com/#/settings",
      waiver,
    });
    expect(unwrapErr(decided).code).toBe("ACTION_REFUSED");
    expect(unwrapErr(decided).message).toContain("https://console.jumpcloud.com/#/settings");
  });

  it("does not let it through once it has expired", () => {
    const decided = admitBrowserAction({ kind: "click", nowIso: "2026-09-12T05:00:00.000Z", url: JUMPCLOUD, waiver });
    expect(unwrapErr(decided).code).toBe("ACTION_REFUSED");
    expect(unwrapErr(decided).message).toContain("--do click on ");
  });
});

describe("the two-command interactions cannot straddle two pages", () => {
  it("names upload as a write, so BOTH of its commands are judged rather than only the first", () => {
    expect(isWriteCapableAction({ kind: "upload" })).toBe(true);
  });

  it("names download as a write too, because its trigger is an ordinary click", () => {
    expect(isWriteCapableAction({ kind: "download" })).toBe(true);
  });

  it("refuses an upload aimed at a page the waiver does not name — the counterexample's second half", () => {
    const decided = admitBrowserAction({
      kind: "upload",
      nowIso: NOW,
      url: "https://console.jumpcloud.com/#/other",
      waiver: { expiresAtIso: "2026-09-12T04:30:00.000Z", reason: "one page", url: JUMPCLOUD },
    });
    expect(unwrapErr(decided).code).toBe("ACTION_REFUSED");
    expect(unwrapErr(decided).message).toContain("--do upload on https://console.jumpcloud.com/#/other");
  });
});

describe("a waiver's deadline is a deadline", () => {
  const waiver = { expiresAtIso: "2026-09-12T04:30:00.000Z", reason: "one page, one window", url: JUMPCLOUD };

  it("accepts it one second before it lapses", () => {
    const decided = admitBrowserAction({ kind: "upload", nowIso: "2026-09-12T04:29:59.000Z", url: JUMPCLOUD, waiver });
    expect(unwrap(decided).waivedBecause).toBe("one page, one window");
  });

  it("refuses it one second after — the instant a second-half judgement must be made against", () => {
    const decided = admitBrowserAction({ kind: "upload", nowIso: "2026-09-12T04:30:01.000Z", url: JUMPCLOUD, waiver });
    expect(unwrapErr(decided).code).toBe("ACTION_REFUSED");
    expect(unwrapErr(decided).message).toContain("--do upload on ");
  });
});

describe("a write that lands on a read-only page is reported, since it cannot be prevented", () => {
  it("still refuses a hover on JumpCloud, so the detection is a second line and not the first", () => {
    const decided = admitBrowserAction({ kind: "hover", nowIso: NOW, url: JUMPCLOUD, waiver: undefined });
    expect(unwrapErr(decided).code).toBe("ACTION_REFUSED");
    expect(unwrapErr(decided).message).toContain("--do hover on ");
  });

  it("carries the page it was judged against, which is what a move is detected against", () => {
    const decided = admitBrowserAction({ kind: "click", nowIso: NOW, url: DATADOG, waiver: undefined });
    expect(unwrap(decided).url).toBe(DATADOG);
  });
});

describe("an error arm reachable after a dispatch says so", () => {
  it("tells the caller a stranded upload chooser's click already ran", () => {
    const failure = BrowserActionErrors.uploadChooserStranded({
      actionId: "a-1",
      because: "the page is read-only",
      delivery: "refused",
    });
    expect(failure.message).toContain("HAS run");
  });

  it("tells them not to simply re-run it", () => {
    const failure = BrowserActionErrors.uploadChooserStranded({
      actionId: "a-1",
      because: "the page is read-only",
      delivery: "refused",
    });
    expect(failure.message).toContain("Do not simply re-run this command");
  });

  it("keeps the rail's own reason rather than losing it in the retelling", () => {
    const failure = BrowserActionErrors.uploadChooserStranded({
      actionId: "a-1",
      because: "the page is read-only",
      delivery: "refused",
    });
    expect(failure.because).toBe("the page is read-only");
  });

  it("says plainly that a page which moved under an action has already been written to", () => {
    const failure = BrowserActionErrors.pageMovedUnderAction({
      actionId: "a-2",
      judgedUrl: DATADOG,
      landedUrl: JUMPCLOUD,
    });
    expect(failure.message).toContain("this is not a failure to retry");
  });
});

describe("a client failure says whether it could already have acted", () => {
  it("reads as nothing-happened when it came from a READ", () => {
    const failure = BrowserActionErrors.clientFailed({ detail: "no session" });
    expect(failure.mayHaveReachedPage).toBe(false);
  });

  it("reports the outcome as UNKNOWN when it came from a dispatch", () => {
    const failure = BrowserActionErrors.clientFailed({ detail: "process died", mayHaveReachedPage: true });
    expect(failure.message).toContain("treat the outcome as UNKNOWN");
  });

  it("tells the caller to go and look before doing anything else", () => {
    const failure = BrowserActionErrors.clientFailed({ detail: "process died", mayHaveReachedPage: true });
    expect(failure.message).toContain("browser read");
  });
});

describe("a stranded upload does not assert what it cannot see", () => {
  it("says no bytes moved when the rail refused the delivery", () => {
    const failure = BrowserActionErrors.uploadChooserStranded({
      actionId: "a-1",
      because: "the page is read-only",
      delivery: "refused",
    });
    expect(failure.message).toContain("No bytes were uploaded");
  });

  it("says the outcome is UNKNOWN when the delivery command never answered", () => {
    const failure = BrowserActionErrors.uploadChooserStranded({
      actionId: "a-1",
      because: "the client died",
      delivery: "unknown",
    });
    expect(failure.message).toContain("treat the outcome as UNKNOWN");
  });

  it("never claims no bytes moved in that case", () => {
    const failure = BrowserActionErrors.uploadChooserStranded({
      actionId: "a-1",
      because: "the client died",
      delivery: "unknown",
    });
    expect(failure.message).not.toContain("No bytes were uploaded");
  });
});

describe("a stranded upload does not call an unknown outcome a failure", () => {
  it("allows that the delivery may well have completed", () => {
    const failure = BrowserActionErrors.uploadChooserStranded({
      actionId: "a-1",
      because: "the client died",
      delivery: "unknown",
    });
    expect(failure.message).toContain("It may well have completed");
  });

  it("still says the chooser-opening click ran", () => {
    const failure = BrowserActionErrors.uploadChooserStranded({
      actionId: "a-1",
      because: "the client died",
      delivery: "unknown",
    });
    expect(failure.message).toContain("HAS run");
  });
});

describe("an evidence failure says what ran, not what changed", () => {
  it("says the action was performed against the page", () => {
    const failure = BrowserActionErrors.actionAppliedEvidenceFailed({ actionId: "a-3", detail: "no disk" });
    expect(failure.message).toContain("HAS been performed against the page");
  });

  it("never claims the page was changed, which the missing evidence is what would have shown", () => {
    const failure = BrowserActionErrors.actionAppliedEvidenceFailed({ actionId: "a-3", detail: "no disk" });
    expect(failure.message).not.toContain("The page HAS been changed");
  });
});

describe("judgeWhereItLanded — the after-half of the admission", () => {
  const onDatadog = unwrap(admitBrowserAction({ kind: "click", nowIso: NOW, url: DATADOG, waiver: undefined }));

  it("reports a write that finished on a page refusing every write", () => {
    const report = judgeWhereItLanded({
      actionId: "a-4",
      admission: onDatadog,
      settledUrl: JUMPCLOUD,
      waiver: undefined,
    });
    expect(report).toEqual(
      BrowserActionErrors.pageMovedUnderAction({ actionId: "a-4", judgedUrl: DATADOG, landedUrl: JUMPCLOUD }),
    );
  });

  it("says nothing when the action stayed on the page it was judged against", () => {
    expect(
      judgeWhereItLanded({ actionId: "a-4", admission: onDatadog, settledUrl: DATADOG, waiver: undefined }),
    ).toBeNull();
  });

  it("says nothing when it moved to another writable page", () => {
    const settledUrl = "https://app.datadoghq.com/dashboard/lists";
    expect(judgeWhereItLanded({ actionId: "a-4", admission: onDatadog, settledUrl, waiver: undefined })).toBeNull();
  });

  it("says nothing when a live waiver names the page it landed on", () => {
    const waiver = { expiresAtIso: "2026-09-12T04:30:00.000Z", reason: "that page", url: JUMPCLOUD };
    expect(judgeWhereItLanded({ actionId: "a-4", admission: onDatadog, settledUrl: JUMPCLOUD, waiver })).toBeNull();
  });

  it("says nothing about a read, which crossed nothing wherever it finished", () => {
    const read = unwrap(admitBrowserAction({ kind: "back", nowIso: NOW, url: DATADOG, waiver: undefined }));
    expect(
      judgeWhereItLanded({ actionId: "a-4", admission: read, settledUrl: JUMPCLOUD, waiver: undefined }),
    ).toBeNull();
  });
});
