/*
 * A hand step never tells the owner to store a secret under a name the shipped registry lacks (a bug: the
 * SecOps step's `secrets set google-secops-client-id` answered "unknown secret name"). The unregistered names below
 * are ones no registry row will ever carry, so the cases hold after the SecOps rows land.
 */
import { describe, expect, it } from "vitest";

import { HandStepErrors } from "../../../hand/errors.js";
import { postingRefusal } from "../../../hand/posting.js";
import { SECRET_SHAPE } from "../../../hand/proseFields.js";
import { declaringBranchLine, pasteableSecrets, secretNameRefusal, secretsSetNames } from "../../../hand/secretName.js";
import { buildHandStep, type HandStep, type HandStepDraft, MONITOR_WITNESS } from "../../../hand/step.js";
import { unwrap } from "../../../lib/result.js";
import { CREDENTIALS, SECRET_NAMES } from "../../../secrets/registry.js";

/** A name no registry row carries, shaped like one. */
const UNLANDED = "example-unlanded-client-id";

/** Its companion, for a step naming two. */
const UNLANDED_SECRET = "example-unlanded-client-secret";

/** A settable row this build ships. */
const SETTABLE = SECRET_NAMES[0]!;

/** A live row `secrets set` refuses — a grant or a hand-installed file. */
const UNSETTABLE = CREDENTIALS.find((entry) => !entry.settable && entry.lifecycle !== "retired")!;

/** A retired row, which `secrets set` refuses and nothing reads. */
const RETIRED = CREDENTIALS.find((entry) => entry.lifecycle === "retired")!;

/** A step built by the real builder: the SecOps shape, the console as `url`, the command as `literal`. */
function step(over: Partial<HandStepDraft> = {}): HandStep {
  return unwrap(
    buildHandStep({
      draft: {
        id: "secops-oauth-client-chronicle-readonly",
        literal: `slopweaver secrets set ${SETTABLE}`,
        postedBy: "workspace:1",
        postedIso: "2026-10-02T06:55:34.641Z",
        unblocks: "The SecOps atlas on your option A: a new client named slopweaver-secops",
        url: "https://console.cloud.google.com/apis/credentials?project=123456789012",
        what: "Create a new Desktop OAuth client for SecOps with the chronicle.readonly scope, then store its id and secret",
        where: "a plain terminal of yours, after the client exists",
        witness: "slopweaver hand done secops-oauth-client-chronicle-readonly --did stored",
        ...over,
      },
    }),
  );
}

describe("the registry the cases read", () => {
  it("carries settable and unsettable rows, and neither unlanded name", () => {
    expect(SECRET_NAMES.length).toBeGreaterThan(0);
    expect(UNSETTABLE.settable).toBe(false);
    expect(RETIRED.settable).toBe(false);
    const names: readonly string[] = CREDENTIALS.map((entry) => entry.name);
    expect(names.filter((name) => name === UNLANDED || name === UNLANDED_SECRET)).toEqual([]);
  });

  it("spells every row in the shape prose names are read by", () => {
    expect(CREDENTIALS.length).toBeGreaterThan(0);
    expect(CREDENTIALS.filter((entry) => !SECRET_SHAPE.test(entry.name)).map((entry) => entry.name)).toEqual([]);
  });
});

describe("secretsSetNames", () => {
  it.each([
    ["a bare literal", { literal: `slopweaver secrets set ${UNLANDED}` }, [UNLANDED]],
    ["a pasteboard pipe", { literal: `pbpaste | slopweaver secrets set ${UNLANDED}` }, [UNLANDED]],
    ["a package runner", { literal: `npx slopweaver secrets set ${UNLANDED}` }, [UNLANDED]],
    [
      "two joined by &&",
      { literal: `slopweaver secrets set ${UNLANDED} && slopweaver secrets set ${UNLANDED_SECRET}` },
      [UNLANDED, UNLANDED_SECRET],
    ],
    ["a flag where the name goes", { literal: "slopweaver secrets set --help" }, []],
    ["a placeholder behind slopweaver, in prose", { where: "run slopweaver secrets set <name> in a terminal" }, []],
    ["a placeholder in a code span", { where: "run `slopweaver secrets set <name>` in a terminal" }, []],
    [
      "the SecOps prose, its suffix shorthand no name",
      { unblocks: `then secrets set ${UNLANDED} and -secret` },
      [UNLANDED],
    ],
    ["English after secrets set", { unblocks: "the secrets set up last week stay" }, []],
    ["an abbreviation after secrets set", { unblocks: "the secrets set e.g. by onboarding stay" }, []],
    ["a name with shorthand glued on", { unblocks: `then secrets set ${UNLANDED}/-secret` }, [UNLANDED]],
    ["English after a slopweaver mention", { what: "Paste the token into slopweaver secrets set when it prompts" }, []],
  ])("reads %s", (_case, over, names) => {
    expect(secretsSetNames({ step: step({ literal: undefined, ...over }) })).toEqual(names);
  });

  it("names a name once, the literal's first", () => {
    const named = step({ literal: `slopweaver secrets set ${UNLANDED}`, unblocks: `then secrets set ${UNLANDED}` });
    expect(secretsSetNames({ step: named })).toEqual([UNLANDED]);
  });
});

