/*
 * `proposal status`: a status-changed event appended and reported, `decided` and `rejected` refused as targets
 * only `decide` may reach, `--why` required, an unregistered slug exiting EXPECTED_EMPTY, the implementation
 * statuses of the richer enum accepted, and `--date` stored as the occurrence time a drift check compares against.
 */
import { describe, expect, it } from "vitest";

import { runProposalStatus } from "../../../../../../cli/commands/proposal/registerRun.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../../lib/result.js";
import { loadRegisterEntry, readRegisterJournal } from "../../../../../../outbound/proposal/register/store.js";
import { argv, harness, seedRegistered, tempHome, useRegisterHomes } from "./harness.js";

useRegisterHomes();

describe("runProposalStatus", () => {
  it("appends a status-changed event and reports the new status", () => {
    const home = tempHome();
    seedRegistered({ home, slug: "a-slug" });
    const h = harness();
    const code = runProposalStatus({
      argv: argv({ rest: ["a-slug", "shared", "--why", "posted to #dev", "--home", home], verb: "status" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(unwrap(loadRegisterEntry({ home, slug: "a-slug" }))!.status).toBe("shared");
    expect(h.out[0]).toBe("a-slug → shared");
  });

  it("refuses decided as a target status — that is decide's job", () => {
    const h = harness();
    const code = runProposalStatus({
      argv: argv({ rest: ["a-slug", "decided", "--why", "x", "--home", tempHome()], verb: "status" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_USAGE);
  });

  it("refuses without --why", () => {
    const home = tempHome();
    seedRegistered({ home, slug: "a-slug" });
    const h = harness();
    const code = runProposalStatus({
      argv: argv({ rest: ["a-slug", "shared", "--home", home], verb: "status" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_USAGE);
  });

  it("refuses with EXPECTED_EMPTY for an unregistered slug", () => {
    const h = harness();
    const code = runProposalStatus({
      argv: argv({ rest: ["nope", "shared", "--why", "x", "--home", tempHome()], verb: "status" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
  });
});

describe("runProposalStatus over the richer enum", () => {
  it("accepts the implementation statuses the owner asked for", () => {
    const home = tempHome();
    seedRegistered({ home, slug: "a-slug" });
    const h = harness();
    const code = runProposalStatus({
      argv: argv({
        rest: ["a-slug", "partially-implemented", "--why", "half of it landed", "--home", home],
        verb: "status",
      }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(unwrap(loadRegisterEntry({ home, slug: "a-slug" }))!.status).toBe("partially-implemented");
  });

  it("still refuses rejected, which only `decide` may reach", () => {
    const h = harness();
    const code = runProposalStatus({
      argv: argv({ rest: ["a-slug", "rejected", "--why", "no"], verb: "status" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_USAGE);
    expect(h.err[0]).toContain('"rejected" is not a status this verb may set');
  });

  it("stores --date as the occurrence time a drift check compares against", () => {
    const home = tempHome();
    seedRegistered({ home, slug: "a-slug" });
    const h = harness();
    runProposalStatus({
      argv: argv({
        rest: ["a-slug", "implemented", "--why", "shipped in July", "--date", "2026-07-08T07:13:17Z", "--home", home],
        verb: "status",
      }),
      deps: h.deps,
    });
    const events = unwrap(readRegisterJournal({ home, slug: "a-slug" })).events;
    expect(events[1]).toEqual({
      atIso: "2026-08-22T02:00:00.000Z",
      kind: "status-changed",
      occurredIso: "2026-07-08T07:13:17Z",
      status: "implemented",
      why: "shipped in July",
    });
  });
});
