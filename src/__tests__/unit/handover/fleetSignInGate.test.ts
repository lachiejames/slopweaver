import { describe, expect, it } from "vitest";

import type { SignInProbeRow } from "../../../browser/signInProbeStore.js";
import {
  FLEET_SIGN_IN_CARD_HATCH,
  fleetSignInProviders,
  fleetSignInVerdict,
} from "../../../handover/fleetSignInGate.js";

/** The card that halted the Datadog stack , word for word in its opening. */
const INCIDENT =
  "Sign in to Datadog in the work Chrome so the stack can read the experimental branch's traces, then tell me to carry on.";

const NOW = "2026-10-06T11:00:00.000Z";
const COMMAND = "slopweaver handover ask";

/** A look at `minutesAgo` before {@link NOW}. */
function look({
  provider,
  verdict,
  minutesAgo,
}: {
  provider: SignInProbeRow["provider"];
  verdict: SignInProbeRow["verdict"];
  minutesAgo: number;
}): SignInProbeRow {
  return {
    atIso: new Date(Date.parse(NOW) - minutesAgo * 60_000).toISOString(),
    page: "https://app.datadoghq.com/account/login",
    provider,
    verdict,
    why: "Google asks for a passkey",
  };
}

describe("fleetSignInProviders", () => {
  it("reads the incident's card as a Datadog sign-in", () => {
    expect(fleetSignInProviders({ text: INCIDENT })).toEqual(["datadog"]);
  });

  it("reads a GitHub single sign-on ask", () => {
    expect(fleetSignInProviders({ text: "Complete GitHub SSO for acme so the push lands." })).toEqual(["github"]);
  });

  it("reads a provider that wants a sign-in", () => {
    expect(fleetSignInProviders({ text: "Datadog in the work Chrome wants a sign-in before the shot." })).toEqual([
      "datadog",
    ]);
  });

  it("passes a Google credential sign-in that only mentions Datadog", () => {
    expect(
      fleetSignInProviders({
        text: "Sign in to Google Cloud with gcloud auth application-default login so the Datadog stack boots.",
      }),
    ).toEqual([]);
  });
});

describe("fleetSignInVerdict", () => {
  it("refuses the incident's card when no look stands behind it", () => {
    const verdict = fleetSignInVerdict({ command: COMMAND, env: {}, nowIso: NOW, probes: [], texts: [INCIDENT] });

    expect(verdict.kind).toBe("refused");
    expect((verdict as { lines: readonly string[] }).lines.join("\n")).toContain(
      "Datadog: no look stands behind it — run `slopweaver browser sign-in --provider datadog` first",
    );
  });

  it("refuses when the newest look read the provider signed in", () => {
    const verdict = fleetSignInVerdict({
      command: COMMAND,
      env: {},
      nowIso: NOW,
      probes: [look({ minutesAgo: 5, provider: "datadog", verdict: "signed-in" })],
      texts: [INCIDENT],
    });

    expect((verdict as { lines: readonly string[] }).lines.join("\n")).toContain("SIGNED IN");
  });

  it("refuses when the newest look found a wall the fleet presses", () => {
    const verdict = fleetSignInVerdict({
      command: COMMAND,
      env: {},
      nowIso: NOW,
      probes: [look({ minutesAgo: 5, provider: "datadog", verdict: "pressable" })],
      texts: [INCIDENT],
    });

    expect((verdict as { lines: readonly string[] }).lines.join("\n")).toContain("a wall the fleet presses itself");
  });

  it("passes a card over a look that needs the owner's hands 29 minutes old", () => {
    const verdict = fleetSignInVerdict({
      command: COMMAND,
      env: {},
      nowIso: NOW,
      probes: [look({ minutesAgo: 29, provider: "datadog", verdict: "owner-hands" })],
      texts: [INCIDENT],
    });

    expect(verdict).toEqual({ kind: "ok" });
  });

  it("refuses a card over a look that needs the owner's hands 31 minutes old", () => {
    const verdict = fleetSignInVerdict({
      command: COMMAND,
      env: {},
      nowIso: NOW,
      probes: [look({ minutesAgo: 31, provider: "datadog", verdict: "owner-hands" })],
      texts: [INCIDENT],
    });

    expect((verdict as { lines: readonly string[] }).lines.join("\n")).toContain("too old to stand behind a card");
  });

  it("judges each provider by its own newest look, never the other's", () => {
    const verdict = fleetSignInVerdict({
      command: COMMAND,
      env: {},
      nowIso: NOW,
      probes: [
        look({ minutesAgo: 10, provider: "datadog", verdict: "owner-hands" }),
        look({ minutesAgo: 2, provider: "github", verdict: "owner-hands" }),
        look({ minutesAgo: 1, provider: "datadog", verdict: "signed-in" }),
      ],
      texts: [INCIDENT],
    });

    expect(verdict.kind).toBe("refused");
  });

  it("passes a card naming no provider sign-in", () => {
    const verdict = fleetSignInVerdict({
      command: COMMAND,
      env: {},
      nowIso: NOW,
      probes: [],
      texts: ["Pick which of the two dashboards the alert links to."],
    });

    expect(verdict).toEqual({ kind: "ok" });
  });

  it("passes on the hatch", () => {
    const verdict = fleetSignInVerdict({
      command: COMMAND,
      env: { [FLEET_SIGN_IN_CARD_HATCH]: "1" },
      nowIso: NOW,
      probes: [],
      texts: [INCIDENT],
    });

    expect(verdict).toEqual({ kind: "ok" });
  });

  it("names the hatch in the refusal's four lines", () => {
    const verdict = fleetSignInVerdict({ command: COMMAND, env: {}, nowIso: NOW, probes: [], texts: [INCIDENT] });

    expect((verdict as { lines: readonly string[] }).lines.join("\n")).toContain(
      `${FLEET_SIGN_IN_CARD_HATCH}=1 ${COMMAND}`,
    );
  });
});
