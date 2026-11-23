/**
 * `proposal publish` on an install whose destination is a local page, and the pure helpers that choose a
 * destination's door. The shared fixtures are `./publishRunFixture.ts`; every edge is a plain injected function.
 */
import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import {
  notionPageLocator,
  type PublishTarget,
  publishTargetProvider,
  requirePublishTitle,
} from "../../../../../cli/commands/proposal/publishCore.js";
import { runProposalPublish } from "../../../../../cli/commands/proposal/publishRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../lib/result.js";
import type { ProposalAddress } from "../../../../../outbound/proposal/address.js";
import { PROPOSAL_DESTINATION_SCHEMA_VERSION } from "../../../../../outbound/proposal/destination.js";
import { writeProposalDestination } from "../../../../../outbound/proposal/destinationStore.js";
import { loadIntake, saveIntake } from "../../../../../outbound/proposal/intakeStore.js";
import { ADDRESS, answeredIntake, argv, bareHome, harness, PARENT, takeMintedHomes } from "./publishRunFixture.js";

const LOCAL = { kind: "local-page", schemaVersion: PROPOSAL_DESTINATION_SCHEMA_VERSION } as const;
const NOTION = { kind: "notion-page", parent: PARENT, schemaVersion: PROPOSAL_DESTINATION_SCHEMA_VERSION } as const;
const LINEAR = {
  kind: "linear-document",
  schemaVersion: PROPOSAL_DESTINATION_SCHEMA_VERSION,
  target: { id: "5f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f", kind: "project" },
} as const;
const LOCAL_ADDRESS: ProposalAddress = { id: "proposal-a-brief", provider: "local", url: "file:///p/index.html" };

