/**
 * The refusal. The app-level token does not exist on this machine yet, so this report IS what a user sees
 * first — it has to name the credential, refuse a token of the wrong kind, and carry the one-time app setup.
 */
import { describe, expect, it } from "vitest";

import { renderConnectText } from "../../../../connect/render.js";
import type { ConnectCapability, ConnectCheckReport } from "../../../../connect/types.js";
import { err, ok, type Result, unwrap } from "../../../../lib/result.js";
import { LISTEN_SETUP_STEPS, listenPreflight } from "../../../../live/listen/preflight.js";
import type { ResponderWhitelist } from "../../../../live/listen/whitelist.js";
import {
  type WitnessIdentityError,
  WitnessIdentityErrors,
  type WitnessStateError,
} from "../../../../live/listen/witnessErrors.js";
import type { ResolvedWitnessBot } from "../../../../live/listen/witnessIdentity.js";
import { type Profile, parseProfile } from "../../../../profile.js";
import { type ProfileReadError, ProfileReadErrors } from "../../../../profileStore.js";

/** One capability by id, throwing when it is absent — no branch inside an assertion. */
function capability({ report, id }: { report: ConnectCheckReport; id: string }): ConnectCapability {
  const found = report.capabilities.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new Error(`no capability ${id} in the report`);
  }
  return found;
}

/** Deliberately short, obviously-fake stand-ins: a real-shaped token in a test is a leak waiting to happen. */
const GOOD_APP = "xapp-app";
const GOOD_BOT = "xoxb-bot";

/** A healthy, closed-elsewhere-only whitelist — the neutral fixture every token-focused test supplies. */
const HEALTHY: ResponderWhitelist = { identities: ["U0OWNER", "U0BOT"], kind: "list" };
const ABSENT: ResponderWhitelist = { kind: "absent" };
const EMPTY: ResponderWhitelist = { identities: [], kind: "list" };
const UNREADABLE: ResponderWhitelist = { kind: "unreadable", why: "responders.json is not valid JSON" };

/** The three profile reads: none on disk (the neutral fixture), a valid one, and one there but corrupt. */
const NO_PROFILE: Result<Profile | null, ProfileReadError> = ok(null);
const VALID_PROFILE: Result<Profile | null, ProfileReadError> = ok(
  unwrap(
    parseProfile({
      value: { displayName: "Ada Owner", gitNamespace: "ada-gh", id: "owner-1", schemaVersion: 1, sources: ["slack"] },
    }),
  ),
);
const CORRUPT_PATH = "/home/ada/.slopweaver/profile.json";
const CORRUPT_PROFILE: Result<Profile | null, ProfileReadError> = err(
  ProfileReadErrors.unreadable({ detail: "not JSON: Unexpected end of JSON input", path: CORRUPT_PATH }),
);

/** No witnessed bots configured — the neutral fixture. */
const NO_WITNESS: Result<readonly ResolvedWitnessBot[], WitnessIdentityError | WitnessStateError> = ok([]);

