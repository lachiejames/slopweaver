import { describe, expect, it } from "vitest";

import { isScannablePath, scanPrivateBrowserProfile } from "../../../devLint/noPrivateBrowserProfile.js";

const scan = ({ content }: { content: string }): readonly string[] =>
  scanPrivateBrowserProfile({ content, path: "src/x.ts" }).map((hit) => hit.message);

describe("scanPrivateBrowserProfile — what it catches", () => {
  it("catches a persistent-context launch, which is the shape all four retired lanes had", () => {
    expect(scan({ content: "await chromium.launchPersistentContext(dir, {});" })[0]).toContain(
      "profile directory of its own",
    );
  });

  it("catches it however the profile is spelled, since the argument is what matters", () => {
    expect(scan({ content: "await chromium.launchPersistentContext(profileDir, { headless: false });" }).length).toBe(
      1,
    );
    expect(scan({ content: 'const c = await chromium.launchPersistentContext("/tmp/p");' }).length).toBe(1);
  });

  it("catches a plain launch or a CDP attach that names a profile directory", () => {
    expect(scan({ content: "await chromium.launch({ userDataDir: dir });" }).length).toBe(1);
    expect(scan({ content: "await chromium.connectOverCDP(url, { userDataDir: profileDir });" }).length).toBe(1);
  });

  it("catches puppeteer and firefox too, so the ban is on the shape not on one driver", () => {
    expect(scan({ content: "await puppeteer.launchPersistentContext(d, {});" }).length).toBe(1);
    expect(scan({ content: "await firefox.launchPersistentContext(d, {});" }).length).toBe(1);
  });

  it("catches a profile directory or a debugging port passed as an argument", () => {
    expect(scan({ content: 'const args = ["--user-data-dir=/tmp/p"];' })[0]).toContain("names a browser profile");
    expect(scan({ content: "const args = ['--remote-debugging-port=9222'];" })[0]).toContain("expose a debugging");
  });

  it("reports the offending line, so a reader lands on it", () => {
    const hits = scanPrivateBrowserProfile({
      content: "a\nb\nawait chromium.launchPersistentContext(dir, {});",
      path: "src/x.ts",
    });
    expect(hits[0]!.line).toBe(3);
  });

  it("reports one hit per line, not one per pattern", () => {
    expect(scan({ content: 'chromium.launchPersistentContext(d, { args: ["--user-data-dir=/p"] });' }).length).toBe(1);
  });

  it("names Playwright as FINE in every message, because the ruling asked for it", () => {
    const message = scan({ content: "chromium.launchPersistentContext(d, {});" })[0]!;
    expect(message).toContain("Playwright itself is FINE");
    expect(message).toContain("extension relay");
  });
});

describe("scanPrivateBrowserProfile — what it deliberately allows", () => {
  it("ALLOWS a bare Playwright import, which the owner's ruling asked for rather than banned", () => {
    // The first cut of this gate failed these. Playwright is named as a thing that should point at
    // the owner's real browser, through a single command.
    expect(scan({ content: 'import { chromium } from "playwright";' })).toEqual([]);
    expect(scan({ content: 'const { chromium } = await import("playwright");' })).toEqual([]);
  });

  it("ALLOWS the extension relay, which resolves to the owner's own default profile", () => {
    expect(scan({ content: "const browser = await connectToExtensionRelay();" })).toEqual([]);
  });

  it("ALLOWS a launch that names no profile at all", () => {
    expect(scan({ content: "await chromium.launch();" })).toEqual([]);
  });

  it("allows PROSE naming the flags, which is how the ruling itself has to be written down", () => {
    // Measured: without the quote requirement this gate's first run failed three files whose only offence
    // was a doc comment explaining that the flag does not work — including its own.
    expect(scan({ content: " * Chrome ignores --remote-debugging-port on its default profile." })).toEqual([]);
    expect(scan({ content: " * a second `--user-data-dir` is the thing being banned." })).toEqual([]);
  });

  it("allows a word that merely contains a driver's name", () => {
    expect(scan({ content: 'import { play } from "./playwrightish.js";' })).toEqual([]);
  });

  it("allows an unrelated launch", () => {
    expect(scan({ content: "await rocket.launch();" })).toEqual([]);
  });

  it("still catches the four retired lanes' own line, which is the regression that matters", () => {
    // Verbatim from the deleted `src/atlas/slackApi/drivenBrowser.ts`.
    expect(scan({ content: "await chromium.launchPersistentContext(profileDir, {" }).length).toBe(1);
  });

  it("catches a browser's own executable written out, which is a launch with no profile behind it", () => {
    expect(
      scan({ content: 'spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args);' })[0],
    ).toContain("names no profile");
    expect(scan({ content: 'const bin = "/usr/bin/google-chrome";' }).length).toBe(1);
  });

  it("allows a ps fixture that OBSERVES a running browser, because reading one is not launching one", () => {
    // Verbatim from `src/__tests__/unit/live/machine/capacity/parseCommRows.test.ts`, which reads `ps` output.
    expect(
      scan({
        content:
          '{ comm: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome Helper (Renderer)", pid: 200 },',
      }),
    ).toEqual([]);
  });

  it("finds nothing in an empty file", () => {
    expect(scan({ content: "" })).toEqual([]);
  });
});

describe("isScannablePath", () => {
  it("scans the source trees", () => {
    expect(isScannablePath({ path: "src/outbound/github/chromeSession.ts" })).toBe(true);
    expect(isScannablePath({ path: "hooks/pretooluse-admit.ts" })).toBe(true);
  });

  it("skips its own files, so the gate cannot fail on the patterns it is made of", () => {
    expect(isScannablePath({ path: "src/devLint/noPrivateBrowserProfile.ts" })).toBe(false);
  });

  it("skips a file outside the source trees", () => {
    expect(isScannablePath({ path: "docs/browser-route.md" })).toBe(false);
  });
});
