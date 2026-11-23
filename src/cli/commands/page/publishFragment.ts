/**
 * The bytes `page publish` writes: the authored fragment read off disk, every identifier it can resolve linked, and
 * the linked bytes linted against the directory `--assets-from` names. Split from `./publishRun.ts`, which takes the
 * result through the review gate and the publish itself.
 */
import { statSync } from "node:fs";
import { join } from "node:path";

import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusal } from "../../../hatch/render.js";
import type { BareRefContext } from "../../../outbound/linkify/bareRefs.js";
import { linkPageIdentifiers, pageIdentifierContext } from "../../../pages/identifiers.js";
import { lintPageFragment } from "../../../pages/lint.js";
import { readPageFragment } from "../../../pages/publish.js";
import { botAnswerBareRefContext } from "../../bareRefContext.js";

/**
 * Read the authored page, link its identifiers and lint the linked bytes — the bytes a publish writes.
 *
 * @param fragmentPath where the authored fragment is on disk
 * @param home the install the identifiers resolve against
 * @param assetsRoot the absolute directory the page's images are read from, or undefined when none was named
 * @param lintWaived whether `SLOPWEAVER_ALLOW_PAGE_LINT=1` lets a page with lint findings through
 * @param writeDiagnostic where each link made, a read refusal and the lint's findings are printed
 * @returns the linked fragment, or nothing once a read or lint refusal has been printed
 */
export function publishableFragment({
  fragmentPath,
  home,
  assetsRoot,
  lintWaived,
  writeDiagnostic,
}: {
  fragmentPath: string;
  home: string;
  assetsRoot: string | undefined;
  lintWaived: boolean;
  writeDiagnostic: (line: string) => void;
}): string | undefined {
  const fragment = readPageFragment({ path: fragmentPath });
  if (fragment.isErr()) {
    for (const line of fragment.error) {
      writeDiagnostic(line);
    }
    return undefined;
  }
  const { context, linked } = linkedPage({ fragment: fragment.value, home, writeDiagnostic });
  if (!lintLetsPublish({ assetsRoot, context, fragment: linked.fragment, lintWaived, writeDiagnostic })) {
    return undefined;
  }
  return linked.fragment;
}

/**
 * Lint the fragment against the directory its images are read from, and print each finding and the `page-lint`
 * refusal when one stands and the hatch is not open.
 *
 * @param assetsRoot the directory a relative image must sit in; with none named, every relative image is missing
 * @param lintWaived whether `SLOPWEAVER_ALLOW_PAGE_LINT=1` lets a page with findings publish anyway
 * @param writeDiagnostic where the findings and the refusal are printed
 * @returns whether the publish may go on
 */
function lintLetsPublish({
  fragment,
  context,
  assetsRoot,
  lintWaived,
  writeDiagnostic,
}: {
  fragment: string;
  context: BareRefContext;
  assetsRoot: string | undefined;
  lintWaived: boolean;
  writeDiagnostic: (line: string) => void;
}): boolean {
  const findings = lintPageFragment({
    context,
    fragment,
    hasPageFile: ({ path }) =>
      assetsRoot !== undefined && statSync(join(assetsRoot, path), { throwIfNoEntry: false })?.isFile() === true,
  });
  if (findings.length === 0 || lintWaived) {
    return true;
  }
  for (const finding of findings) {
    writeDiagnostic(finding.message);
  }
  const against = assetsRoot === undefined ? "with no --assets-from named" : `against ${assetsRoot}`;
  writeDiagnostic(
    hatchRefusal({
      detail: `${String(findings.length)} finding(s) above, ${against}`,
      hatch: hatchFor({ id: "page-lint" }),
    }),
  );
  return false;
}

/**
 * The page with every identifier it can resolve linked, each link printed as it is made.
 *
 * @param home the install whose controls and Linear facts the references resolve against
 * @returns the linked page and the context the lint reads it against
 */
function linkedPage({
  fragment,
  home,
  writeDiagnostic,
}: {
  fragment: string;
  home: string;
  writeDiagnostic: (line: string) => void;
}): { readonly context: BareRefContext; readonly linked: ReturnType<typeof linkPageIdentifiers> } {
  const context = pageIdentifierContext({ fragment, install: botAnswerBareRefContext({ home }) });
  const linked = linkPageIdentifiers({ context, fragment });
  for (const { raw, url } of linked.linked) {
    writeDiagnostic(`linked ${raw} → ${url}`);
  }
  return { context, linked };
}
