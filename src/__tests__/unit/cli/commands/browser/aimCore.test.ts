import { describe, expect, it } from "vitest";

import type { ResolvedBrowserPolicy } from "../../../../../admit/browserPagePolicy.js";
import type { BrowserAdmission } from "../../../../../browser/action.js";
import { type AimMark, type AimShotResult, planAimShot } from "../../../../../browser/aimShot.js";
import type { PageObservation } from "../../../../../browser/interactionSession.js";
import {
  renderAdmissionPosture,
  renderAim,
  renderWritePosture,
  resolveAimMark,
  resolveAimOptions,
  resolveScrollOptions,
} from "../../../../../cli/commands/browser/actionCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const STEM = "/tmp/session/aim-2026-09-16T00-00-00.000Z";
const BEFORE = `${STEM}-before.png`;
const AIMED = `${STEM}-aimed.png`;
const SLACK = "https://app.slack.com/client/T01/C02";

const policy = (over: Partial<ResolvedBrowserPolicy> = {}): ResolvedBrowserPolicy => ({
  door: null,
  pageRuleAuthority: null,
  pageRuleId: null,
  policy: "read-before-write",
  provider: "Slack",
  ...over,
});

const admission = (over: Partial<BrowserAdmission> = {}): BrowserAdmission => ({
  kind: "click",
  pageRuleId: null,
  policy: "read-before-write",
  provider: "Slack",
  url: SLACK,
  waivedBecause: null,
  ...over,
});

const LOOK: PageObservation = {
  id: "obs-9",
  observedAtIso: "2026-09-16T08:24:33.612Z",
  screenshotPath: "/tmp/session/look-obs-9.png",
  snapshotPath: "/tmp/session/observation-obs-9.yml",
  title: "APM Home | Datadog",
  url: SLACK,
};

const shot = ({ mark = "highlight" }: { mark?: AimMark } = {}): AimShotResult => ({
  focus: null,
  pictureUrls: [SLACK],
  plan: planAimShot({ fullPage: false, mark, ref: "f1e11", stem: STEM }),
  scroll: null,
});

describe("validating one browser aim", () => {
  it("accepts a session and a ref", () => {
    const resolved = unwrap(
      resolveAimOptions({ focus: false, fullPage: false, json: false, session: "s1", target: "f1e11" }),
    );
    expect(resolved.sessionId).toBe("s1");
    expect(resolved.target).toBe("f1e11");
    expect(resolved.focus).toBe(false);
    expect(resolved.fullPage).toBe(false);
  });

  it("carries --focus and --full-page through", () => {
    const resolved = unwrap(
      resolveAimOptions({ focus: true, fullPage: true, json: false, session: "s1", target: "f1e11" }),
    );
    expect(resolved.focus).toBe(true);
    expect(resolved.fullPage).toBe(true);
  });

  it("refuses an aim with no session, naming the verb that prints one", () => {
    const problems = unwrapErr(
      resolveAimOptions({ focus: false, fullPage: false, json: false, session: undefined, target: "e42" }),
    );
    expect(problems).toEqual(["`browser aim` needs --session <id>, as `slopweaver browser open` printed it"]);
  });

  it("refuses an aim with no element, because a picture of no element is `browser shot`", () => {
    const problems = unwrapErr(
      resolveAimOptions({ focus: false, fullPage: false, json: false, session: "s1", target: undefined }),
    );
    expect(problems).toEqual([
      "`browser aim` needs --target <ref>, the element to show — take a `browser read` to find one",
    ]);
  });

  it("refuses an empty --target rather than aiming at the empty string", () => {
    const problems = unwrapErr(
      resolveAimOptions({ focus: false, fullPage: false, json: false, session: "s1", target: "" }),
    );
    expect(problems.length).toBe(1);
  });

  it("accumulates both rejections rather than stopping at the first", () => {
    const problems = unwrapErr(
      resolveAimOptions({ focus: false, fullPage: false, json: false, session: undefined, target: undefined }),
    );
    expect(problems.length).toBe(2);
  });
});

