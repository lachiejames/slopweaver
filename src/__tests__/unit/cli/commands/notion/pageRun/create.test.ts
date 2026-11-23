/**
 * The `notion page create` orchestration: create, read back and record; refuse a repeated intent, a missing
 * token and a bad parent; report a lost response as indeterminate and keep its reservation; report a create the
 * transport refused before the wire as failed and release THIS invocation's reservation, so the reworded retry is
 * fresh. The shared fixtures are in `./harness.ts`.
 */
import { describe, expect, it } from "vitest";
import { runNotionPage } from "../../../../../../cli/commands/notion/pageRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { intentDigest, readIntentRecord, readPageRecord } from "../../../../../../outbound/notion/pageLedger.js";
import { argv, BODY, harness, PAGE, PARENT, REFUSED_TEXT, tempHome, URL, useTempHomes } from "./harness.js";

/** The intent `create --parent PARENT --title T` over the shared body reserves. */
const INTENT = intentDigest({ body: BODY, parentPageId: PARENT, title: "T" });

/** argv for that create under `home`. */
const createArgv = ({ home }: { home: string }): readonly string[] =>
  argv({ rest: ["create", "--parent", PARENT, "--title", "T", "--body", "-", "--home", home] });

useTempHomes();

describe("runNotionPage — create", () => {
  it("creates, reads back, and records the page under both ledger indexes", async () => {
    const h = harness();
    const home = tempHome();
    const code = await runNotionPage({
      argv: argv({ rest: ["create", "--parent", PARENT, "--title", "T", "--body", "-", "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(h.calls).toEqual(["resolveToken", "makeApis", "createPage", "retrieveMarkdown"]);
    expect(h.homes).toEqual([home]);
    expect(readPageRecord({ home, pageId: PAGE })!.url).toBe(URL);
  });

  it("sends the markdown verbatim, because Notion does the conversion", async () => {
    const h = harness();
    await runNotionPage({
      argv: argv({ rest: ["create", "--parent", PARENT, "--title", "T", "--body", "-", "--home", tempHome()] }),
      deps: h.deps,
    });
    expect(h.sent()).toBe(BODY);
  });

  it("refuses the SAME intent twice, since Notion cannot be asked whether the first landed", async () => {
    const home = tempHome();
    const first = harness();
    await runNotionPage({
      argv: argv({ rest: ["create", "--parent", PARENT, "--title", "T", "--body", "-", "--home", home] }),
      deps: first.deps,
    });
    const second = harness();
    const code = await runNotionPage({
      argv: argv({ rest: ["create", "--parent", PARENT, "--title", "T", "--body", "-", "--home", home] }),
      deps: second.deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(second.calls).not.toContain("createPage");
    expect(second.out.join("\n")).toContain("already reserved");
  });

  it("reports a lost response as indeterminate and records no page", async () => {
    const h = harness({ create: "fail" });
    const home = tempHome();
    const code = await runNotionPage({
      argv: argv({ rest: ["create", "--parent", PARENT, "--title", "T", "--body", "-", "--home", home] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(readPageRecord({ home, pageId: PAGE })).toBe(undefined);
    expect(h.out.join("\n")).toContain("Do NOT re-run this");
  });

  it("keeps a lost create's reservation, so a re-run is refused as a duplicate rather than publishing twice", async () => {
    const home = tempHome();
    await runNotionPage({ argv: createArgv({ home }), deps: harness({ create: "fail" }).deps });
    expect(readIntentRecord({ home, intent: INTENT })!.reservedIso).toBe("2026-08-22T00:00:00.000Z");
    const rerun = harness();
    expect(await runNotionPage({ argv: createArgv({ home }), deps: rerun.deps })).toBe(EXIT_EXPECTED_EMPTY);
    expect(rerun.calls).not.toContain("createPage");
  });

  it("reports a create the privacy check refused as failed and releases its reservation for the reworded retry", async () => {
    const home = tempHome();
    const refused = harness({ create: "refused" });
    expect(await runNotionPage({ argv: createArgv({ home }), deps: refused.deps })).toBe(EXIT_ERROR);
    expect(refused.out).toEqual([`the write failed: ${REFUSED_TEXT}`]);
    expect(readIntentRecord({ home, intent: INTENT })).toBe(undefined);
    const rerun = harness();
    expect(await runNotionPage({ argv: createArgv({ home }), deps: rerun.deps })).toBe(EXIT_OK);
    expect(rerun.calls).toContain("createPage");
    expect(readPageRecord({ home, pageId: PAGE })!.url).toBe(URL);
  });

  it("releases the reservation of a create refused for a dead Datadog host too", async () => {
    const home = tempHome();
    const refused = harness({ create: "deadHost" });
    expect(await runNotionPage({ argv: createArgv({ home }), deps: refused.deps })).toBe(EXIT_ERROR);
    expect(readIntentRecord({ home, intent: INTENT })).toBe(undefined);
  });

  it("refuses without a token, before building a client", async () => {
    const h = harness({ token: null });
    const code = await runNotionPage({
      argv: argv({ rest: ["create", "--parent", PARENT, "--title", "T", "--body", "-", "--home", tempHome()] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.calls).toEqual(["resolveToken"]);
  });

  it("refuses an unparseable parent address", async () => {
    const h = harness();
    const code = await runNotionPage({
      argv: argv({ rest: ["create", "--parent", "not-a-page", "--title", "T", "--body", "-", "--home", tempHome()] }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_USAGE);
    // The address is resolved BEFORE the client is built, so a malformed parent costs no client at all.
    expect(h.calls).toEqual(["resolveToken"]);
  });
});
