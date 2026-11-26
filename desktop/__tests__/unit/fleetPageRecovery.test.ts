/**
 * The Sessions page's Recovery check: its line in each state, its one button of its own, absent while a check runs,
 * and the one fixed link that button navigates to.
 */
import { describe, expect, it } from "vitest";
import { FleetRecoveryErrors } from "../../src/errors";
import type { FleetHealth } from "../../src/fleetHealth";
import { fleetLinkOf, fleetPageHtml, fleetUnreadableUrl } from "../../src/fleetPage";
import { type FleetRecoveryResult, type FleetRecoveryState, RECOVERY_IDLE } from "../../src/fleetRecoveryCheck";

/** A healthy reading with no hand step, so the only button on the page can be Recovery's. */
const HEALTH: FleetHealth = {
  capacity: { configured: 2, online: 2 },
  console: "serving",
  lastAttempt: undefined,
  newestAttempt: undefined,
  observedAtIso: "2026-10-04T10:00:00.000Z",
  reason: {
    code: "HEALTHY",
    detail: "Every seat is working.",
    handStep: undefined,
    headline: "All good.",
    raw: undefined,
  },
  recoveryPhase: undefined,
  seats: [],
  state: "healthy",
  unmapped: [],
};

/** Claude started on its second plan; Codex's only plan is signed out. */
const PARTIAL: FleetRecoveryResult = {
  attempts: [
    { alias: "claude-2", outcome: "passed", reason: "it answered", sessionId: "s-1", vendor: "claude" },
    { alias: "codex-1", outcome: "launch-refused", reason: "signed out <x>", vendor: "codex" },
  ],
  signIn: { alias: "codex-1", command: "codex login", vendor: "codex" },
  status: "partial",
  vendors: [
    { alias: "claude-2", reason: "it answered", status: "passed", vendor: "claude" },
    { reason: "signed out <x>", status: "failed", vendor: "codex" },
  ],
};

/** The page's HTML for one Recovery state. */
function pageFor({ recovery }: { recovery: FleetRecoveryState }): string {
  return fleetPageHtml({ health: HEALTH, recovery, timeZone: "Australia/Sydney" });
}

describe("the Sessions page's Recovery check", () => {
  it("offers its own Recovery button before any check, on its one fixed link", () => {
    expect(pageFor({ recovery: RECOVERY_IDLE })).toContain(
      '<p class="title">Recovery check: not run since the app opened.</p><a class="act" href="slopweaver-fleet://recover">Recovery</a>',
    );
  });

  it("draws no Recovery button while a check runs, so the page cannot start a second", () => {
    const html = pageFor({ recovery: { kind: "running" } });
    expect(html).toContain('<p class="title">Recovery check: checking Claude, then Codex…</p>');
    expect(html).not.toContain("slopweaver-fleet://recover");
    expect(html).not.toContain('class="act"');
  });

  it("names each vendor's verdict and the sign-in command, escaped, and offers the button again", () => {
    expect(pageFor({ recovery: { kind: "result", result: PARTIAL } })).toContain(
      '<p class="title">Recovery check: only one vendor can start a session.</p><ul class="why">' +
        "<li>Claude started a session on plan claude-2.</li>" +
        "<li>Codex did not pass: signed out &lt;x&gt;</li>" +
        "<li>To sign codex-1 back in, run codex login</li>" +
        '</ul><a class="act" href="slopweaver-fleet://recover">Recovery</a>',
    );
  });

  it("says a timed-out check recorded no success", () => {
    const html = pageFor({ recovery: { error: FleetRecoveryErrors.timeout({ seconds: 840 }), kind: "no-result" } });
    expect(html).toContain(
      '<p class="title">Recovery check: no result.</p><ul class="why"><li>fleet recover did not finish in 14 minutes, so no success was recorded</li></ul>',
    );
  });

  it("stays on the page while the fleet cannot be read, since the check needs no reading", () => {
    const html = decodeURIComponent(
      fleetUnreadableUrl({ problem: "no output", recovery: RECOVERY_IDLE }).slice(
        "data:text/html;charset=utf-8,".length,
      ),
    );
    expect(html).toContain('<a class="act" href="slopweaver-fleet://recover">Recovery</a>');
  });
});

describe("fleetLinkOf on the Recovery link", () => {
  it("reads the fixed Recovery link back, carrying nothing", () => {
    expect(fleetLinkOf({ url: "slopweaver-fleet://recover" })).toEqual({ kind: "recover" });
  });

  it("ignores anything that only starts like it", () => {
    expect(fleetLinkOf({ url: "slopweaver-fleet://recover/x" })).toBeUndefined();
    expect(fleetLinkOf({ url: "slopweaver-fleet://recover?vendor=claude" })).toBeUndefined();
    expect(fleetLinkOf({ url: "slopweaver-fleet://recovery" })).toBeUndefined();
  });
});