describe("validating one browser scroll", () => {
  it("walks one screen down when no count was named", () => {
    const resolved = unwrap(resolveScrollOptions({ json: false, pages: undefined, session: "s1", up: false }));
    expect(resolved.pages).toBe(1);
    expect(resolved.up).toBe(false);
  });

  it("takes the count and the direction that were named", () => {
    const resolved = unwrap(resolveScrollOptions({ json: false, pages: "3", session: "s1", up: true }));
    expect(resolved.pages).toBe(3);
    expect(resolved.up).toBe(true);
  });

  it("refuses a walk with no session", () => {
    const problems = unwrapErr(resolveScrollOptions({ json: false, pages: "1", session: undefined, up: false }));
    expect(problems).toEqual(["`browser scroll` needs --session <id>, as `slopweaver browser open` printed it"]);
  });

  it("refuses a fractional count rather than rounding one nobody asked for", () => {
    const problems = unwrapErr(resolveScrollOptions({ json: false, pages: "1.5", session: "s1", up: false }));
    expect(problems).toEqual(["--pages takes a whole number of screens, 1 or more (got 1.5)"]);
  });

  it("refuses a zero-screen walk, which would photograph nothing", () => {
    const problems = unwrapErr(resolveScrollOptions({ json: false, pages: "0", session: "s1", up: false }));
    expect(problems.length).toBe(1);
  });

  it("refuses a count that is not a number at all", () => {
    const problems = unwrapErr(resolveScrollOptions({ json: false, pages: "lots", session: "s1", up: false }));
    expect(problems).toEqual(["--pages takes a whole number of screens, 1 or more (got lots)"]);
  });
});

describe("whether the aim shot may put the page's own focus on its target", () => {
  it("highlights alone when no focus was asked for", () => {
    expect(resolveAimMark({ focus: false, policy: policy(), waived: false })).toEqual({
      mark: "highlight",
      skipped: null,
    });
  });

  it("focuses on a page the register lets this session write to", () => {
    expect(resolveAimMark({ focus: true, policy: policy(), waived: false })).toEqual({
      mark: "highlight-and-focus",
      skipped: null,
    });
  });

  it("refuses to focus a page the register refuses every write on, and says which posture refused", () => {
    const decided = resolveAimMark({
      focus: true,
      policy: policy({ policy: "refuse-every-write", provider: "JumpCloud" }),
      waived: false,
    });
    expect(decided.mark).toBe("highlight");
    expect(decided.skipped).toBe(
      "  --focus was not taken: JumpCloud is registered refuse-every-write, and a focus fires the page's own " +
        "focus and blur handlers. The target is highlighted instead",
    );
  });

  it("names an unregistered host as unregistered rather than as a row that decided against you", () => {
    const decided = resolveAimMark({
      focus: true,
      policy: policy({ policy: "refuse-every-write", provider: null }),
      waived: false,
    });
    expect(decided.skipped).toContain("this host is in no write-policy register");
  });

  it("focuses under a break-glass waiver, which is the case the operator asked hardest for", () => {
    expect(resolveAimMark({ focus: true, policy: policy({ policy: "refuse-every-write" }), waived: true })).toEqual({
      mark: "highlight-and-focus",
      skipped: null,
    });
  });

  it("never says a focus was dropped when none was asked for", () => {
    expect(
      resolveAimMark({ focus: false, policy: policy({ policy: "refuse-every-write" }), waived: false }).skipped,
    ).toBe(null);
  });
});

describe("the register's posture, printed beside the picture", () => {
  it("names the platform and the policy", () => {
    expect(renderWritePosture({ policy: policy() })).toBe("  this page: Slack — read-before-write");
  });

  it("names an unregistered host as unregistered, never as a row that decided against you", () => {
    expect(renderWritePosture({ policy: policy({ policy: "refuse-every-write", provider: null }) })).toBe(
      "  this page: unregistered host — refuse-every-write",
    );
  });

  it("names the page rule when one tightened the platform's own row", () => {
    expect(renderWritePosture({ policy: policy({ pageRuleId: "slack-client", policy: "refuse-every-write" }) })).toBe(
      "  this page: Slack — refuse-every-write, by page rule slack-client",
    );
  });

  it("reads an admission's own record rather than re-resolving the register after the fact", () => {
    expect(
      renderAdmissionPosture({ admission: admission({ provider: "JumpCloud", policy: "refuse-every-write" }) }),
    ).toBe("  this page: JumpCloud — refuse-every-write");
  });
});

