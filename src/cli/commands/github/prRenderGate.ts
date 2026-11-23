/**
 * Render a pull-request form and gate it, before any write: the body's shape, the secret and identifier scan over
 * its title and body, the publication scan, and the title's shape — the checks CI's `pr-format` step runs, here so a
 * refusal comes before the bytes reach GitHub. Split from `./performWrite.ts`, which holds the writes themselves and
 * accepts a draft through `stampToday` here.
 */
import { type InstallationIdentifiers } from "../../../hygiene/installationIdentifiers.js";
import { type PrivateTerm, privateTermsOrRefusal } from "../../../hygiene/privateTerms.js";
import { loadDenylist } from "../../../hygiene/scan.js";
import type { Result } from "../../../lib/result.js";
import { utcDayOf } from "../../../outbound/github/days.js";
import { withholdingCredentialLines } from "../../../outbound/github/descriptionWords.js";
import type { PrBodyError } from "../../../outbound/github/errors.js";
import { renderPrBody } from "../../../outbound/github/render.js";
import { stampForWrite } from "../../../outbound/github/stamp.js";
import { type TitleShapePolicy, titleWriteRefusal } from "../../../outbound/github/titleShape.js";
import type { PrForm, PrFormDraft } from "../../../outbound/github/types.js";
import { publicationFindings } from "../../../outbound/publicationScan.js";
import { prMetadataLeakErrors } from "../../../prformat/checkCore.js";
import { gatePrBody } from "../../../prformat/prBodyGate.js";
import { loadTitleShapePolicy, type TitleShapePolicyError } from "./titleShapePolicy.js";

/** A rendered body and the PR-format gate's verdict on it. */
export interface RenderedBody {
  readonly body: string;
  readonly ok: boolean;
  readonly errors: readonly string[];
}

/**
 * The ONE place every description write scans the exact title and body it is about to publish for what may not be
 * published: first-person pronouns in prose, installation state (session, thread and transcript ids, `transcript:`
 * and `talk-call:` pointers, absolute home paths) and "this Mac". A port, so the scan itself lives in its own module
 * and is supplied by {@link writeGates}; it answers one refusal line per finding, empty when the text may go.
 */
export type PublicationScan = (input: {
  readonly title: string;
  readonly body: string;
  /** The pull request's own `owner/repo`, whose exact address a private term may sit inside. */
  readonly ownRepository: string;
}) => readonly string[];

/**
 * A scan that finds nothing, for a test judging another gate in isolation.
 * @internal — production writes take a {@link prPublicationScan} through {@link writeGates}.
 *
 * @returns no findings
 */
export const noPublicationFindings: PublicationScan = () => [];

/**
 * The publication scan every description write runs (`../../../outbound/publicationScan.ts`), over the title and
 * the rendered body as their own surfaces. Its hygiene half is dropped here because {@link renderAndCheck} already
 * runs that exact scan through `prMetadataLeakErrors`, with the installation identifiers this target forgives;
 * reporting it twice would only repeat a refusal, and without those identifiers it would refuse what CI accepts.
 * Its private-term half is kept: `prMetadataLeakErrors` is CI's scan, which has no state home to read them from.
 *
 * @param privateTerms the installation's private terms, loaded by {@link writeGates}
 * @returns the scan: one refusal line per first-person, installation-state, host-wording or private-term finding
 */
export function prPublicationScan({ privateTerms }: { privateTerms: readonly PrivateTerm[] }): PublicationScan {
  return ({ title, body, ownRepository }) => {
    const hygiene = { denylist: [], ownRepository, privateTerms };
    return [
      ...publicationFindings({ hygiene, surface: "title", text: title }),
      ...publicationFindings({ hygiene, surface: "description", text: body }),
    ]
      .filter((finding) => finding.code !== "HYGIENE")
      .map((finding) => finding.message);
  };
}