afterEach(() => {
  for (const dir of takeMintedHomes()) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A state home whose install publishes proposals as local pages. */
function localHome(): string {
  const home = bareHome();
  unwrap(writeProposalDestination({ destination: LOCAL, home }));
  return home;
}

describe("runProposalPublish to a local-page destination", () => {
  it("refuses an untitled publish before reading the draft, naming --title", async () => {
    const h = harness({ address: LOCAL_ADDRESS });
    const code = await runProposalPublish({
      argv: argv({ rest: ["draft.md", "--home", localHome()], verb: "publish" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_USAGE);
    expect(h.published()).toBe(undefined);
    expect(h.err[0]).toContain('--title "<text>" is required to publish to a local-page');
  });

  it("creates at the local destination, handing the door the title and the intake", async () => {
    const home = localHome();
    saveIntake({ home, intake: answeredIntake({ id: "a-brief" }) });
    const h = harness({ address: LOCAL_ADDRESS });
    const code = await runProposalPublish({
      argv: argv({ rest: ["draft.md", "--intake", "a-brief", "--title", "A plan", "--home", home], verb: "publish" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(h.published()!.target).toEqual({ destination: LOCAL, kind: "create" });
    expect(h.published()!.title).toBe("A plan");
    expect(h.published()!.intakeId).toBe("a-brief");
  });

  it("records the local address on the intake, so the next publish replaces the same page", async () => {
    const home = localHome();
    saveIntake({ home, intake: answeredIntake({ id: "a-brief" }) });
    await runProposalPublish({
      argv: argv({ rest: ["draft.md", "--intake", "a-brief", "--title", "A plan", "--home", home], verb: "publish" }),
      deps: harness({ address: LOCAL_ADDRESS }).deps,
    });
    expect(unwrap(loadIntake({ home, id: "a-brief" })).address).toEqual(LOCAL_ADDRESS);
    const again = harness({ address: LOCAL_ADDRESS });
    await runProposalPublish({
      argv: argv({ rest: ["draft.md", "--intake", "a-brief", "--title", "A plan", "--home", home], verb: "publish" }),
      deps: again.deps,
    });
    expect(again.published()!.target).toEqual({ address: LOCAL_ADDRESS, destination: LOCAL, kind: "update" });
  });

  it("refuses to re-publish a Notion-published intake to the local destination", async () => {
    const home = localHome();
    saveIntake({ home, intake: { ...answeredIntake({ id: "a-brief" }), address: ADDRESS, status: "published" } });
    const h = harness({ address: LOCAL_ADDRESS });
    const code = await runProposalPublish({
      argv: argv({ rest: ["draft.md", "--intake", "a-brief", "--title", "A plan", "--home", home], verb: "publish" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(h.published()).toBe(undefined);
    expect(h.err[0]).toContain("this proposal was published to notion, but the install now publishes to local");
  });
});

describe("runProposalPublish to a linear-document destination", () => {
  it("refuses an untitled publish before reading the draft, naming --title", async () => {
    const home = bareHome();
    unwrap(writeProposalDestination({ destination: LINEAR, home }));
    const h = harness({ address: LOCAL_ADDRESS });
    const code = await runProposalPublish({
      argv: argv({ rest: ["draft.md", "--home", home], verb: "publish" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_USAGE);
    expect(h.published()).toBe(undefined);
    expect(h.err[0]).toContain('--title "<text>" is required to publish to a linear-document');
  });

  it("creates at the Linear destination, which the production publish routes to the linear provider", async () => {
    const home = bareHome();
    unwrap(writeProposalDestination({ destination: LINEAR, home }));
    const h = harness({ address: LOCAL_ADDRESS });
    await runProposalPublish({
      argv: argv({ rest: ["draft.md", "--title", "A plan", "--home", home], verb: "publish" }),
      deps: h.deps,
    });
    expect(h.published()!.target).toEqual({ destination: LINEAR, kind: "create" });
    expect(publishTargetProvider({ target: h.published()!.target })).toBe("linear");
  });
});

describe("publishTargetProvider", () => {
  it("is the destination's provider on a create", () => {
    expect(publishTargetProvider({ target: { destination: LOCAL, kind: "create" } })).toBe("local");
    expect(publishTargetProvider({ target: { destination: NOTION, kind: "create" } })).toBe("notion");
  });

  it("is the recorded address's provider on an update", () => {
    expect(publishTargetProvider({ target: { address: LOCAL_ADDRESS, destination: LOCAL, kind: "update" } })).toBe(
      "local",
    );
  });
});

describe("notionPageLocator", () => {
  it("creates under the destination's parent", () => {
    expect(notionPageLocator({ target: { destination: NOTION, kind: "create" } })).toEqual({
      flag: "--parent",
      value: PARENT,
      verb: "create",
    });
  });

  it("updates the recorded page", () => {
    expect(notionPageLocator({ target: { address: ADDRESS, destination: NOTION, kind: "update" } })).toEqual({
      flag: "--page",
      value: ADDRESS.id,
      verb: "update",
    });
  });

  it("throws on a local create, which reaching the Notion door at all would be a dispatch defect", () => {
    const target: PublishTarget = { destination: LOCAL, kind: "create" };
    expect(() => notionPageLocator({ target })).toThrow("a local-page destination was dispatched to the Notion door");
  });
});

describe("requirePublishTitle", () => {
  it("refuses a local page with no title", () => {
    expect(requirePublishTitle({ destination: LOCAL, title: undefined })._unsafeUnwrapErr().code).toBe(
      "PUBLISH_TITLE_REQUIRED",
    );
  });

  it("refuses a local page whose title is empty or only whitespace", () => {
    expect(requirePublishTitle({ destination: LOCAL, title: "" })._unsafeUnwrapErr().code).toBe(
      "PUBLISH_TITLE_REQUIRED",
    );
    expect(requirePublishTitle({ destination: LOCAL, title: "  " })._unsafeUnwrapErr().code).toBe(
      "PUBLISH_TITLE_REQUIRED",
    );
  });

  it("lets a local page with a title, and a Notion page without one, through", () => {
    expect(requirePublishTitle({ destination: LOCAL, title: "T" }).isOk()).toBe(true);
    expect(requirePublishTitle({ destination: NOTION, title: undefined }).isOk()).toBe(true);
  });
});
