/**
 * Shared C3 form fixtures: three bodies shaped like the three cut-4 examples — tests with both screenshots, a
 * medium-risk fix with both screenshots run by an agent, and a feature whose problem is not seen yet — in the
 * synthetic organisation.
 */
import type { Content, ImageRun, PrBody, PrForm, PrTarget, RiskItem } from "../../../../outbound/github/types.js";

/**
 * A one-run text cell.
 *
 * @param text the run's text
 * @returns the cell
 */
export function t({ text }: { text: string }): Content {
  return [{ kind: "text", text }];
}

/** A routing target in the synthetic organisation. */
export const TARGET: PrTarget = { base: "main", head: "c3-form", owner: "acme", repo: "widgets" };

/**
 * A user-attachments image.
 *
 * @param id the attachment id
 * @param alt the alt text
 * @returns the image run
 */
export function shot({ id, alt }: { id: string; alt: string }): ImageRun {
  return { alt, kind: "image", url: `https://github.com/user-attachments/assets/${id}` };
}

/** A low, checked top risk. */
export const P3_CHECKED: RiskItem = {
  check: { check: "Tests only, no app code changes", kind: "checked" },
  worst: "a test passes for the wrong reason",
  worstKind: "only-tests-docs-or-dev-tooling",
};

/** A medium, checked top risk. */
export const P2_CHECKED: RiskItem = {
  check: { check: "It only refuses an expiry that is not a sensible number of seconds", kind: "checked" },
  worst: "a sign-in that used to work is refused",
  worstKind: "something-working-breaks",
};

/** A medium risk nobody checked. */
const P2_UNCHECKED: RiskItem = {
  check: { kind: "unchecked", why: "no staging copy of the widget store exists" },
  worst: "the widget list renders empty for one refresh",
  worstKind: "something-working-breaks",
};

/** A high risk. */
export const P1_CHECKED: RiskItem = {
  check: { check: "The migration was run against a copy of the store", kind: "checked" },
  worst: "every stored widget is unreadable until a rollback",
  worstKind: "loses-leaks-or-changes-off-machine",
};

/** Like cut 4's PR 1: tests for a fix already on main, both proofs a screenshot run by the owner. */
export const TESTS_BODY: PrBody = {
  checks: [t({ text: "The new test fails on the commit before the fix and passes here." })],
  explainer: [
    {
      kind: "text",
      text: "Widget connect broke on a personal account, because the provider started sending a field (",
    },
    { kind: "code", text: "ageGroup" },
    { kind: "text", text: ") the schema did not declare. This adds two tests so it cannot quietly come back." },
  ],
  notChecked: [
    { check: t({ text: "A work account" }), why: t({ text: "Out of scope for this PR." }) },
    {
      check: [
        { kind: "text", text: "What the provider puts in " },
        { kind: "code", text: "ageGroup" },
      ],
      why: t({ text: "The schema accepts any value and nothing reads it." }),
    },
  ],
  problemProof: {
    image: shot({ alt: "widget connect failing after consent", id: "11111111-aaaa-4bbb-8ccc-000000000001" }),
    kind: "screenshot",
    proves: t({ text: "On the commit before the fix, connect fails straight after consent." }),
    runBy: "owner",
  },
  problemSeen: {
    by: "unrecorded",
    kind: "seen",
    on: "2026-11-16",
    what: "widget connect failed after consent on a personal account",
  },
  rerun: [{ kind: "command", lang: "sh", text: "yarn vitest run widgetConnect.test.ts" }],
  risk: { items: [P3_CHECKED] },
  solutionProof: {
    image: shot({ alt: "widget connection status after sign-in", id: "11111111-aaaa-4bbb-8ccc-000000000002" }),
    kind: "screenshot",
    proves: t({ text: "After the fix, the connection reads connected." }),
    runBy: "owner",
  },
  visualProof: "screen-change",
};