describe("secretNameRefusal", () => {
  it("passes a settable name", () => {
    expect(secretNameRefusal({ step: step() })).toBeUndefined();
  });

  it("passes a step that stores nothing", () => {
    expect(secretNameRefusal({ step: step({ literal: undefined }) })).toBeUndefined();
  });

  it("refuses every name the registry lacks, from the literal and the prose", () => {
    const refused = secretNameRefusal({
      step: step({
        literal: `slopweaver secrets set ${UNLANDED}`,
        unblocks: `then secrets set ${UNLANDED_SECRET}`,
      }),
    });
    expect(refused).toEqual(HandStepErrors.secretNameUnregistered({ names: [UNLANDED, UNLANDED_SECRET] }));
  });

  it("refuses an unsettable row with how its value really gets in", () => {
    const refused = secretNameRefusal({ step: step({ literal: `slopweaver secrets set ${UNSETTABLE.name}` }) });
    expect(refused).toEqual(
      HandStepErrors.secretNameUnsettable({ name: UNSETTABLE.name, retired: false, writtenBy: UNSETTABLE.writtenBy }),
    );
    expect(refused!.message).toContain(`its value gets into the store by: ${UNSETTABLE.writtenBy}. Post that step`);
  });

  it("refuses a retired row with store nothing, never its old writtenBy as the step to post", () => {
    const refused = secretNameRefusal({ step: step({ literal: `slopweaver secrets set ${RETIRED.name}` }) });
    expect(refused!.message).toContain("it is retired, so nothing reads it: drop it from the step");
    expect(refused!.message).not.toContain(RETIRED.writtenBy);
  });

  it("reads a monitor card's literal and skips its unblocks, a subject's label", () => {
    const card = { literal: undefined, unblocks: `prs#1 — then secrets set ${UNLANDED}`, witness: MONITOR_WITNESS };
    expect(secretNameRefusal({ step: step(card) })).toBeUndefined();
    const offered = step({ ...card, literal: `slopweaver secrets set ${UNLANDED}` });
    expect(secretNameRefusal({ step: offered })).toEqual(HandStepErrors.secretNameUnregistered({ names: [UNLANDED] }));
  });

  it("is the posting form's refusal before the prose rule, so an unlanded verb is told to wait first", () => {
    const refused = postingRefusal({ step: step({ literal: undefined, unblocks: `then secrets set ${UNLANDED}` }) });
    expect(refused!.code).toBe("SECRET_NAME_UNREGISTERED");
    expect(refused!.message).toContain("land the branch that adds the row");
  });
});

describe("declaringBranchLine", () => {
  it("names the branch to land", () => {
    expect(declaringBranchLine({ name: UNLANDED, refs: ["refs/heads/secops-atlas-connect"] })).toBe(
      `${UNLANDED}: declared on refs/heads/secops-atlas-connect — land that branch first, then pull the main checkout and post the step`,
    );
  });

  it("counts the refs past the two it names", () => {
    const line = declaringBranchLine({
      name: UNLANDED,
      refs: ["refs/heads/a", "refs/heads/b", "refs/heads/c", "refs/remotes/origin/a"],
    });
    expect(line).toBe(
      `${UNLANDED}: declared on refs/heads/a, refs/heads/b (and 2 more carrying it) — land that branch first, then pull the main checkout and post the step`,
    );
  });

  it("says pull when main already declares it", () => {
    expect(declaringBranchLine({ name: UNLANDED, refs: ["refs/heads/x", "refs/remotes/origin/main"] })).toBe(
      `${UNLANDED}: main already declares it — pull this checkout and the main checkout, then post the step`,
    );
  });

  it("says none was found, never that none declares it", () => {
    expect(declaringBranchLine({ name: UNLANDED, refs: [] })).toBe(
      `${UNLANDED}: no branch found declaring it — its row has to be written and landed before any step names it`,
    );
  });
});

describe("pasteableSecrets", () => {
  it("offers a paste field for a settable name the literal stores", () => {
    expect(pasteableSecrets({ step: step() })).toEqual([SETTABLE]);
  });

  it("offers one for a settable name the prose stores, after the literal's", () => {
    const second = SECRET_NAMES[1]!;
    const named = step({ where: `in the console field, then secrets set ${second} the same way` });
    expect(pasteableSecrets({ step: named })).toEqual([SETTABLE, second]);
  });

  it("drops a name secrets set would refuse — an unsettable row, a retired one, or none at all", () => {
    const literal = [UNSETTABLE.name, RETIRED.name, UNLANDED]
      .map((name) => `slopweaver secrets set ${name}`)
      .join("; ");
    expect(secretsSetNames({ step: step({ literal }) })).toEqual([UNSETTABLE.name, RETIRED.name, UNLANDED]);
    expect(pasteableSecrets({ step: step({ literal }) })).toEqual([]);
  });

  it("offers nothing on a step that stores no secret", () => {
    expect(pasteableSecrets({ step: step({ literal: "open -a Slack" }) })).toEqual([]);
  });
});
