/**
 * The `local-page` destination of `proposal publish`, run for real over a recording store write: which slug a
 * publish writes, that the page and its media reach the store together and nothing lands on disk, and that a dry run
 * or a refusal asks the store for nothing and reports no address.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import type { PublishTarget } from "../../../../../cli/commands/proposal/publishCore.js";
import { localProposalSlug, publishLocalProposal } from "../../../../../cli/commands/proposal/publishLocal.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { PROPOSAL_DESTINATION_SCHEMA_VERSION } from "../../../../../outbound/proposal/destination.js";
import { localPageMedia } from "../../../../../outbound/proposal/localPage.js";
import { pagePath } from "../../../../../pages/publish.js";
import { localPagePublisher, publisherWith, recordingWriter, refusingWriter } from "../../../../pagePublisherFake.js";

const CREATE: PublishTarget = {
  destination: { kind: "local-page", schemaVersion: PROPOSAL_DESTINATION_SCHEMA_VERSION },
  kind: "create",
};
const NOW_ISO = "2026-08-22T02:00:00.000Z";

const minted: string[] = [];
afterEach(() => {
  for (const dir of minted.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway directory, removed after each test. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-proposal-local-"));
  minted.push(dir);
  return dir;
}

/** One publish with recording sinks; every field not given takes the ordinary first-publish value. */
async function publish(over: Partial<Parameters<typeof publishLocalProposal>[0]> & { home: string }): Promise<{
  outcome: Awaited<ReturnType<typeof publishLocalProposal>>;
  out: string[];
  err: string[];
}> {
  const out: string[] = [];
  const err: string[] = [];
  const outcome = await publishLocalProposal({
    dryRun: false,
    icon: undefined,
    intakeId: "a-brief",
    markdown: "## Why\n\nBecause.",
    mediaBase: over.home,
    nowIso: NOW_ISO,
    publishPage: localPagePublisher,
    target: CREATE,
    title: "A plan",
    ...over,
    err: (line) => err.push(line),
    out: (line) => out.push(line),
  });
  return { err, out, outcome };
}

describe("localProposalSlug", () => {
  it("re-publishes to the slug the intake recorded", () => {
    const target: PublishTarget = {
      address: { id: "proposal-old", provider: "local" },
      destination: CREATE.destination,
      kind: "update",
    };
    expect(localProposalSlug({ intakeId: "a-brief", markdown: "m", target, title: "T" })).toBe("proposal-old");
  });

  it("keys a first publish with an intake on that intake", () => {
    expect(localProposalSlug({ intakeId: "a-brief", markdown: "m", target: CREATE, title: "T" })).toBe(
      "proposal-a-brief",
    );
  });

  it("derives a first publish with no intake from the title and the bytes", () => {
    expect(localProposalSlug({ intakeId: undefined, markdown: "m", target: CREATE, title: "T" })).toMatch(
      /^proposal-t-[0-9a-f]{12}$/,
    );
  });
});

describe("publishLocalProposal", () => {
  it("writes the page into the store alone and reports its provider-tagged address", async () => {
    const home = scratch();
    const { writer, written } = recordingWriter();
    const { outcome, out } = await publish({ home, publishPage: publisherWith({ writer }) });
    const url = pathToFileURL(pagePath({ home, slug: "proposal-a-brief" })).href;
    expect(outcome).toEqual({ address: { id: "proposal-a-brief", provider: "local", url }, code: EXIT_OK });
    expect(out).toEqual(["published local page proposal-a-brief", url]);
    expect(written.map((page) => page.slug)).toEqual(["proposal-a-brief"]);
    expect(written[0]!.document).toContain("<h1>A plan</h1>\n<h2>Why</h2>\n<p>Because.</p>");
    expect(existsSync(join(home, "pages"))).toBe(false);
  });

  it("stores a media placeholder's bytes beside the page under the name the page links", async () => {
    const home = scratch();
    const drafts = scratch();
    mkdirSync(join(drafts, "shots"));
    writeFileSync(join(drafts, "shots", "hero.png"), "PNGBYTES");
    const markdown = "![Hero](file:./shots/hero.png)";
    const relative = localPageMedia({ markdown }).copies[0]!.relative;
    const { writer, written } = recordingWriter();
    const { outcome } = await publish({ home, markdown, mediaBase: drafts, publishPage: publisherWith({ writer }) });
    expect(outcome.code).toBe(EXIT_OK);
    expect(written[0]!.assets.map((asset) => [asset.relativePath, asset.bytes.toString("utf8")])).toEqual([
      [relative, "PNGBYTES"],
    ]);
    expect(written[0]!.document).toContain(`<img src="${relative}" alt="Hero" />`);
    expect(existsSync(join(home, "pages"))).toBe(false);
  });

  it("reports no address when the store write fails, and says why", async () => {
    const home = scratch();
    const publishPage = publisherWith({ writer: refusingWriter({ line: "the store is down" }) });
    const { outcome, out, err } = await publish({ home, publishPage });
    expect(outcome).toEqual({ address: undefined, code: EXIT_ERROR });
    expect(out).toEqual([]);
    expect(err.at(-1)).toBe("the store is down");
  });

  it("refuses before the store is asked when a media file is missing", async () => {
    const home = scratch();
    const markdown = "![Hero](file:./gone.png)";
    const relative = localPageMedia({ markdown }).copies[0]!.relative;
    const { writer, written } = recordingWriter();
    const { outcome, err } = await publish({ home, markdown, publishPage: publisherWith({ writer }) });
    expect(outcome).toEqual({ address: undefined, code: EXIT_ERROR });
    expect(err).toEqual([
      `the page loads ${relative}, and ${relative} is not at ${join(home, "gone.png")}; nothing was published`,
    ]);
    expect(written).toEqual([]);
  });

  it("writes nothing on a dry run and reports no address", async () => {
    const home = scratch();
    const { writer, written } = recordingWriter();
    const { outcome, out } = await publish({ dryRun: true, home, publishPage: publisherWith({ writer }) });
    expect(outcome).toEqual({ address: undefined, code: EXIT_OK });
    expect(out).toEqual(["would publish local page proposal-a-brief into the store (0 media file(s))"]);
    expect(written).toEqual([]);
  });

  it("refuses an untitled publish rather than writing a page nobody can tell apart", async () => {
    const home = scratch();
    const { outcome, err } = await publish({ home, title: undefined });
    expect(outcome).toEqual({ address: undefined, code: EXIT_USAGE });
    expect(err).toEqual(['--title "<text>" is required to publish to a local-page. Nothing was published.']);
  });

  it("refuses a blank title exactly as a missing one, writing nothing", async () => {
    const home = scratch();
    const { outcome, err } = await publish({ home, title: " " });
    expect(outcome).toEqual({ address: undefined, code: EXIT_USAGE });
    expect(err).toEqual(['--title "<text>" is required to publish to a local-page. Nothing was published.']);
  });

  it("refuses a recorded slug the page door would not accept", async () => {
    const home = scratch();
    const target: PublishTarget = {
      address: { id: "../escape", provider: "local" },
      destination: CREATE.destination,
      kind: "update",
    };
    const { outcome, err } = await publish({ home, target });
    expect(outcome).toEqual({ address: undefined, code: EXIT_ERROR });
    expect(err).toEqual(['"../escape" cannot be a local page slug. Nothing was published.']);
  });
});
