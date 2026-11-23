/**
 * The Vanta policy editor seam's two halves that need no browser: what the snippet's own JSON becomes, and
 * the digest bound on the edit arm.
 *
 * The bound is the interesting one. `editDraft` refuses any plan that does not hash to the digest the DOOR
 * admitted, and the refusal happens BEFORE the terminal client is run — so every test here constructs the
 * real shipped transport with deps pointing at paths that do not exist, and none of them could reach the owner's
 * Chrome even if the guard being checked were removed.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { err, ok, type Result, unwrap, unwrapErr } from "#lib/result.js";
import type { VantaDraftEditPlan } from "../../../atlas/vanta/policyDraft.js";
import { type BrowserTransportError, BrowserTransportErrors } from "../../../browser/pageTransport.js";
import {
  createVantaPolicyEditorTransport,
  EDITOR_SETTLE_MS,
  mutationFrom,
  observationFrom,
} from "../../../browser/vantaPolicyEditor.js";

/** What the terminal client prints for one operation: an envelope whose `result` is the snippet's JSON. */
function printed(snippet: Record<string, unknown>): Result<string, BrowserTransportError> {
  return ok(JSON.stringify({ result: JSON.stringify(snippet) }));
}

describe("observationFrom reads what the editor page reported", () => {
  it("carries the page's text, title and settled address through", () => {
    const seen = unwrap(
      observationFrom({
        result: printed({ finalUrl: "https://app.vanta.com/policies/x/edit", text: "## Scope", title: "Edit" }),
      }),
    );
    expect({ finalUrl: seen.finalUrl, text: seen.text, title: seen.title }).toEqual({
      finalUrl: "https://app.vanta.com/policies/x/edit",
      text: "## Scope",
      title: "Edit",
    });
  });

  it("reports an empty string for a field the snippet did not send, rather than undefined", () => {
    const seen = unwrap(observationFrom({ result: printed({}) }));
    expect({ finalUrl: seen.finalUrl, text: seen.text, title: seen.title }).toEqual({
      finalUrl: "",
      text: "",
      title: "",
    });
  });

  it("reports no editable regions when the snippet sent no list", () => {
    expect(unwrap(observationFrom({ result: printed({ regions: null }) })).regions).toEqual([]);
  });

  it("keeps a region the snippet fully described", () => {
    const seen = unwrap(
      observationFrom({
        result: printed({ regions: [{ className: "ProseMirror", tagName: "DIV", textLength: 410 }] }),
      }),
    );
    expect(seen.regions).toEqual([{ className: "ProseMirror", tagName: "DIV", textLength: 410 }]);
  });

  it("drops a region missing either of the two fields that identify it", () => {
    const seen = unwrap(
      observationFrom({
        result: printed({
          regions: [
            { className: "ProseMirror", textLength: 1 },
            { tagName: "DIV", textLength: 1 },
            { className: "ProseMirror", tagName: "DIV", textLength: 1 },
          ],
        }),
      }),
    );
    expect(seen.regions).toHaveLength(1);
  });

  it("drops a region entry that is not a record at all", () => {
    expect(unwrap(observationFrom({ result: printed({ regions: ["DIV"] }) })).regions).toEqual([]);
  });

  it("reads a region's text length as zero when the snippet sent none", () => {
    const seen = unwrap(observationFrom({ result: printed({ regions: [{ className: "c", tagName: "DIV" }] }) }));
    expect(seen.regions[0]!.textLength).toBe(0);
  });

  it("keeps only the string controls the snippet named", () => {
    const seen = unwrap(observationFrom({ result: printed({ controls: ["Save", 7, "Cancel"] }) }));
    expect(seen.controls).toEqual(["Save", "Cancel"]);
  });

  it("reports no controls when the snippet sent no list", () => {
    expect(unwrap(observationFrom({ result: printed({ controls: null }) })).controls).toEqual([]);
  });

  it("reads the region count the snippet sent, and zero when it sent none", () => {
    expect(unwrap(observationFrom({ result: printed({ regionCount: 3 }) })).regionCount).toBe(3);
    expect(unwrap(observationFrom({ result: printed({}) })).regionCount).toBe(0);
  });
});

describe("observationFrom tells a channel failure from a page failure", () => {
  it("passes a transport failure straight through rather than inventing an observation", () => {
    const failure = BrowserTransportErrors.sessionLost({ reason: "the relay stopped answering" });
    expect(unwrapErr(observationFrom({ result: err(failure) })).code).toBe("SESSION_LOST");
  });

  it("reads unparseable output as the session being lost, because the result never came home", () => {
    expect(unwrapErr(observationFrom({ result: ok("not json") })).code).toBe("SESSION_LOST");
  });

  it("reads a snippet-reported failure as that page's navigation failing", () => {
    const failed = observationFrom({ result: printed({ failure: "the editor never painted" }) });
    expect(unwrapErr(failed).code).toBe("NAVIGATION_FAILED");
    expect(unwrapErr(failed).message).toContain("the editor never painted");
  });
});

