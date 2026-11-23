/**
 * Which page an aim's pictures belong to, and the `--json` document that says so — pure, so the attribution a
 * machine reader gets is tested rather than inferred from the text renderer, and the text receipt prints the
 * very same verdicts.
 */
import { type ResolvedBrowserPolicy, resolveBrowserPagePolicy } from "../../../admit/browserPagePolicy.js";
import type { AimShotResult } from "../../../browser/aimShot.js";
import type { PageObservation } from "../../../browser/interactionSession.js";

/** What an aim prints about its pages: where the pictures were taken, the posture printed, and the JSON form. */
export interface AimAttribution {
  /** The first picture's page, or `null` when ANY picture reply named none — never borrowed from another look. */
  readonly picturesUrl: string | null;
  /** The header's page: the pictures' page, or the gating look's page labelled as such when that is unknown. */
  readonly pageLabel: string;
  /** The register's posture for the pictures' page, or for the gating look's page when the pictures named none. */
  readonly policy: ResolvedBrowserPolicy;
  /** The lines the text receipt prints about a moved page or an unconfirmed one; empty when neither. */
  readonly notes: readonly string[];
  /** The `--json` document: the shot, the filed look, its outline, the page trail and the same verdicts. */
  readonly document: Readonly<Record<string, unknown>>;
}

/**
 * Every page an aim passed through, in order: the look that gated the mark, each page a picture reply named,
 * then the filed look. A page repeated straight after itself is one stay, so one entry means nothing moved.
 *
 * @param gatedUrl the page the look that gated the mark found
 * @param pictureUrls one entry per picture, the page its reply named, `null` where it named none
 * @param filedUrl the page the look taken after the pictures found
 * @returns the trail, never empty
 */
export function aimPageTrail({
  gatedUrl,
  pictureUrls,
  filedUrl,
}: {
  gatedUrl: string;
  pictureUrls: readonly (string | null)[];
  filedUrl: string;
}): readonly string[] {
  const named = pictureUrls.filter((url): url is string => url !== null);
  return [gatedUrl, ...named, filedUrl].filter((url, index, all) => index === 0 || url !== all[index - 1]);
}

/**
 * Attribute an aim's pictures to the pages the client named while it took them, and to nothing else.
 *
 * Every picture reply names its page, so the first one says where the pictures begin. A picture reply that named
 * none leaves its picture's page UNCONFIRMED and says so; `picturesUrl` is then `null`, never filled in from the
 * gating look or a neighbour. The posture printed is still the gating look's page's — the page the mark was
 * judged against — and labelled that way. `pageTrail` and `pageMoved` cover the run from the gating look,
 * through every named picture, to the filed look.
 *
 * @param shot the pictures and the pages the client answered them on
 * @param before the look that gated the mark
 * @param observation the look taken after the pictures, filed as the session's latest
 * @param elements that look's outline
 * @returns the pictures' page, the header label, the posture, the receipt's notes and the JSON document
 */
export function attributeAim({
  shot,
  before,
  observation,
  elements,
}: {
  shot: AimShotResult;
  before: PageObservation;
  observation: PageObservation;
  elements: readonly string[];
}): AimAttribution {
  const [first] = shot.pictureUrls;
  const unconfirmed = shot.pictureUrls.filter((url) => url === null).length;
  // One unnamed picture leaves the SET's page unconfirmed, so no single page is credited with all of them.
  const picturesUrl = first === undefined || unconfirmed > 0 ? null : first;
  let pageLabel = `${before.url} (where the aim was gated; not every picture named its page)`;
  let policyUrl = before.url;
  if (picturesUrl !== null) {
    pageLabel = picturesUrl;
    policyUrl = picturesUrl;
  }
  const pageTrail = aimPageTrail({ filedUrl: observation.url, gatedUrl: before.url, pictureUrls: shot.pictureUrls });
  const notes: string[] = [];
  if (pageTrail.length > 1) {
    notes.push(`  the page moved during the aim: ${pageTrail.join(" -> ")}`);
  }
  if (unconfirmed > 0) {
    notes.push(
      `  unconfirmed: ${unconfirmed} picture(s) came back naming no page, so which page they show is not known`,
    );
  }
  const policy = resolveBrowserPagePolicy({ url: policyUrl });
  const verdicts = { pageMoved: pageTrail.length > 1, pageTrail, picturesUnconfirmed: unconfirmed, picturesUrl };
  return {
    document: { aim: shot, elements, gatedUrl: before.url, page: observation, ...verdicts, policy, policyUrl },
    notes,
    pageLabel,
    picturesUrl,
    policy,
  };
}
