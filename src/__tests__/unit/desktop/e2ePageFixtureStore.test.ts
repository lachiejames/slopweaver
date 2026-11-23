/**
 * The fixture page's effectful half over a plain fake publisher and a plain fake store remover: what the publisher is
 * handed, and a publish that answers anything but the planned fixture refused and taken back out of the store. A
 * publish writes nothing on disk, so there is no directory to clean up.
 * deleted-with-code: removeE2ePageFixtureFiles
 */
import { describe, expect, it } from "vitest";

import type { DesktopE2eError } from "../../../desktop/e2eErrors.js";
import { e2ePageFixture } from "../../../desktop/e2eFixture.js";
import { type PublishedE2ePageFixture, publishE2ePageFixture } from "../../../desktop/e2ePageFixtureStore.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../lib/result.js";
import type { PagePublisher } from "../../../pages/publish.js";

const NOW = "2026-11-09T12:00:00.000Z";
const HOME = "/home/acme/.slopweaver";

/** A publisher that answers what `answer` makes of the planned fixture's path and digest. */
function publisherAnswering({
  answer,
}: {
  answer: (args: { path: string; sha: string }) => ReturnType<PagePublisher>;
}): { readonly asked: Parameters<PagePublisher>[0][]; readonly publish: PagePublisher } {
  const asked: Parameters<PagePublisher>[0][] = [];
  const publish: PagePublisher = async (request) => {
    asked.push(request);
    const fixture = unwrap(e2ePageFixture({ home: request.home, nonce: request.slug.slice("desktop-e2e-".length) }));
    return answer({ path: fixture.path, sha: `sha256:${fixture.bodySha256}` });
  };
  return { asked, publish };
}

/** A store remover that keeps which fixtures it was asked to take out. */
function recordingRetire(): {
  readonly retired: string[];
  readonly retire: (request: { fixture: PublishedE2ePageFixture }) => Promise<Result<void, DesktopE2eError>>;
} {
  const retired: string[] = [];
  return {
    retire: async ({ fixture }) => {
      retired.push(fixture.slug);
      return ok(undefined);
    },
    retired,
  };
}

/** A published page answer for a path and a frozen digest. */
function publishedAt({ path, sha }: { path: string; sha: string }): ReturnType<PagePublisher> {
  return Promise.resolve(
    ok({ bytes: 1, frozen: { frozenIso: NOW, key: "k", sha256: sha }, path, url: `file://${path}` }),
  );
}

describe("publishE2ePageFixture", () => {
  it("hands the publisher the fragment under the walk's slug and answers the planned fixture", async () => {
    const { asked, publish } = publisherAnswering({ answer: publishedAt });
    const { retire, retired } = recordingRetire();
    const fixture = unwrap(await publishE2ePageFixture({ home: HOME, nonce: "w1", nowIso: NOW, publish, retire }));
    expect(fixture).toEqual({ ...unwrap(e2ePageFixture({ home: HOME, nonce: "w1" })), frozenAtIso: NOW });
    expect(asked).toEqual([{ fragment: fixture.fragment, home: HOME, nowIso: NOW, slug: "desktop-e2e-w1" }]);
    expect(retired).toEqual([]);
  });

  it("refuses a failed publish, naming its reasons, with nothing in the store to take out", async () => {
    const { publish } = publisherAnswering({ answer: async () => err(["store unreachable", "re-run it"]) });
    const { retire, retired } = recordingRetire();
    const refused = unwrapErr(await publishE2ePageFixture({ home: HOME, nonce: "w1", nowIso: NOW, publish, retire }));
    expect(refused.code).toBe("PAGE_FIXTURE_PUBLISH_FAILED");
    expect(refused.message).toContain("desktop-e2e-w1: store unreachable; re-run it — nothing was launched");
    expect(retired).toEqual([]);
  });

  it("refuses a publish that froze other bytes or named another path, and takes each back out of the store", async () => {
    const otherBytes = publisherAnswering({
      answer: async ({ path }) => publishedAt({ path, sha: `sha256:${"0".repeat(64)}` }),
    });
    const otherPath = publisherAnswering({
      answer: async ({ sha }) => publishedAt({ path: "/elsewhere/index.html", sha }),
    });
    const { retire, retired } = recordingRetire();
    const refusals = [
      unwrapErr(
        await publishE2ePageFixture({ home: HOME, nonce: "w1", nowIso: NOW, publish: otherBytes.publish, retire }),
      ),
      unwrapErr(
        await publishE2ePageFixture({ home: HOME, nonce: "w2", nowIso: NOW, publish: otherPath.publish, retire }),
      ),
    ];
    expect(refusals.map((refusal) => refusal.code)).toEqual([
      "PAGE_FIXTURE_PUBLISH_FAILED",
      "PAGE_FIXTURE_PUBLISH_FAILED",
    ]);
    expect(refusals[0]!.message).toContain("the publish froze other bytes than the planned fixture's");
    expect(refusals[1]!.message).toContain("the publish named /elsewhere/index.html, not the planned");
    expect(retired).toEqual(["desktop-e2e-w1", "desktop-e2e-w2"]);
  });
});