describe("listenPreflight", () => {
  it("is NOT ready with no app token, and says the credential is a third one", () => {
    const report = listenPreflight({
      appToken: undefined,
      botToken: GOOD_BOT,
      profile: NO_PROFILE,
      responderAllowOpen: false,
      responderWhitelist: HEALTHY,
      witness: NO_WITNESS,
    });

    expect(report.ok).toBe(false);
    expect(report.tokenPresent).toBe(false);
    expect(capability({ id: "app-token", report }).status).toBe("missing");
    expect(capability({ id: "app-token", report }).detail).toContain("neither the bot nor the user token");
  });

  it("carries the whole one-time setup, in order, when the app token is what is missing", () => {
    const report = listenPreflight({
      appToken: undefined,
      botToken: GOOD_BOT,
      profile: NO_PROFILE,
      responderAllowOpen: false,
      responderWhitelist: HEALTHY,
      witness: NO_WITNESS,
    });

    expect(report.warnings).toEqual(["set the listener up once, in this order:", ...LISTEN_SETUP_STEPS]);
  });

  it("names Socket Mode, the connections:write scope, the app_mention event and the secrets command", () => {
    const steps = LISTEN_SETUP_STEPS.join("\n");

    expect(steps).toContain("Socket Mode");
    expect(steps).toContain("connections:write");
    expect(steps).toContain("app_mention");
    expect(steps).toContain("app_mentions:read");
    expect(steps).toContain("slopweaver secrets set slack-app-token");
  });

  it("refuses a bot token pasted into the app-token slot", () => {
    const report = listenPreflight({
      appToken: GOOD_BOT,
      botToken: GOOD_BOT,
      profile: NO_PROFILE,
      responderAllowOpen: false,
      responderWhitelist: HEALTHY,
      witness: NO_WITNESS,
    });

    expect(report.ok).toBe(false);
    expect(capability({ id: "app-token", report }).detail).toContain("app-level token");
  });

  it("does not lecture about setup when the app token is present but the bot token is not", () => {
    const report = listenPreflight({
      appToken: GOOD_APP,
      botToken: undefined,
      profile: NO_PROFILE,
      responderAllowOpen: false,
      responderWhitelist: HEALTHY,
      witness: NO_WITNESS,
    });

    expect(report.warnings).toEqual([]);
    expect(capability({ id: "bot-token", report }).status).toBe("missing");
    expect(capability({ id: "bot-token", report }).detail).toContain("received but never answered");
  });

  it("refuses a user token in the bot slot, because it cannot post as the bot", () => {
    const report = listenPreflight({
      appToken: GOOD_APP,
      botToken: "xoxp-user",
      profile: NO_PROFILE,
      responderAllowOpen: false,
      responderWhitelist: HEALTHY,
      witness: NO_WITNESS,
    });

    expect(report.ok).toBe(false);
    expect(capability({ id: "bot-token", report }).status).toBe("missing");
  });

  it("is ready with both tokens, and STILL says what it could not verify", () => {
    const report = listenPreflight({
      appToken: GOOD_APP,
      botToken: GOOD_BOT,
      profile: NO_PROFILE,
      responderAllowOpen: false,
      responderWhitelist: HEALTHY,
      witness: NO_WITNESS,
    });

    expect(report.ok).toBe(true);
    expect(capability({ id: "app-subscription", report }).status).toBe("warning");
    expect(capability({ id: "app-subscription", report }).detail).toContain("app configuration");
  });

  it("treats an empty token string as absent", () => {
    const report = listenPreflight({
      appToken: "",
      botToken: "",
      profile: NO_PROFILE,
      responderAllowOpen: false,
      responderWhitelist: HEALTHY,
      witness: NO_WITNESS,
    });

    expect(report.ok).toBe(false);
    expect(capability({ id: "app-token", report }).status).toBe("missing");
    expect(capability({ id: "bot-token", report }).status).toBe("missing");
  });

  it("renders in the connect idiom under the listen heading, not a second report style", () => {
    const lines = renderConnectText({
      heading: "listen",
      report: listenPreflight({
        appToken: undefined,
        botToken: undefined,
        profile: NO_PROFILE,
        responderAllowOpen: false,
        responderWhitelist: HEALTHY,
        witness: NO_WITNESS,
      }),
    });

    expect(lines[0]).toBe("listen: NOT READY");
    expect(lines[1]).toContain("✗ app-token:");
  });

  it("keeps the default connect heading for every existing caller", () => {
    const lines = renderConnectText({
      report: listenPreflight({
        appToken: GOOD_APP,
        botToken: GOOD_BOT,
        profile: NO_PROFILE,
        responderAllowOpen: false,
        responderWhitelist: HEALTHY,
        witness: NO_WITNESS,
      }),
    });

    expect(lines[0]).toBe("connect slack: OK");
  });

  it("reports the responder whitelist as ok when it holds at least one identity", () => {
    const report = listenPreflight({
      appToken: GOOD_APP,
      botToken: GOOD_BOT,
      profile: NO_PROFILE,
      responderAllowOpen: false,
      responderWhitelist: HEALTHY,
      witness: NO_WITNESS,
    });

    expect(capability({ id: "responder-whitelist", report }).status).toBe("ok");
    expect(capability({ id: "responder-whitelist", report }).detail).toBe(
      "2 identities are whitelisted to command the bot",
    );
  });

  it.each([
    ["absent", ABSENT],
    ["empty", EMPTY],
    ["unreadable", UNREADABLE],
  ] as const)("reports a %s responder whitelist as a warning, never as missing", (_label, whitelist) => {
    const report = listenPreflight({
      appToken: GOOD_APP,
      botToken: GOOD_BOT,
      profile: NO_PROFILE,
      responderAllowOpen: false,
      responderWhitelist: whitelist,
      witness: NO_WITNESS,
    });

    expect(capability({ id: "responder-whitelist", report }).status).toBe("warning");
  });

  it("a closed responder whitelist does not make an otherwise-valid token report fail", () => {
    const report = listenPreflight({
      appToken: GOOD_APP,
      botToken: GOOD_BOT,
      profile: NO_PROFILE,
      responderAllowOpen: false,
      responderWhitelist: ABSENT,
      witness: NO_WITNESS,
    });

    expect(report.ok).toBe(true);
    expect(capability({ id: "responder-whitelist", report }).status).toBe("warning");
  });

  it("names the break-glass override in the responder-whitelist detail, never an identity", () => {
    const report = listenPreflight({
      appToken: GOOD_APP,
      botToken: GOOD_BOT,
      profile: NO_PROFILE,
      responderAllowOpen: true,
      responderWhitelist: ABSENT,
      witness: NO_WITNESS,
    });

    const detail = capability({ id: "responder-whitelist", report }).detail;
    expect(detail).toContain("the responder-allow-open grant is OPEN for this session");
    expect(detail).not.toContain("U0OWNER");
  });

  it("is NOT ready on a profile.json that is there but corrupt, even with both tokens good", () => {
    const report = listenPreflight({
      appToken: GOOD_APP,
      botToken: GOOD_BOT,
      profile: CORRUPT_PROFILE,
      responderAllowOpen: false,
      responderWhitelist: HEALTHY,
      witness: NO_WITNESS,
    });

    expect(report.ok).toBe(false);
    expect(capability({ id: "profile", report }).status).toBe("missing");
    expect(capability({ id: "profile", report }).detail).toContain(`the profile at ${CORRUPT_PATH}`);
    expect(capability({ id: "profile", report }).detail).toContain("The listener will not start on it");
  });

  it("is ready on an ABSENT profile, which is an unconfigured install rather than a broken one", () => {
    const report = listenPreflight({
      appToken: GOOD_APP,
      botToken: GOOD_BOT,
      profile: NO_PROFILE,
      responderAllowOpen: false,
      responderWhitelist: HEALTHY,
      witness: NO_WITNESS,
    });

    expect(report.ok).toBe(true);
    expect(capability({ id: "profile", report }).status).toBe("ok");
    expect(capability({ id: "profile", report }).detail).toBe(
      "no profile.json — an unconfigured install, so captures post on the default chrome",
    );
  });

  it("is ready on a valid profile", () => {
    const report = listenPreflight({
      appToken: GOOD_APP,
      botToken: GOOD_BOT,
      profile: VALID_PROFILE,
      responderAllowOpen: false,
      responderWhitelist: HEALTHY,
      witness: NO_WITNESS,
    });

    expect(report.ok).toBe(true);
    expect(capability({ id: "profile", report }).detail).toBe("profile.json is valid — captures post on its chrome");
  });

  it("reports witnessing as inert when no handle is configured", () => {
    const report = listenPreflight({
      appToken: GOOD_APP,
      botToken: GOOD_BOT,
      profile: NO_PROFILE,
      responderAllowOpen: false,
      responderWhitelist: HEALTHY,
      witness: NO_WITNESS,
    });

    expect(capability({ id: "witness", report }).status).toBe("ok");
    expect(capability({ id: "witness", report }).detail).toBe(
      "no slackBot.witnessBotHandles — only threads a person tagged this bot in are witnessed, under --follow",
    );
  });

  it("names each witnessed bot by handle and id", () => {
    const report = listenPreflight({
      appToken: GOOD_APP,
      botToken: GOOD_BOT,
      profile: NO_PROFILE,
      responderAllowOpen: false,
      responderWhitelist: HEALTHY,
      witness: ok([{ handle: "peerbot", userId: "U0PEER" }]),
    });

    expect(report.ok).toBe(true);
    expect(capability({ id: "witness", report }).detail).toBe(
      "witnessing every thread tagging @peerbot (U0PEER), and every thread a person tagged this bot in, under --follow",
    );
  });

  it("is NOT ready when a configured witness handle does not resolve", () => {
    const report = listenPreflight({
      appToken: GOOD_APP,
      botToken: GOOD_BOT,
      profile: NO_PROFILE,
      responderAllowOpen: false,
      responderWhitelist: HEALTHY,
      witness: err(WitnessIdentityErrors.notFound({ handle: "peerbot" })),
    });

    expect(report.ok).toBe(false);
    expect(capability({ id: "witness", report }).status).toBe("missing");
    expect(capability({ id: "witness", report }).detail).toContain(
      'witness handle "peerbot" matches no current Slack member',
    );
  });
});
