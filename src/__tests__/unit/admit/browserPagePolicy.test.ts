import { describe, expect, it } from "vitest";

import {
  type BrowserPageRestriction,
  resolveBrowserPagePolicy,
  restrictionCoversUrl,
} from "../../../admit/browserPagePolicy.js";

const JUMPCLOUD = "https://console.jumpcloud.com/#/users";
const DATADOG = "https://app.datadoghq.com/monitors";

/** One rule to test the matcher against; every field is what a real register row would carry. */
function rule({ over = {} }: { over?: Partial<BrowserPageRestriction> } = {}): BrowserPageRestriction {
  return {
    authority: "owner ruling 241-4, 12 Sep 2026",
    id: "settings-read-only",
    match: "subtree",
    origin: "https://app.example.com",
    path: "/settings",
    policy: "refuse-every-write",
    ...over,
  };
}

describe("resolving what one address may be driven to do", () => {
  it("refuses a host the register does not name, and names no page rule for it", () => {
    const resolved = resolveBrowserPagePolicy({ url: "https://admin.example.invalid/settings" });
    expect(resolved.policy).toBe("refuse-every-write");
    expect(resolved.provider).toBe(null);
    expect(resolved.pageRuleId).toBe(null);
    expect(resolved.pageRuleAuthority).toBe(null);
  });

  it("refuses an address with no host at all, because there is nothing a policy could attach to", () => {
    const resolved = resolveBrowserPagePolicy({ url: "about:blank" });
    expect(resolved.policy).toBe("refuse-every-write");
    expect(resolved.provider).toBe(null);
  });

  it("gives the JumpCloud console the refusing policy off its own row, with no page rule to attribute it to", () => {
    const resolved = resolveBrowserPagePolicy({ url: JUMPCLOUD });
    expect(resolved.provider).toBe("JumpCloud");
    expect(resolved.policy).toBe("refuse-every-write");
    // The register refuses JumpCloud at the HOST level, so the decision is the row's and not a page rule's.
    // A reader who saw an id here would go looking for a rule that does not exist.
    expect(resolved.pageRuleId).toBe(null);
  });

  it("leaves a registered platform that declares no page rules on its own row", () => {
    const resolved = resolveBrowserPagePolicy({ url: DATADOG });
    expect(resolved.provider).toBe("Datadog");
    expect(resolved.pageRuleId).toBe(null);
    expect(resolved.pageRuleAuthority).toBe(null);
  });
});

describe("the page-rule matcher's segment boundary", () => {
  it("covers the rule's own path", () => {
    expect(restrictionCoversUrl({ restriction: rule(), url: new URL("https://app.example.com/settings") })).toBe(true);
  });

  it("covers a page under it", () => {
    expect(
      restrictionCoversUrl({ restriction: rule(), url: new URL("https://app.example.com/settings/members") }),
    ).toBe(true);
  });

  it("does NOT cover a sibling that merely starts with the same letters", () => {
    // The whole reason `subtree` is a segment match rather than a prefix: `/settings-export` is a different
    // page, and a prefix rule would have silently refused every write on it.
    expect(restrictionCoversUrl({ restriction: rule(), url: new URL("https://app.example.com/settings-export") })).toBe(
      false,
    );
  });

  it("ignores a trailing slash, so one page is not two rules", () => {
    expect(restrictionCoversUrl({ restriction: rule(), url: new URL("https://app.example.com/settings/") })).toBe(true);
  });

  it("does not reach across origins", () => {
    expect(restrictionCoversUrl({ restriction: rule(), url: new URL("https://other.example.com/settings") })).toBe(
      false,
    );
  });

  it("does not reach across ports, because the origin carries one", () => {
    expect(restrictionCoversUrl({ restriction: rule(), url: new URL("https://app.example.com:8443/settings") })).toBe(
      false,
    );
  });

  it("matches only the one page under `exact`", () => {
    const exact = rule({ over: { match: "exact" } });
    expect(restrictionCoversUrl({ restriction: exact, url: new URL("https://app.example.com/settings") })).toBe(true);
    expect(restrictionCoversUrl({ restriction: exact, url: new URL("https://app.example.com/settings/members") })).toBe(
      false,
    );
  });

  it("reads neither query nor fragment, so adding one cannot escape a rule", () => {
    expect(
      restrictionCoversUrl({ restriction: rule(), url: new URL("https://app.example.com/settings?tab=billing#x") }),
    ).toBe(true);
  });
});
