/*
 * `classifyRawCommand`'s reaching-CLI table: a cloud or credential-vault CLI is blocked and pointed only at a verb
 * that exists, a bare invocation and the deliberately-absent names pass, and the ordinary inline escape opens one.
 */
import { describe, expect, it } from "vitest";

import { classifyRawCommand, RAW_ESCAPE } from "../../../../admit/rawTools.js";
import { blockedMessage, isBlocked } from "./harness.js";

describe("the reaching-CLI table", () => {
  it("blocks a cloud CLI and names no verb that does not exist", () => {
    const message = blockedMessage({ command: "gcloud secrets list --project some-staging" });
    expect(message).toContain("raw gcloud reaches a cloud control plane outside the door");
    expect(message).toContain("no governed verb performs this operation");
    expect(message).toContain(RAW_ESCAPE);
  });

  it("blocks a gcloud call the gcp door performs, and points it at that verb", () => {
    const message = blockedMessage({ command: "gcloud run deploy svc --image x --region r" });
    expect(message).toContain("raw gcloud reaches a cloud control plane outside the door");
    expect(message).toContain("`slopweaver gcp <run|secret|service-account|services|artifacts> <action>`");
  });

  it("blocks the credential-vault CLI, pointing only at the verb that really exists", () => {
    const message = blockedMessage({ command: "op item get 'Some API' --reveal --fields password" });
    expect(message).toContain("raw op reaches a credential vault outside the door");
    expect(message).toContain("`slopweaver secrets set`");
  });

  it("allows a BARE reaching tool — it prints help and touches nothing", () => {
    // Measured: every apparent `twilio`/`aws`/`stripe` use over a 14-day window was this shape or the
    // word in heredoc prose. Blocking it would make the gate's first impression a false positive.
    expect(isBlocked({ command: "gcloud" })).toBe(false);
    expect(isBlocked({ command: "twilio" })).toBe(false);
    expect(isBlocked({ command: "op" })).toBe(false);
  });

  it("leaves the deliberately-absent names alone", () => {
    // Each of these is a measured decision recorded in REACHING_TOOLS' own comment, not an oversight.
    // `python3` stays absent HERE on purpose: it is refused by the independent
    // `pythonInvocation` walk instead (asserted at the hook level in `hookPayload.test.ts`), because a
    // tool-choice rule is not a reach and must not be waivable by `SLOPWEAVER_ALLOW_RAW`.
    expect(isBlocked({ command: "python3 -c 'import urllib.request'" })).toBe(false);
    expect(isBlocked({ command: "docker compose exec -T postgres psql -U postgres" })).toBe(false);
    expect(isBlocked({ command: "ssh -T git@github.com" })).toBe(false);
    expect(isBlocked({ command: "yarn install" })).toBe(false);
  });

  it("resolves a reaching tool behind an env prefix, a path and a compound segment", () => {
    expect(isBlocked({ command: "FOO=bar gcloud auth list" })).toBe(true);
    expect(isBlocked({ command: "/usr/local/bin/gcloud auth list" })).toBe(true);
    expect(isBlocked({ command: "echo hi && gcloud auth list" })).toBe(true);
  });

  it("opens a cloud CLI with the ordinary inline escape", () => {
    expect(classifyRawCommand({ allowRaw: false, command: "SLOPWEAVER_ALLOW_RAW=1 gcloud auth list" }).blocked).toBe(
      false,
    );
    expect(classifyRawCommand({ allowRaw: true, command: "gcloud auth list" }).blocked).toBe(false);
  });
});