/** Like cut 4's PR 2: a medium-risk fix, both screenshots run by an agent, no fold. */
export const FIX_BODY: PrBody = {
  checks: [t({ text: "The moved check's own tests were not touched, and still pass." })],
  explainer: t({ text: "The local store was left open to the network. This makes start refuse in that case." }),
  notChecked: [],
  problemProof: {
    image: shot({ alt: "store start going through on main", id: "22222222-aaaa-4bbb-8ccc-000000000001" }),
    kind: "screenshot",
    proves: t({ text: "On main, start goes through with the store open to the network." }),
    runBy: "agent",
  },
  problemSeen: { by: "agent", kind: "seen", on: "2026-11-16", what: "the store accepted the default password" },
  rerun: [],
  risk: { items: [P2_CHECKED, P2_UNCHECKED] },
  solutionProof: {
    image: shot({ alt: "store start refusing on this branch", id: "22222222-aaaa-4bbb-8ccc-000000000002" }),
    kind: "screenshot",
    proves: t({ text: "On this branch, start refuses and names the setting." }),
    runBy: "agent",
  },
  visualProof: "screen-change",
};

/** Like cut 4's PR 7: the problem not seen yet, the solution shown, a note and tests in the fold. */
export const FEATURE_BODY: PrBody = {
  checks: [
    t({ text: "A garbled expiry is refused, not ignored." }),
    t({ text: "A sign-in saved before still reads." }),
  ],
  explainer: [
    { kind: "link", text: "The provider expires sign-ins after 7 days", url: "https://example.com/oauth#expiry" },
    { kind: "text", text: " for an app in testing mode. This saves the expiry and warns 48 hours before." },
  ],
  notChecked: [
    {
      check: t({ text: "The 48-hour warning on a real sign-in" }),
      why: t({ text: "Tests cover it, and a third capture on day 5 adds little." }),
    },
  ],
  problemProof: { kind: "reason", reason: t({ text: "Not captured yet: the 7-day expiry has to pass first." }) },
  problemSeen: { kind: "not-seen", why: "Not seen on a real sign-in yet" },
  rerun: [
    { content: t({ text: "Where the warning shows up, and the tests." }), kind: "note" },
    { items: [t({ text: "expiry.test.ts" }), t({ text: "warning.test.ts" })], kind: "tests" },
  ],
  risk: { items: [P2_CHECKED] },
  solutionProof: {
    image: shot({ alt: "saved expiry seven days out", id: "77777777-aaaa-4bbb-8ccc-000000000001" }),
    kind: "screenshot",
    proves: t({ text: "Straight after a sign-in, the expiry is saved 7 days out." }),
    runBy: "agent",
  },
  visualProof: "screen-change",
};

/** A change nothing on screen shows: two reasons, `tests only`. */
export const TESTS_ONLY_BODY: PrBody = {
  ...FIX_BODY,
  problemProof: { kind: "reason", reason: t({ text: "A refactor with no behaviour change." }) },
  risk: { items: [P3_CHECKED] },
  solutionProof: {
    kind: "reason",
    reason: t({ text: "The store reads the same before and after, so there is nothing to show." }),
  },
  visualProof: "nothing-on-screen",
};

/** A CI job's failing lines, verbatim, one carrying a backtick run longer than the shortest fence. */
export const QUOTED_LOG =
  "  ALL_SUCCEEDED: false\n##[error]Process completed with exit code 1.\nthe step printed ```` and stopped";

/**
 * A change shown by quoted output on both sides and nothing on screen: the problem quoted from a CI job's log, the
 * solution from a command's output, `nothing-on-screen`, which only the quote's hover carries back.
 */
export const QUOTE_BODY: PrBody = {
  ...FIX_BODY,
  problemProof: {
    kind: "quote",
    lang: "text",
    proves: t({ text: "On main, the build job fails because one required job did not succeed." }),
    runBy: "agent",
    source: { kind: "link", text: "the build job's log", url: "https://github.com/acme/widgets/actions/runs/1/job/2" },
    text: QUOTED_LOG,
  },
  risk: { items: [P2_CHECKED] },
  solutionProof: {
    kind: "quote",
    lang: "",
    proves: t({ text: "On this branch, the same check prints every job green." }),
    runBy: "owner",
    source: { kind: "code", text: "widgets checks --all" },
    text: "lint: success\nunit: success",
  },
  visualProof: "nothing-on-screen",
};

/**
 * A whole form around a body.
 *
 * @returns the form, a draft against {@link TARGET}
 */
export function formOf({ body }: { body: PrBody }): PrForm {
  return { ...body, draft: true, target: TARGET, title: "fix(widgets): refuse an open store" };
}
