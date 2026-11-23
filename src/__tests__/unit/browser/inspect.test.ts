/**
 * `browser inspect`, the console voice's one look at one page: which addresses it may open, the bounded answer
 * it prints, and the runner's refusals — each decided before the browser is touched. `browser cookies`, split out
 * of the same shell, is held to its refusal on a home with no recorded profile.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registeredWritePlatforms } from "../../../admit/browserSurface.js";
import {
  INSPECT_URL_MAX_CHARS,
  InspectErrors,
  inspectAnswer,
  landingProblem,
  resolveInspectUrl,
  USER_CONTENT_HOSTS,
} from "../../../browser/inspect.js";
import { runCookies } from "../../../cli/commands/browser/cookiesRun.js";
import { runInspect } from "../../../cli/commands/browser/inspectRun.js";
import { parseBrowserArgs } from "../../../cli/commands/browser/profileCore.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { memoryRecordedProfilePort } from "../../recordedProfileFixture.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "browser-inspect-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("resolveInspectUrl", () => {
  it("takes a registered platform's page", () => {
    const url = "https://github.com/lachiejames/slopweaver/pull/1";
    expect(unwrap(resolveInspectUrl({ url }))).toBe(url);
  });

  it("refuses an unregistered host, naming what it does open", () => {
    const failure = unwrapErr(resolveInspectUrl({ url: "https://evil.example/?q=secret" }));
    expect(failure).toEqual(InspectErrors.unregistered({ host: "evil.example" }));
    expect(failure.message).toContain(`it opens ${registeredWritePlatforms().join(", ")}`);
  });

  it("refuses a missing, relative, non-web, credentialed or oversized address, by code", () => {
    const codeOf = ({ url }: { url: string | undefined }): string => unwrapErr(resolveInspectUrl({ url })).code;
    expect(codeOf({ url: undefined })).toBe("URL_MISSING");
    expect(codeOf({ url: "github.com/x" })).toBe("URL_NOT_ABSOLUTE");
    expect(codeOf({ url: "ftp://github.com/x" })).toBe("URL_NOT_WEB");
    expect(codeOf({ url: "https://me:pw@github.com/x" })).toBe("URL_CREDENTIALS");
    expect(codeOf({ url: `https://github.com/${"a".repeat(INSPECT_URL_MAX_CHARS)}` })).toBe("URL_TOO_LONG");
    expect(unwrapErr(resolveInspectUrl({ url: "ftp://github.com/x" })).message).toBe(
      "--url takes an http or https address, got 'ftp:'",
    );
  });
});

describe("inspectAnswer", () => {
  const base = { requestedUrl: "https://github.com/o/r/pull/1", title: "PR 1", url: "https://github.com/o/r/pull/1" };

  it("passes a small snapshot whole and says the tab closed", () => {
    const answer = inspectAnswer({
      ...base,
      cleanup: [],
      elements: "- heading: PR 1",
      elementsBytes: 15,
      maxBytes: 20_480,
      outlineCut: false,
    });
    expect(answer.elements).toBe("- heading: PR 1");
    expect(answer.truncated).toBe(false);
    expect(answer.outlineCut).toBe(false);
    expect(answer.closed).toBe(true);
    expect(answer.note.startsWith("The page was opened in the owner's Chrome, read, and its tab closed again.")).toBe(
      true,
    );
  });

  it("fits a large snapshot inside the ceiling, says it cut, and says when the tab may be open", () => {
    const elements = "\u0002".repeat(30_000);
    const answer = inspectAnswer({
      ...base,
      cleanup: ["close timed out"],
      elements,
      elementsBytes: 30_000,
      maxBytes: 4096,
      outlineCut: false,
    });
    expect(Buffer.byteLength(JSON.stringify(answer), "utf8")).toBeLessThanOrEqual(4096);
    expect(answer.truncated).toBe(true);
    expect(answer.closed).toBe(false);
    expect(answer.note.startsWith("The page was read, but whether its tab closed is unknown")).toBe(true);
  });

  it("does not call an outline shorter than the raw snapshot a truncation, and carries the outline's own cut", () => {
    const answer = inspectAnswer({
      ...base,
      cleanup: [],
      elements: "- heading: PR 1",
      elementsBytes: 900_000,
      maxBytes: 20_480,
      outlineCut: true,
    });
    expect(answer.elements).toBe("- heading: PR 1");
    expect(answer.truncated).toBe(false);
    expect(answer.outlineCut).toBe(true);
  });

  it("keeps the envelope under the ceiling when every field but the snapshot is hostile", () => {
    const answer = inspectAnswer({
      cleanup: Array.from({ length: 10 }, () => "\u0003".repeat(5000)),
      elements: "x",
      elementsBytes: 1,
      maxBytes: 20_480,
      outlineCut: false,
      requestedUrl: `https://github.com/${"\u0004".repeat(5000)}`,
      title: "\u0005".repeat(5000),
      url: `https://github.com/${"\u0006".repeat(5000)}`,
    });
    expect(Buffer.byteLength(JSON.stringify(answer), "utf8")).toBeLessThanOrEqual(20_480);
    expect(answer.cleanup.length).toBe(3);
    expect(answer.elements).toBe("x");
  });
});

describe("inspectAnswer at the exact edge of its ceiling", () => {
  it("stays inside it when the kept text fills the budget and nothing was cut", () => {
    for (const length of [20_130, 20_141, 20_150]) {
      const answer = inspectAnswer({
        cleanup: [],
        elements: "a".repeat(length),
        elementsBytes: length,
        maxBytes: 20_480,
        outlineCut: false,
        requestedUrl: "https://github.com/o/r/pull/1",
        title: "PR 1",
        url: "https://github.com/o/r/pull/1",
      });
      expect(Buffer.byteLength(JSON.stringify(answer), "utf8")).toBeLessThanOrEqual(20_480);
    }
  });
});

describe("inspectAnswer on a snapshot of control characters", () => {
  it("keeps as much as the ceiling allows rather than collapsing to nothing", () => {
    const answer = inspectAnswer({
      cleanup: [],
      elements: "\u0001".repeat(100_000),
      elementsBytes: 100_000,
      maxBytes: 20_480,
      outlineCut: false,
      requestedUrl: "https://github.com/o/r/pull/1",
      title: "PR 1",
      url: "https://github.com/o/r/pull/1",
    });
    const size = Buffer.byteLength(JSON.stringify(answer), "utf8");
    expect(size).toBeLessThanOrEqual(20_480);
    expect(size).toBeGreaterThan(20_480 - 6);
    expect(answer.truncated).toBe(true);
  });
});

describe("the client refusals", () => {
  it("withhold what the client printed once a page may have loaded", () => {
    expect(InspectErrors.clientFailed({ step: "goto" }).message).toBe(
      "the browser client's goto failed; what it printed is withheld, because once a page has loaded it can carry the page's own text",
    );
    expect(InspectErrors.closeFailed({ count: 2 }).code).toBe("CLOSE_FAILED");
  });
});

describe("the host rules", () => {
  it("refuses a registered platform's user-content host, subdomains included", () => {
    expect(USER_CONTENT_HOSTS.length).toBeGreaterThan(0);
    for (const url of [
      "https://acme.notion.site/page",
      "https://raw.githubusercontent.com/o/r/main/x",
      "https://files.slack-edge.com/x",
    ]) {
      expect(unwrapErr(resolveInspectUrl({ url })).code).toBe("HOST_USER_CONTENT");
    }
    expect(unwrapErr(resolveInspectUrl({ url: "https://acme.notion.site/p" })).message).toBe(
      "acme.notion.site serves what any customer of the platform published, so inspect will not open it",
    );
  });

  it("withholds a page that landed off the register, and passes one that stayed on it", () => {
    expect(landingProblem({ url: "https://github.com/o/r/pull/1" })).toBe(undefined);
    expect(landingProblem({ url: "https://evil.example/?q=x" })).toEqual(
      InspectErrors.landedOff({ url: "https://evil.example/?q=x" }),
    );
    expect(landingProblem({ url: "https://acme.notion.site/p" })!.code).toBe("LANDED_OFF_REGISTER");
    expect(landingProblem({ url: "about:blank" })!.code).toBe("LANDED_OFF_REGISTER");
    expect(landingProblem({ url: "not a url" })!.code).toBe("LANDED_OFF_REGISTER");
  });
});

describe("runInspect", () => {
  it("refuses a bad address as usage without touching the browser", async () => {
    const profiles = memoryRecordedProfilePort();
    expect(await runInspect({ home, profiles, url: "https://evil.example/" })).toBe(EXIT_USAGE);
    expect(await runInspect({ home, profiles, url: undefined })).toBe(EXIT_USAGE);
  });
});

describe("runCookies", () => {
  it("refuses when no Chrome profile is recorded in the store", async () => {
    const options = unwrap(parseBrowserArgs({ rest: ["cookies", "--origin", "https://github.com", "--json"] }));
    expect(await runCookies({ home, options, profiles: memoryRecordedProfilePort() })).toBe(EXIT_ERROR);
  });
});
