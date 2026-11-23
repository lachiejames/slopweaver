/**
 * A SYNTHETIC reproduction of the incident this feature exists to fix — not a frozen `turn freeze` replay.
 *
 * The handover doc that requested this work named a real fixture (`cap-refusal-second-instance` or similar)
 * holding a dogfood answer that listed `"merged, 8: 15632, 15717, 15718, 15721, 15723, 15724, 15897, 15900"`
 * as bare digits in #dev-alerts. That fixture does not exist in this checkout: `src/__tests__/fixtures/
 * replay/` holds only `dispatch-orphan-28aug/` and `owner-retag-28aug/`, and this repository never captured
 * the ask-lifecycle rows/brief/dispatch/answer set `slopweaver turn freeze` needs for that dogfood turn.
 * Fabricating one would mean hand-writing what freeze's own redaction/allowlist machinery is supposed to
 * derive from real captured files — worse than admitting the gap. If that turn's real files ever surface,
 * `slopweaver turn freeze --through <kind>` is the right way to add the genuine fixture this test stands in
 * for.
 *
 * What this DOES prove, through the real door rather than a fake: `../../../cli/bareRefContext.ts`'s
 * `bareRefContext` reads a REAL git remote (via `resolveRepository`, spawned against a throwaway temp repo —
 * never this checkout's own, so the test carries no private identifier) and the resolved context correctly
 * linkifies the exact reported text via `../../../outbound/linkify/bareRefs.ts`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { bareRefContext } from "../../../cli/bareRefContext.js";
import { linkifyMarkdown } from "../../../outbound/linkify/bareRefs.js";
import { gitInTemp } from "../../tempGitRepo.js";

/** The dogfood tag-3 answer's own words, verbatim from the owner's ruling. */
const INCIDENT_TEXT =
  "merged, 8: 15632, 15717, 15718, 15721, 15723, 15724, 15897, 15900. still open: 15895 targeting release. " +
  "renovate's own #15586 closed it. #15489 and #15508 were already open.";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway checkout with a KNOWN, non-private remote — never this repo's own `origin`. */
function tempRepoWithRemote(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-bare-ref-incident-"));
  fixtureDirs.push(dir);
  gitInTemp({ args: ["init", "-b", "main"], cwd: dir });
  gitInTemp({ args: ["remote", "add", "origin", "https://github.com/acme-test/widget.git"], cwd: dir });
  return dir;
}

describe("the tag-3 incident, reproduced through the real bare-ref context", () => {
  it("resolves the checkout's own repo from its real git remote", () => {
    const dir = tempRepoWithRemote();
    const home = mkdtempSync(join(tmpdir(), "slopweaver-bare-ref-incident-home-"));
    fixtureDirs.push(home);
    const context = bareRefContext({ cwd: dir, home });
    expect(context.repos).toEqual([{ owner: "acme-test", repo: "widget" }]);
  });

  it("linkifies every reference in the exact incident text once the repo resolves", () => {
    const dir = tempRepoWithRemote();
    const home = mkdtempSync(join(tmpdir(), "slopweaver-bare-ref-incident-home-"));
    fixtureDirs.push(home);
    const context = bareRefContext({ cwd: dir, home });
    const result = linkifyMarkdown({ context, text: INCIDENT_TEXT });
    expect(result.unresolved.length).toBe(0);
    expect(result.text).toBe(
      "merged, 8: [#15632](https://github.com/acme-test/widget/issues/15632), " +
        "[#15717](https://github.com/acme-test/widget/issues/15717), " +
        "[#15718](https://github.com/acme-test/widget/issues/15718), " +
        "[#15721](https://github.com/acme-test/widget/issues/15721), " +
        "[#15723](https://github.com/acme-test/widget/issues/15723), " +
        "[#15724](https://github.com/acme-test/widget/issues/15724), " +
        "[#15897](https://github.com/acme-test/widget/issues/15897), " +
        "[#15900](https://github.com/acme-test/widget/issues/15900). still open: " +
        "[#15895](https://github.com/acme-test/widget/issues/15895) targeting release. " +
        "renovate's own [#15586](https://github.com/acme-test/widget/issues/15586) closed it. " +
        "[#15489](https://github.com/acme-test/widget/issues/15489) and " +
        "[#15508](https://github.com/acme-test/widget/issues/15508) were already open.",
    );
  });

  it("refuses instead of guessing with NO repo context — the incident's shape stays caught, never silently guessed", () => {
    const noRemoteHome = mkdtempSync(join(tmpdir(), "slopweaver-bare-ref-incident-home-"));
    fixtureDirs.push(noRemoteHome);
    const noRemoteDir = mkdtempSync(join(tmpdir(), "slopweaver-bare-ref-incident-no-remote-"));
    fixtureDirs.push(noRemoteDir);
    gitInTemp({ args: ["init", "-b", "main"], cwd: noRemoteDir });
    const context = bareRefContext({ cwd: noRemoteDir, home: noRemoteHome });
    expect(context.repos).toEqual([]);
    const result = linkifyMarkdown({ context, text: INCIDENT_TEXT });
    expect(result.unresolved.length).toBe(12);
    expect(result.text).toBe(INCIDENT_TEXT);
  });
});
