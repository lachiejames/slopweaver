import { describe, expect, it } from "vitest";

import { planPersonalMarketplace, SLOPWEAVER_MARKETPLACE_ENTRY } from "../../../codexPlugin/marketplacePlan.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const HOME = "/u";
const PATH = "/u/.agents/plugins/marketplace.json";

describe("planPersonalMarketplace", () => {
  it("seeds an absent file with the personal marketplace and slopweaver's local entry alone", () => {
    const plan = unwrap(planPersonalMarketplace({ document: undefined, marketplacePath: PATH, userHome: HOME }));
    expect(plan).toEqual({
      document: { name: "personal", plugins: [SLOPWEAVER_MARKETPLACE_ENTRY] },
      entry: { marketplace: "personal", sourcePath: "/u/plugins/slopweaver" },
      kind: "write",
    });
  });

  it("leaves a document that already carries the local entry unchanged, wherever its source points", () => {
    const document = {
      name: "mine",
      plugins: [{ name: "slopweaver", source: { path: "./elsewhere", source: "local" } }],
    };
    const plan = unwrap(planPersonalMarketplace({ document, marketplacePath: PATH, userHome: HOME }));
    expect(plan).toEqual({ entry: { marketplace: "mine", sourcePath: "/u/elsewhere" }, kind: "unchanged" });
  });

  it("appends to the original document, keeping every other key and entry as it was", () => {
    const other = { extra: true, name: "other", source: { source: "git" } };
    const document = { interface: { displayName: "Mine" }, name: "mine", plugins: [other] };
    const plan = unwrap(planPersonalMarketplace({ document, marketplacePath: PATH, userHome: HOME }));
    expect(plan).toEqual({
      document: { interface: { displayName: "Mine" }, name: "mine", plugins: [other, SLOPWEAVER_MARKETPLACE_ENTRY] },
      entry: { marketplace: "mine", sourcePath: "/u/plugins/slopweaver" },
      kind: "write",
    });
  });

  it("skips a local entry whose source path holds the marketplace file, so a repoint never replaces it", () => {
    const document = {
      name: "mine",
      plugins: [{ name: "slopweaver", source: { path: "./.agents/plugins", source: "local" } }],
    };
    const plan = unwrap(planPersonalMarketplace({ document, marketplacePath: PATH, userHome: HOME }));
    expect(plan).toEqual({
      kind: "skip",
      why: "slopweaver's source path /u/.agents/plugins holds the marketplace file itself",
    });
  });

  it("skips a local entry whose source path is the marketplace file itself", () => {
    const document = {
      name: "mine",
      plugins: [{ name: "slopweaver", source: { path: "./.agents/plugins/marketplace.json", source: "local" } }],
    };
    const plan = unwrap(planPersonalMarketplace({ document, marketplacePath: PATH, userHome: HOME }));
    expect(plan).toEqual({ kind: "skip", why: `slopweaver's source path ${PATH} holds the marketplace file itself` });
  });

  it("never rewrites a slopweaver entry that is not a local source", () => {
    const document = { name: "mine", plugins: [{ name: "slopweaver", source: { source: "git" } }] };
    const plan = unwrap(planPersonalMarketplace({ document, marketplacePath: PATH, userHome: HOME }));
    expect(plan).toEqual({ kind: "skip", why: "marketplace mine's slopweaver is a git source, not a local path" });
  });

  it("refuses a document that is not a marketplace, naming the file", () => {
    const error = unwrapErr(
      planPersonalMarketplace({ document: { plugins: "no" }, marketplacePath: PATH, userHome: HOME }),
    );
    expect([error.code, error.message.includes(PATH)]).toEqual(["MARKETPLACE_UNREADABLE", true]);
  });
});