describe("mutationFrom reports what was typed, and what was refused", () => {
  // A refusal is PROOF that nothing was typed. A transport failure leaves the outcome unknown, and the
  // editor autosaves — so the two must never be reported as the same thing.
  it("reports a snippet refusal as a mutation rather than a transport failure", () => {
    const changed = unwrap(mutationFrom({ result: printed({ refused: "the expected text was not there" }) }));
    expect(changed.refused).toBe("the expected text was not there");
  });

  it("reports nothing typed alongside that refusal", () => {
    const changed = unwrap(mutationFrom({ result: printed({ refused: "no match" }) }));
    expect({ matched: changed.matched, typed: changed.typed }).toEqual({ matched: false, typed: false });
  });

  it("reports a completed substitution with its before and after", () => {
    const changed = unwrap(
      mutationFrom({
        result: printed({
          after: "## Scope\nnew",
          before: "## Scope\nold",
          matched: true,
          persisted: true,
          saved: true,
          typed: true,
        }),
      }),
    );
    expect({
      after: changed.after,
      before: changed.before,
      matched: changed.matched,
      persisted: changed.persisted,
      refused: changed.refused,
      saved: changed.saved,
      typed: changed.typed,
    }).toEqual({
      after: "## Scope\nnew",
      before: "## Scope\nold",
      matched: true,
      persisted: true,
      refused: null,
      saved: true,
      typed: true,
    });
  });

  it("carries each of the three error fields the snippet may report, and null when it reports none", () => {
    const failed = unwrap(mutationFrom({ result: printed({ persistError: "p", saveError: "s", typeError: "t" }) }));
    expect({ persistError: failed.persistError, saveError: failed.saveError, typeError: failed.typeError }).toEqual({
      persistError: "p",
      saveError: "s",
      typeError: "t",
    });
    const clean = unwrap(mutationFrom({ result: printed({}) }));
    expect({ persistError: clean.persistError, saveError: clean.saveError, typeError: clean.typeError }).toEqual({
      persistError: null,
      saveError: null,
      typeError: null,
    });
  });

  it("carries the screenshot path only when the snippet says it wrote one", () => {
    const wrote = unwrap(mutationFrom({ result: printed({ screenshotPath: "/x/a.png", screenshotWritten: true }) }));
    expect(wrote.screenshotPath).toBe("/x/a.png");
    const did = unwrap(mutationFrom({ result: printed({ screenshotPath: "/x/a.png", screenshotWritten: false }) }));
    expect(did.screenshotPath).toBe(null);
  });

  // The editor AUTOSAVES, so an unparseable answer means the draft may have been changed.
  it("warns that the draft may have changed when the write printed nothing parseable", () => {
    const lost = mutationFrom({ result: ok("not json") });
    expect(unwrapErr(lost).message).toContain("never repeat this operation blind");
  });

  it("passes a transport failure straight through", () => {
    const failure = BrowserTransportErrors.unavailable({ reason: "no relay" });
    expect(unwrapErr(mutationFrom({ result: err(failure) })).code).toBe("TRANSPORT_UNAVAILABLE");
  });

  it("reads a snippet-reported failure as that page's navigation failing", () => {
    expect(unwrapErr(mutationFrom({ result: printed({ failure: "the editor never painted" }) })).code).toBe(
      "NAVIGATION_FAILED",
    );
  });
});

describe("the edit arm is bound to the ONE substitution the door admitted", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "vanta-editor-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  const deps = () => ({
    chromePinPath: join(home, "no-such-pin"),
    extensionToken: "not-a-real-token",
    home,
    // A zero bound: one attempt, never a sleep.
    leaseWait: { clock: { nowMs: () => 0, sleep: () => Promise.resolve() }, emit: () => {}, timeoutSeconds: 0 },
    nowIso: () => "2026-09-14T00:00:00.000Z",
    origins: ["https://app.vanta.com"],
    platform: "vanta",
    scratchDir: home,
  });

  const plan: VantaDraftEditPlan = {
    expectedText: "old",
    find: "old",
    kind: "vanta-policy-draft-substitution-v1",
    replace: "new",
    url: "https://app.vanta.com/policies/x/edit",
  };

  it("refuses every edit on a read-only transport, without running the client at all", () => {
    const transport = createVantaPolicyEditorTransport({
      approvedDigest: null,
      deps: deps(),
      url: "https://app.vanta.com/policies/x/edit",
    });
    const edited = transport.editDraft({ plan });
    transport.release();
    expect(unwrapErr(edited).code).toBe("TRANSPORT_UNAVAILABLE");
  });

  it("says nothing was typed, which is the fact a caller acts on", () => {
    const transport = createVantaPolicyEditorTransport({
      approvedDigest: null,
      deps: deps(),
      url: "https://app.vanta.com/policies/x/edit",
    });
    const edited = transport.editDraft({ plan });
    transport.release();
    expect(unwrapErr(edited).message).toContain("nothing was typed");
  });

  // The realistic failure this bound exists for: a second caller wired without the door.
  it("refuses a DIFFERENT substitution than the one its digest was built for", () => {
    const transport = createVantaPolicyEditorTransport({
      approvedDigest: "a-digest-of-some-other-plan",
      deps: deps(),
      url: "https://app.vanta.com/policies/x/edit",
    });
    const edited = transport.editDraft({ plan });
    transport.release();
    expect(unwrapErr(edited).code).toBe("TRANSPORT_UNAVAILABLE");
  });

  it("names the digest bound rather than reporting a generic transport problem", () => {
    const transport = createVantaPolicyEditorTransport({
      approvedDigest: "a-digest-of-some-other-plan",
      deps: deps(),
      url: "https://app.vanta.com/policies/x/edit",
    });
    const edited = transport.editDraft({ plan });
    transport.release();
    expect(unwrapErr(edited).message).toContain("the digest the door admitted");
  });

  it("gives the editor six seconds to paint before it is read or typed into", () => {
    expect(EDITOR_SETTLE_MS).toBe(6_000);
  });
});
