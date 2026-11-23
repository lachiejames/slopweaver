/*
 * Which addresses `browser shot` may photograph: a doorless address, Datadog, and every doored provider whose
 * door carries read-before-write, with a lookalike host treated as a stranger. Every Datadog host in this file reads
 * the synthetic `ap1` site rather than the install's own.
 */
import { describe, expect, it } from "vitest";

import { classifyShotTarget } from "../../../../../../cli/commands/browser/shotCore.js";
import { unwrap } from "../../../../../../lib/result.js";

describe("classifyShotTarget", () => {
  it("allows a doorless address", () => {
    expect(unwrap(classifyShotTarget({ url: "https://staging.example.invalid/customers" }))).toBe(null);
  });

  it("allows Datadog, which is registered with no door", () => {
    expect(unwrap(classifyShotTarget({ url: "https://ap1.datadoghq.com/metric/explorer" }))).toBe(null);
  });

  // A screenshot is a read, and every doored platform in the register is
  // `read-before-write`, so a door alone no longer refuses one. These four are what that ruling changed.
  it("allows GitHub, whose door carries read-before-write", () => {
    expect(unwrap(classifyShotTarget({ url: "https://github.com/o/r/pull/1" }))).toBe(null);
  });

  it("allows a doored provider's subdomain too", () => {
    expect(unwrap(classifyShotTarget({ url: "https://acme.slack.com/archives/C1" }))).toBe(null);
  });

  it("allows Vanta, which is the platform the ruling was about", () => {
    expect(unwrap(classifyShotTarget({ url: "https://app.vanta.com/c/acme/policies" }))).toBe(null);
  });

  it("allows the Vanta policy editor, the page the write lane opens", () => {
    expect(unwrap(classifyShotTarget({ url: "https://app.vanta.com/c/acme/policies/some-policy/edit" }))).toBe(null);
  });

  it("treats a lookalike host as a stranger rather than the doored provider", () => {
    expect(unwrap(classifyShotTarget({ url: "https://github.com.example.invalid/x" }))).toBe(null);
  });
});