describe("what an aim prints", () => {
  it("leads with the element and the page it is on", () => {
    const lines = renderAim({
      focusSkipped: null,
      notes: [],
      observation: LOOK,
      policy: policy(),
      result: shot(),
      url: SLACK,
    });
    expect(lines[0]).toBe(`browser aim: f1e11 on ${SLACK}`);
  });

  it("puts the register's posture in front of the reader", () => {
    const lines = renderAim({
      focusSkipped: null,
      notes: [],
      observation: LOOK,
      policy: policy(),
      result: shot(),
      url: SLACK,
    });
    expect(lines[1]).toBe("  this page: Slack — read-before-write");
  });

  it("names the unmarked viewport first — the page as it stands", () => {
    const lines = renderAim({
      focusSkipped: null,
      notes: [],
      observation: LOOK,
      policy: policy(),
      result: shot(),
      url: SLACK,
    });
    expect(lines[2]).toBe(`  before: ${BEFORE} — the viewport with f1e11 scrolled into it, unmarked`);
  });

  it("names the marked viewport after it — the same picture with the element on it", () => {
    const lines = renderAim({
      focusSkipped: null,
      notes: [],
      observation: LOOK,
      policy: policy(),
      result: shot(),
      url: SLACK,
    });
    expect(lines[3]).toBe(`  aimed: ${AIMED} — the same viewport, f1e11 highlighted`);
  });

  it("says out loud when a --focus was asked for and not taken", () => {
    const lines = renderAim({
      focusSkipped: "  --focus was not taken: because",
      notes: [],
      observation: LOOK,
      policy: policy(),
      result: shot(),
      url: SLACK,
    });
    expect(lines[4]).toBe("  --focus was not taken: because");
  });

  it("names the read the aim itself took, because it is the one the next act must cite", () => {
    const lines = renderAim({
      focusSkipped: null,
      notes: [],
      observation: LOOK,
      policy: policy(),
      result: shot(),
      url: SLACK,
    });
    expect(lines[4]).toBe(
      "  observation: obs-9 — cite this one; the aim\u0027s own read is now the session\u0027s latest",
    );
  });

  it("prints attributeAim's notes about a moved or unconfirmed page as given, before the observation line", () => {
    const notes = ["  the page moved during the aim: a -> b", "  unconfirmed: 1 picture(s) came back naming no page"];
    const lines = renderAim({
      focusSkipped: null,
      notes,
      observation: LOOK,
      policy: policy(),
      result: shot(),
      url: SLACK,
    });
    expect(lines[4]).toBe("  the page moved during the aim: a -> b");
    expect(lines[5]).toBe("  unconfirmed: 1 picture(s) came back naming no page");
    expect(lines[6]).toContain("observation: obs-9");
  });

  it("never prints the snapshot as a bare path to read whole — its outline follows from elementsReceipt", () => {
    const lines = renderAim({
      focusSkipped: null,
      notes: [],
      observation: LOOK,
      policy: policy(),
      result: shot(),
      url: SLACK,
    });
    expect(lines.filter((line) => line.includes(LOOK.snapshotPath))).toEqual([]);
  });

  it("says outright that nothing was done and nothing was granted", () => {
    const lines = renderAim({
      focusSkipped: null,
      notes: [],
      observation: LOOK,
      policy: policy(),
      result: shot(),
      url: SLACK,
    });
    expect(lines[5]).toContain("this grants nothing");
  });

  it("never tells the reader the action is now allowed, approved or cleared", () => {
    const lines = renderAim({
      focusSkipped: null,
      notes: [],
      observation: LOOK,
      policy: policy(),
      result: shot(),
      url: SLACK,
    });
    const claiming = lines.filter((line) => /approved|cleared|now allowed|authoris/u.test(line));
    expect(claiming).toEqual([]);
  });
});