/**
 * Render a form and check it against the real gate in one step.
 *
 * Exported so `stackPushRun.ts` and `updateFlow.ts` reuse this exact check rather than approximating it. A body must
 * pass both halves of CI's `pr-format` step (`../../../devGate/devGate.ts`'s `prFormatResult`): the shape,
 * `gatePrBody`, as the C3 shape it detects; and the secret scan over the title and body, `prMetadataLeakErrors`,
 * with the same private denylist. The scans sit HERE rather than only in CI because a refusal there comes after the
 * write, when the text is already on the pull request.
 *
 * The scans cover the bytes this door authors. An update's third-party trailing region is not among them: it is
 * already live on GitHub, so refusing on it would protect nothing, and CI still reads it.
 *
 * The title's conventional-commit shape is judged here too, whenever the write SETS the title
 * (`../../../outbound/github/titleShape.ts`).
 *
 * @param form the pull-request form
 * @param denylist the private denylist terms (`loadDenylist`); empty still catches every credential shape
 * @param publicationScan the scan of what may not be published, run on the exact title and body ({@link PublicationScan})
 * @param liveTitle the title live on GitHub, undefined on a create; a title the write leaves unchanged is not judged
 * @param titlePolicy which repositories' titles are judged (`./titleShapePolicy.ts`); a policy that could not be
 *   read refuses the write rather than judging no title
 * @param installationIdentifiers the installation's own identifiers the scan forgives, read for this target at the
 *   verb's shell (`../../../outbound/github/installationIdentifiersRead.ts`); undefined on this build's own repository, which forgives none
 * @returns the rendered body and whether it passes; a form that cannot render at all carries an empty body and the
 *   renderer's refusal. An error line that would quote a credential shape prints the withheld line instead
 */
export function renderAndCheck({
  form,
  denylist,
  publicationScan,
  liveTitle,
  titlePolicy,
  installationIdentifiers,
}: {
  form: PrForm;
  denylist: readonly string[];
  publicationScan: PublicationScan;
  liveTitle: string | undefined;
  titlePolicy: Result<TitleShapePolicy, TitleShapePolicyError>;
  installationIdentifiers: InstallationIdentifiers | undefined;
}): RenderedBody {
  const rendered = renderPrBody({ form });
  if (rendered.isErr()) {
    return { body: "", errors: withholdingCredentialLines({ lines: [rendered.error.message] }), ok: false };
  }
  const verdict = gatePrBody({ body: rendered.value, owned: true });
  const shapeErrors =
    verdict.shape === "c3"
      ? []
      : [`the rendered body was read as the ${verdict.shape} shape, not C3 — a renderer defect`];
  // The write's own target is the pull request's own repository, the one slug CI's scan does not count either.
  const ownRepository = `${form.target.owner}/${form.target.repo}`;
  const leaks = prMetadataLeakErrors({
    body: rendered.value,
    denylist,
    installationIdentifiers,
    ownRepository,
    title: form.title,
  });
  const published = publicationScan({ body: rendered.value, ownRepository, title: form.title });
  const errors = withholdingCredentialLines({
    lines: [
      ...shapeErrors,
      ...verdict.errors,
      ...leaks,
      ...published,
      ...titleErrors({ form, liveTitle, titlePolicy }),
    ],
  });
  return { body: rendered.value, errors, ok: errors.length === 0 };
}

/** The title's refusal under a policy, or the policy's own when it could not be read. */
function titleErrors({
  form,
  liveTitle,
  titlePolicy,
}: {
  form: PrForm;
  liveTitle: string | undefined;
  titlePolicy: Result<TitleShapePolicy, TitleShapePolicyError>;
}): readonly string[] {
  if (titlePolicy.isErr()) {
    return [`${titlePolicy.error.code}: ${titlePolicy.error.message}`];
  }
  const { owner, repo } = form.target;
  const title = titleWriteRefusal({ liveTitle, owner, policy: titlePolicy.value, repo, title: form.title });
  if (title === undefined) {
    return [];
  }
  return [title];
}

/**
 * The install-held inputs every pull-request write is gated on, read from one home: the private hygiene denylist the
 * secret scan reads, the title-shape policy (`./titleShapePolicy.ts`), and the publication scan with the private
 * terms it matches. Private terms that did not load refuse every title and body with the one refusal sentence, so
 * a preview and a write both stop on it without a second path.
 *
 * @param home the state home every input is read from
 * @returns the gates, spread straight into a `renderAndCheck` call
 */
