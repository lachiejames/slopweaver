import { describe, expect, it } from "vitest";
import { GMAIL_CARD_MAIL_USAGE } from "../../../../cli/commands/gmail/cardMailUsage.js";
import { GMAIL_TRIAGE_RULES_USAGE } from "../../../../cli/commands/gmail/triageRulesUsage.js";
import { GMAIL_TRIAGE_USAGE } from "../../../../cli/commands/gmail/triageUsage.js";
import { gmailManifest } from "../../../../cli/manifests/gmail.js";
import { gmailTriageManifest } from "../../../../cli/manifests/gmailTriage.js";

/*
 * The split is only correct if it changed WHICH FILE the rows live in and nothing else: every verb still reachable
 * through `gmailManifest`, every one `local-state` and door-routed nowhere, and each quoting its own usage leaf.
 */
describe("gmailTriageManifest", () => {
  it("declares the verbs behind an inbox-triage card, and the writer of the rows triage archives by", () => {
    expect(Object.keys(gmailTriageManifest)).toEqual(["card-mail", "triage-rules", "triage"]);
  });

  it("declares every verb local-state and door-routed nowhere — none changes the mailbox", () => {
    const metas = ["card-mail", "triage-rules", "triage"].map((verb) => gmailTriageManifest[verb]!.meta);
    expect(metas.map((meta) => [meta.effect, meta.doorRouted])).toEqual([
      ["local-state", false],
      ["local-state", false],
      ["local-state", false],
    ]);
  });

  it("is spread into the gmail noun, so every verb is still dispatchable by name", () => {
    expect(gmailManifest["card-mail"]).toBe(gmailTriageManifest["card-mail"]);
    expect(gmailManifest["triage-rules"]).toBe(gmailTriageManifest["triage-rules"]);
    expect(gmailManifest["triage"]).toBe(gmailTriageManifest["triage"]);
  });

  it("keeps triage where it sat, between send and unsubscribe", () => {
    const names = Object.keys(gmailManifest);
    expect(names.slice(names.indexOf("send"), names.indexOf("send") + 5)).toEqual([
      "send",
      "card-mail",
      "triage-rules",
      "triage",
      "unsubscribe",
    ]);
  });

  it("quotes each verb's usage from its leaf — the constant the command itself prints", () => {
    expect(gmailTriageManifest["card-mail"]!.meta.usage).toBe(GMAIL_CARD_MAIL_USAGE);
    expect(gmailTriageManifest["triage-rules"]!.meta.usage).toBe(GMAIL_TRIAGE_RULES_USAGE);
    expect(gmailTriageManifest["triage"]!.meta.usage).toBe(GMAIL_TRIAGE_USAGE);
  });
});
