import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "#lib/result.js";
import { runWorkstreamsLoopIn } from "../../../cli/commands/workstreams/loopIn.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import type { SlackDraftItem } from "../../../outbound/slack/draftRegister.js";
import { formReceiptLinks } from "../../../outbound/slack/formReceipts.js";
import { writeCandidates } from "../../../workstreams/candidateStore.js";
import { loopInDraftOf, loopInFormOf, loopInOpenerOf, loopInWhyOf } from "../../../workstreams/loopIn.js";
import { LoopInErrors } from "../../../workstreams/loopInErrors.js";
import { type LoopInDeps, parkLoopIn } from "../../../workstreams/loopInStore.js";

import { validCandidates } from "./candidatesFixture.js";

const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((clean) => {
    clean();
  });
});

/** A throwaway home the store may read and write — never the ambient home. */
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "sw-ws-loopin-"));
  cleanups.push(() => {
    rmSync(root, { force: true, recursive: true });
  });
  return root;
}

const WHY = loopInWhyOf({
  candidateId: "c-002",
  candidateName: "Postmortems that happen",
  name: "Ari",
  person: "U0SYNTESTAAA1",
});

/** A folded draft carrying only what the loop-in match reads. */
function item({ id, state, why }: { id: string; state: SlackDraftItem["state"]; why: string }): SlackDraftItem {
  return { draft: { why }, id, state } as unknown as SlackDraftItem;
}

describe("loopInWhyOf and loopInFormOf", () => {
  it("names the person, the candidate and its id exactly, and drafts the opener as one message", () => {
    expect(WHY).toBe(
      'loop Ari (U0SYNTESTAAA1) in on "Postmortems that happen", the conversation mined candidate c-002 says is owed',
    );
    expect(JSON.parse(loopInFormOf({ link: undefined, opener: "hey, quick one" }))).toEqual({
      kind: "drip",
      messages: [{ runs: [{ text: "hey, quick one", type: "text" }] }],
    });
  });

  it("ends the opener on the evidence link when its receipts bring one", () => {
    expect(JSON.parse(loopInFormOf({ link: "https://x.test/m/4", opener: "hey, quick one" }))).toEqual({
      kind: "drip",
      messages: [
        {
          runs: [
            { text: "hey, quick one ", type: "text" },
            { label: "where this came from", type: "link", url: "https://x.test/m/4" },
          ],
        },
      ],
    });
  });
});

describe("loopInOpenerOf", () => {
  it("names what was tried, counting the candidate's evidence items", () => {
    const anchorOnly = { href: null };
    const plain = "Postmortems keep slipping.";
    expect([
      loopInOpenerOf({ candidateId: "c-005", evidence: [anchorOnly], opener: plain }),
      loopInOpenerOf({ candidateId: "c-006", evidence: [anchorOnly, anchorOnly], opener: plain }),
    ]).toEqual([
      {
        form: loopInFormOf({ link: undefined, opener: plain }),
        receipts: {
          kind: "tried",
          tried: "linking c-005's evidence, but its 1 evidence item gave no link that counts as a receipt",
        },
      },
      {
        form: loopInFormOf({ link: undefined, opener: plain }),
        receipts: {
          kind: "tried",
          tried: "linking c-006's evidence, but none of its 2 evidence items gave a link that counts as a receipt",
        },
      },
    ]);
  });

  it("says only that the draft cannot carry an address the drip form refuses, which may still open elsewhere", () => {
    // A Vanta policy document downloads a PDF, so it opens; the outbound form refuses it all the same.
    const evidence = [{ href: "https://app.vanta.com/c/acme/acme/doc/Policy-123" }];
    const { form, receipts } = loopInOpenerOf({ candidateId: "c-1", evidence, opener: "Plain opener." });
    expect(receipts).toEqual({
      kind: "tried",
      tried: "linking c-1's evidence, but its 1 evidence item gave no link that counts as a receipt",
    });
    expect(formReceiptLinks({ form })).toEqual([]);
  });

  it("folds a multiline opener onto one line, so it parks with its evidence link", () => {
    const evidence = [{ href: "https://x.test/proof" }];
    const { form, receipts } = loopInOpenerOf({
      candidateId: "c-005",
      evidence,
      opener: "First line \r\n\n  Second line",
    });
    expect(JSON.parse(form).messages[0].runs[0].text).toBe("First line Second line ");
    expect(receipts).toEqual({ kind: "undeclared" });
    expect(formReceiptLinks({ form })).toEqual(["https://x.test/proof"]);
  });

  it("blames an opener the drip form refuses, never the evidence that gave a good link", () => {
    const opener = "";
    expect(loopInOpenerOf({ candidateId: "c-005", evidence: [{ href: "https://x.test/proof" }], opener })).toEqual({
      form: loopInFormOf({ link: undefined, opener }),
      receipts: { kind: "tried", tried: "linking c-005's evidence, but its opener's form does not parse" },
    });
  });

  it("declares nothing exactly when the recorder's parse derives a link off the form it parks", () => {
    const anchorOnly = [{ href: null }];
    /** The declaration beside what `slack draft record` derives off the very form the loop-in parks. */
    const both = ({ evidence, opener }: { evidence: readonly { href: string | null }[]; opener: string }) => {
      const { form, receipts } = loopInOpenerOf({ candidateId: "c-004", evidence, opener });
      return { kind: receipts.kind, links: formReceiptLinks({ form }) };
    };
    expect([
      both({ evidence: [{ href: null }, { href: "https://x.test/m/4" }], opener: "WAF is in monitor mode." }),
      // The drip parse turns a bare address in the text into a link run, so the opener's own address is its receipt.
      both({ evidence: anchorOnly, opener: "WAF is in monitor mode; see https://x.test/1" }),
      both({ evidence: anchorOnly, opener: "WAF is in monitor mode." }),
      // The parse makes `mailto:` a link run, but a receipt is a page a reader opens, so it is no receipt.
      both({ evidence: anchorOnly, opener: "Email mailto:owner@example.com" }),
      both({ evidence: [{ href: "mailto:owner@example.com" }], opener: "WAF is in monitor mode." }),
      // An address with only a scheme fails the parse, so the next evidence item is the link the opener ends on.
      both({ evidence: [{ href: "https://" }, { href: "https://x.test/m/5" }], opener: "WAF." }),
      both({ evidence: [{ href: "https://" }], opener: "WAF." }),
    ]).toEqual([
      { kind: "undeclared", links: ["https://x.test/m/4"] },
      { kind: "undeclared", links: ["https://x.test/1"] },
      { kind: "tried", links: [] },
      { kind: "tried", links: [] },
      { kind: "tried", links: [] },
      { kind: "undeclared", links: ["https://x.test/m/5"] },
      { kind: "tried", links: [] },
    ]);
  });
});