export function writeGates({ home }: { home: string }): {
  denylist: readonly string[];
  publicationScan: PublicationScan;
  titlePolicy: Result<TitleShapePolicy, TitleShapePolicyError>;
} {
  const privateTerms = privateTermsOrRefusal({ home });
  return {
    denylist: loadDenylist({ home }),
    publicationScan: privateTerms.match(
      (terms) => prPublicationScan({ privateTerms: terms }),
      (refusal): PublicationScan =>
        () => [refusal],
    ),
    titlePolicy: loadTitleShapePolicy({ home }),
  };
}

/**
 * Accept a draft against today's UTC day, from the caller's injected clock.
 *
 * @param draft the validated draft
 * @param now the clock
 * @returns the form, or the refusal when the problem is marked seen after today
 */
export function stampToday({ draft, now }: { draft: PrFormDraft; now: () => Date }): Result<PrForm, PrBodyError> {
  return stampForWrite({ draft, today: utcDayOf({ instant: now() }) });
}

/**
 * An update's draft accepted against today, rendered and gated: the one computation `./updatePreview.ts` runs
 * before the door and `./performWrite.ts` runs again inside it, against the body the freshness re-read returned.
 * Pure — the clock reading is passed in.
 *
 * @param draft the linkified draft the write will send
 * @param liveTitle the title live on GitHub; a title the write leaves unchanged is not judged
 * @param today the clock reading the seen-day check takes
 * @param denylist the private hygiene denylist the secret scan reads
 * @param publicationScan the scan of what may not be published, run on the exact title and body
 * @param titlePolicy which repositories' titles are judged, or why that could not be read
 * @param installationIdentifiers the installation's own identifiers the scan forgives on this target
 * @returns the accepted form and its rendering, or the one-line reason the update is refused
 */
export function stampedUpdate({
  draft,
  liveTitle,
  today,
  denylist,
  publicationScan,
  titlePolicy,
  installationIdentifiers,
}: {
  draft: PrFormDraft;
  liveTitle: string;
  today: Date;
  denylist: readonly string[];
  publicationScan: PublicationScan;
  titlePolicy: Result<TitleShapePolicy, TitleShapePolicyError>;
  installationIdentifiers: InstallationIdentifiers | undefined;
}):
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "ready"; readonly form: PrForm; readonly rendered: RenderedBody } {
  const stamped = stampForWrite({ draft, today: utcDayOf({ instant: today }) });
  if (stamped.isErr()) {
    return { kind: "refused", reason: withholdingCredentialLines({ lines: [stamped.error.message] }).join("") };
  }
  const rendered = renderAndCheck({
    denylist,
    form: stamped.value,
    installationIdentifiers,
    liveTitle,
    publicationScan,
    titlePolicy,
  });
  if (!rendered.ok) {
    return { kind: "refused", reason: `the resulting body fails the PR gate: ${rendered.errors.join("; ")}` };
  }
  return { form: stamped.value, kind: "ready", rendered };
}

/**
 * The body a create would send, previewed before the door: checked against today from the injected clock, the same
 * way `performCreate` checks it, then rendered and gated.
 *
 * Exported for `stackPushRun.ts`, whose dry run prints this verdict and whose live path refuses on it.
 *
 * @param draft the linkified draft
 * @param now the clock the seen-day check reads
 * @param home the state home whose private hygiene denylist the secret scan reads
 * @param installationIdentifiers the installation's own identifiers the scan forgives on this target
 * @returns the rendered body and the gate's verdict; a draft that cannot be accepted carries an empty body and the
 *   refusal
 */
export function previewCreateBody({
  draft,
  now,
  home,
  installationIdentifiers,
}: {
  draft: PrFormDraft;
  now: () => Date;
  home: string;
  installationIdentifiers: InstallationIdentifiers | undefined;
}): RenderedBody {
  const stamped = stampToday({ draft, now });
  if (stamped.isErr()) {
    return { body: "", errors: withholdingCredentialLines({ lines: [stamped.error.message] }), ok: false };
  }
  return renderAndCheck({
    ...writeGates({ home }),
    form: stamped.value,
    installationIdentifiers,
    liveTitle: undefined,
  });
}
