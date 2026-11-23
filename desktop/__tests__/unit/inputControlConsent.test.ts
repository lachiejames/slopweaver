/**
 * The optional mouse and keyboard control step: offered until the owner answers, kept quiet after Not now unless they
 * reopen it, walked to its Settings page once they accept, and done only once macOS trusts the app.
 */
import { describe, expect, it } from "vitest";

import { inputControlView } from "../../src/inputControlConsent";

const APP = "Slopweaver";

describe("inputControlView", () => {
  it("offers it, off, before the owner has answered", () => {
    const view = inputControlView({ appName: APP, consent: undefined, review: false, trusted: false });
    expect(view.standing).toBe("offer");
    expect(view.step!.button).toEqual({
      label: "Turn on mouse & keyboard control",
      link: { kind: "input-control-accept" },
    });
    expect(view.step!.how[0]).toBe("Optional, and off until you turn it on.");
  });

  it("stays quiet after their Not now", () => {
    expect(inputControlView({ appName: APP, consent: "not-now", review: false, trusted: false })).toEqual({
      standing: "declined",
      step: undefined,
    });
  });

  it("offers it again when the owner reopens it themselves after a Not now", () => {
    const view = inputControlView({ appName: APP, consent: "not-now", review: true, trusted: false });
    expect(view.standing).toBe("offer");
    expect(view.step!.button.link).toEqual({ kind: "input-control-accept" });
  });

  it("walks the owner to its Settings page once they accepted and macOS does not trust the app yet", () => {
    const view = inputControlView({ appName: APP, consent: "accepted", review: false, trusted: false });
    expect(view.standing).toBe("settings");
    expect(view.step!.button).toEqual({
      label: "Open Accessibility settings",
      link: { kind: "input-control-settings" },
    });
    expect(view.step!.how[1]).toBe("Find Slopweaver in the list (not there? press + and choose it in Applications).");
  });

  it("is done once the owner accepted and macOS trusts the app", () => {
    expect(inputControlView({ appName: APP, consent: "accepted", review: false, trusted: true })).toEqual({
      standing: "granted",
      step: undefined,
    });
  });

  it("still offers it when macOS already trusts the app but the owner has not answered", () => {
    const view = inputControlView({ appName: APP, consent: undefined, review: false, trusted: true });
    expect(view.standing).toBe("offer");
    expect(view.step!.button.link).toEqual({ kind: "input-control-accept" });
  });

  it("stays declined after Not now even when macOS already trusts the app", () => {
    expect(inputControlView({ appName: APP, consent: "not-now", review: false, trusted: true })).toEqual({
      standing: "declined",
      step: undefined,
    });
  });
});