describe("loopInDraftOf", () => {
  it("prefers a held draft, then the latest sent one, and treats a dropped one as none", () => {
    const dropped = item({ id: "sd-1", state: "dropped", why: WHY });
    const sent = item({ id: "sd-2", state: "released", why: WHY });
    const held = item({ id: "sd-3", state: "held", why: WHY });
    const other = item({ id: "sd-4", state: "held", why: "something else" });
    expect(loopInDraftOf({ items: [dropped, other], why: WHY })).toEqual({ draftId: null, state: "none" });
    expect(loopInDraftOf({ items: [dropped, sent], why: WHY })).toEqual({ draftId: "sd-2", state: "released" });
    expect(loopInDraftOf({ items: [sent, held], why: WHY })).toEqual({ draftId: "sd-3", state: "held" });
  });
});

describe("parkLoopIn", () => {
  /** Fakes that record each park and answer with a fresh id; `drafts` is what the register holds. */
  function fakes({ drafts }: { drafts: readonly SlackDraftItem[] }): {
    deps: LoopInDeps;
    parks: Omit<Parameters<LoopInDeps["park"]>[0], "home">[];
  } {
    const parks: Omit<Parameters<LoopInDeps["park"]>[0], "home">[] = [];
    const deps: LoopInDeps = {
      drafts: () => drafts,
      lock: () => ok({ release: () => undefined }),
      now: () => "2026-10-03T01:00:00.000Z",
      park: ({ channel, form, receipts, why }) => {
        parks.push({ channel, form, receipts, why });
        return Promise.resolve(ok({ draftId: "sd-new" }));
      },
    };
    return { deps, parks };
  }

  it("parks the candidate's opener to the person's DM when nothing stands, naming it exactly and where its basis lives", async () => {
    const home = scratch();
    unwrap(writeCandidates({ home, value: validCandidates() }));
    const { deps, parks } = fakes({ drafts: [] });
    const receipt = unwrap(await parkLoopIn({ candidateId: "c-002", deps, home, person: "U0SYNTESTAAA1" }));
    expect(receipt).toEqual({ candidate: "c-002", draftId: "sd-new", person: "U0SYNTESTAAA1", state: "parked" });
    expect(parks).toEqual([
      {
        channel: "U0SYNTESTAAA1",
        // The opener claims postmortems keep slipping, so it brings c-002's first evidence a reader can open — the Slack
        // message — as a link `slack draft record` derives, rather than calling itself self-evident.
        form: loopInFormOf({
          link: "https://example.slack.com/archives/C0SYNINCIDENTS/p1782000000000100",
          opener: "Postmortems keep slipping. Could we agree who owns writing each one?",
        }),
        receipts: { kind: "undeclared" },
        why: WHY,
      },
    ]);
  });

  it("parks nothing new while the first draft is held", async () => {
    const home = scratch();
    unwrap(writeCandidates({ home, value: validCandidates() }));
    const { deps, parks } = fakes({ drafts: [item({ id: "sd-3", state: "held", why: WHY })] });
    const receipt = unwrap(await parkLoopIn({ candidateId: "c-002", deps, home, person: "U0SYNTESTAAA1" }));
    expect([receipt.state, receipt.draftId, parks.length]).toEqual(["held", "sd-3", 0]);
  });

  it("refuses a person the candidate does not name, parking nothing", async () => {
    const home = scratch();
    unwrap(writeCandidates({ home, value: validCandidates() }));
    const { deps, parks } = fakes({ drafts: [] });
    const refused = unwrapErr(await parkLoopIn({ candidateId: "c-002", deps, home, person: "U0SYNSOMEONE9" }));
    expect([refused.code, refused.message, parks.length]).toEqual([
      "LOOP_IN_NOT_OWED",
      "nothing parked — c-002 does not name U0SYNSOMEONE9 to loop in; it names U0SYNTESTAAA1",
      0,
    ]);
  });

  it("refuses a candidate that names nobody", async () => {
    const home = scratch();
    unwrap(writeCandidates({ home, value: validCandidates() }));
    const refused = unwrapErr(
      await parkLoopIn({ candidateId: "c-003", deps: fakes({ drafts: [] }).deps, home, person: "U0SYNTESTAAA1" }),
    );
    expect(refused.message).toBe("nothing parked — c-003 names nobody to loop in");
  });

  it("maps each failure to its exit through the verb: a candidate not yet mined 2, not owed 2, a refused park 1", async () => {
    const home = scratch();
    const verb = async ({ deps, person }: { deps: LoopInDeps; person: string }) => {
      const diagnostics: string[] = [];
      const out: string[] = [];
      const exit = await runWorkstreamsLoopIn({
        deps: { ...deps, writeDiagnostic: (line) => diagnostics.push(line), writeOut: (line) => out.push(line) },
        rest: ["--candidate", "c-002", "--person", person, "--home", home],
      });
      return { diagnostics, exit, out };
    };
    const noneMined = await verb({ deps: fakes({ drafts: [] }).deps, person: "U0SYNTESTAAA1" });
    unwrap(writeCandidates({ home, value: validCandidates() }));
    const notOwed = await verb({ deps: fakes({ drafts: [] }).deps, person: "U0SYNSOMEONE9" });
    const refusing: LoopInDeps = {
      ...fakes({ drafts: [] }).deps,
      park: () => Promise.resolve(err(LoopInErrors.parkRefused({ exitCode: 1 }))),
    };
    const refused = await verb({ deps: refusing, person: "U0SYNTESTAAA1" });
    const parked = await verb({ deps: fakes({ drafts: [] }).deps, person: "U0SYNTESTAAA1" });
    expect([noneMined.exit, notOwed.exit, refused.exit, parked.exit]).toEqual([
      EXIT_USAGE,
      EXIT_USAGE,
      EXIT_ERROR,
      EXIT_OK,
    ]);
    expect([refused.diagnostics, parked.out]).toEqual([
      [
        "workstreams loop-in: slack draft record refused the park (exit 1), so nothing is on the Queue — its lines above say why",
      ],
      ["c-002 → U0SYNTESTAAA1: draft sd-new is parked on the Queue for your yes — nothing sent"],
    ]);
  });

  it("names a candidate no mine has proposed yet as not owed, since the stated outcomes are always read", async () => {
    const refused = unwrapErr(
      await parkLoopIn({ candidateId: "c-002", deps: fakes({ drafts: [] }).deps, home: scratch(), person: "U0X" }),
    );
    expect(refused.code).toBe("LOOP_IN_NOT_OWED");
  });

  it("refuses a mined file that will not read as the candidates, never as nobody owed", async () => {
    const home = scratch();
    mkdirSync(join(home, "workstreams"), { recursive: true });
    writeFileSync(join(home, "workstreams", "candidates.json"), "{ not json");
    const refused = unwrapErr(
      await parkLoopIn({ candidateId: "c-002", deps: fakes({ drafts: [] }).deps, home, person: "U0X" }),
    );
    expect(refused.code).toBe("LOOP_IN_CANDIDATES");
  });
});
