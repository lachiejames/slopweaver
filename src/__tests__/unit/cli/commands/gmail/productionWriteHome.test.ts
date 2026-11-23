/**
 * The PRODUCTION Gmail write edges judge under the home the verb resolved, never the ambient one: `gmail draft`'s
 * `applyDraft({ home })` and `spend forward`'s `productionDrafts({ home })`. Each is driven with an explicit home that
 * holds a compose grant (a cached token, so no refresh) and a private PERSON term the draft carries. The ambient
 * sandbox home a test runs under holds no terms file at all, so a write judged there would refuse with "does not
 * exist" instead: the refusal naming the person class proves which home judged it. Every case is refused before the
 * wire, so nothing reaches the network. Synthetic terms: `quillfeather` is the private person term.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { productionGmailComposeDeps } from "../../../../../cli/commands/gmail/composeDeps.js";
import { productionDrafts } from "../../../../../cli/commands/spend/forwardEdges.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { buildMimeMessage, toRawBase64Url } from "../../../../../live/gmail/compose.js";
import { refusedBeforeGmailWire } from "../../../../../outbound/gmail/sendFailure.js";
import { connectGmailHome } from "../../../../gmailTransportFixture.js";
import { writePrivateTerms } from "../../../../privateTermsFixture.js";
import { draftPlanFixture } from "./composeRun/harness.js";

const COMPOSE = "https://www.googleapis.com/auth/gmail.compose";
const homes: string[] = [];

afterEach(() => {
  for (const made of homes.splice(0)) {
    rmSync(made, { force: true, recursive: true });
  }
});

/** A home connected for compose whose private terms name `quillfeather` as a person. */
function verbHome(): string {
  const made = mkdtempSync(join(tmpdir(), "gmail-production-home-"));
  homes.push(made);
  connectGmailHome({ home: made, scopes: [COMPOSE] });
  writePrivateTerms({ home: made, rows: ["person\ti\tquillfeather\tsynthetic"] });
  return made;
}

/** A raw draft whose body names the private person term. */
const RAW = Buffer.from("Subject: note\r\n\r\nfor quillfeather\r\n", "utf8").toString("base64url");

describe("the production Gmail write edges judge under the verb's home", () => {
  it("gmail draft's applyDraft refuses by the explicit home's own person term", async () => {
    const fixture = draftPlanFixture();
    const form = { ...fixture.form, body: "for quillfeather" };
    const raw = toRawBase64Url({ message: buildMimeMessage({ form, from: fixture.from }) });
    const result = await productionGmailComposeDeps().applyDraft({
      home: verbHome(),
      once: true,
      plan: { ...fixture, form, raw },
    });
    const error = unwrapErr(result);
    expect(error.message).toContain("gmail drafts.create message.raw text line 1: a private person term");
    expect(error.message).not.toContain("does not exist");
    expect(refusedBeforeGmailWire({ error })).toBe(true);
  });

  it("spend forward's productionDrafts refuses by the explicit home's own person term", async () => {
    const drafts = unwrap(productionDrafts({ home: verbHome() }));
    const error = unwrapErr(await drafts.createDraft({ raw: RAW }));
    expect(error.message).toContain("gmail drafts.create message.raw text line 1: a private person term");
    expect(error.message).not.toContain("does not exist");
    expect(refusedBeforeGmailWire({ error })).toBe(true);
  });
});
