/*
 * `proposal show`: an unregistered slug exits EXPECTED_EMPTY, the whole entry as JSON, a missing slug refused, and
 * `--history` — the journal in order under the fold, an undecodable line reported, and the JSON form carrying the
 * fold, the events and the unreadable lines together.
 */
import { appendFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  runProposalDecide,
  runProposalShow,
  runProposalStatus,
} from "../../../../../../cli/commands/proposal/registerRun.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { registerJournalPath } from "../../../../../../outbound/proposal/register/store.js";
import { argv, harness, seedRegistered, tempHome, useRegisterHomes } from "./harness.js";

useRegisterHomes();

describe("runProposalShow", () => {
  it("refuses with EXPECTED_EMPTY for an unregistered slug", () => {
    const h = harness();
    const code = runProposalShow({ argv: argv({ rest: ["nope", "--home", tempHome()], verb: "show" }), deps: h.deps });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("prints the full entry as JSON with --json", () => {
    const home = tempHome();
    seedRegistered({ home, slug: "a-slug" });
    const h = harness();
    const code = runProposalShow({
      argv: argv({ rest: ["a-slug", "--json", "--home", home], verb: "show" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    const parsed = JSON.parse(h.out.join("\n")) as { slug: string; status: string };
    expect(parsed.slug).toBe("a-slug");
    expect(parsed.status).toBe("strawman");
  });

  it("refuses without a slug", () => {
    const h = harness();
    expect(runProposalShow({ argv: argv({ rest: [], verb: "show" }), deps: h.deps })).toBe(EXIT_USAGE);
  });
});

describe("runProposalShow --history", () => {
  it("prints the sequence under the fold, in journal order", () => {
    const home = tempHome();
    seedRegistered({ home, slug: "a-slug" });
    const h = harness();
    runProposalStatus({
      argv: argv({ rest: ["a-slug", "shared", "--why", "posted to #dev", "--home", home], verb: "status" }),
      deps: h.deps,
    });
    runProposalDecide({
      argv: argv({
        rest: ["a-slug", "--decision", "ship it", "--decider", "the owner", "--why", "aligned", "--home", home],
        verb: "decide",
      }),
      deps: h.deps,
    });
    const shown = harness();
    const code = runProposalShow({
      argv: argv({ rest: ["a-slug", "--history", "--home", home], verb: "show" }),
      deps: shown.deps,
    });
    expect(code).toBe(EXIT_OK);
    const lines = shown.out[0]!.split("\n");
    expect(lines.filter((line) => line === "history:").length).toBe(1);
    const history = lines.slice(lines.indexOf("history:") + 1);
    expect(history).toEqual([
      "  2026-08-01T00:00:00.000Z  created (publish) A proposal",
      "  2026-08-22T02:00:00.000Z  status → shared: posted to #dev",
      "  2026-08-22T02:00:00.000Z  approved by the owner on 2026-08-22T02:00:00.000Z: ship it",
    ]);
  });

  it("reports an undecodable line rather than printing a silently short history", () => {
    const home = tempHome();
    seedRegistered({ home, slug: "a-slug" });
    appendFileSync(registerJournalPath({ home, slug: "a-slug" }), '{"kind":"from-the-future","atIso":"2026-09-01"}\n');
    const h = harness();
    runProposalShow({ argv: argv({ rest: ["a-slug", "--history", "--home", home], verb: "show" }), deps: h.deps });
    expect(h.err).toEqual(["journal line 2 could not be decoded by this build — the history above is incomplete"]);
  });

  it("--history --json carries the fold, the events and the unreadable lines together", () => {
    const home = tempHome();
    seedRegistered({ home, slug: "a-slug" });
    const h = harness();
    runProposalShow({
      argv: argv({ rest: ["a-slug", "--history", "--json", "--home", home], verb: "show" }),
      deps: h.deps,
    });
    const payload = JSON.parse(h.out[0]!) as { entry: { slug: string }; events: unknown[]; unreadable: number[] };
    expect(payload.entry.slug).toBe("a-slug");
    expect(payload.events.length).toBe(1);
    expect(payload.unreadable).toEqual([]);
  });
});
