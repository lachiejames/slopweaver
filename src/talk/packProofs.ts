/**
 * The proof verdicts the voice's pack carries per ask, read off the last recorded `handover currency` reading — never
 * off GitHub. `talk pack` is kept fresh by the console and the sweep, and a live read on every refresh would be a second
 * producer of the same fact; the currency verb is the one (`../cli/commands/handover/currencyRun.ts`).
 *
 * An ask leads with an UNMET verdict and nothing else: a body the reading could not read is said as not checked, and
 * a reading that is missing, old or malformed puts the proofs on the pack's Not-read list rather than reading as "no
 * pull request needs proof". Pure: a parsed reading document in, values out.
 */
import { z } from "zod";

/** One pull request's verdict as an ask carries it, with when the body was read. */
export type PackProof =
  | { readonly identity: string; readonly checkedIso: string; readonly verdict: "met" }
  | { readonly identity: string; readonly checkedIso: string; readonly verdict: "unmet"; readonly gap: string }
  | { readonly identity: string; readonly checkedIso: string; readonly verdict: "unread"; readonly why: string };

/** The recorded verdicts the pack was built against, or why there were none to read. */
export type PackProofSource =
  | {
      readonly kind: "read";
      readonly checkedIso: string;
      readonly pullRequests: readonly {
        readonly identity: string;
        readonly rowSlugs: readonly string[];
        readonly proof: PackProofVerdict;
      }[];
    }
  | { readonly kind: "unread"; readonly why: string };

/** One verdict as the reading stores it, reduced to what the pack says. */
type PackProofVerdict =
  | { readonly kind: "requested-and-met" }
  | { readonly kind: "requested-and-unmet"; readonly gap: string }
  | { readonly kind: "body-unread"; readonly why: string };

/**
 * The reading's verdict, as much of it as the pack reads. An unmet one must name what is missing, exactly as the
 * producer writes it and the Queue's reader refuses otherwise, so a gap sentence with nothing missing behind it reads
 * as no verdict at all.
 */
const verdictSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("requested-and-met") }),
  z.object({
    gap: z.string().min(1),
    kind: z.literal("requested-and-unmet"),
    missing: z.array(z.enum(["image", "run-link", "datadog"])).min(1),
  }),
  z.object({ kind: z.literal("body-unread"), why: z.string() }),
]);

/** The currency reading's document, as much of it as the pack reads. */
const readingSchema = z.object({
  checkedIso: z.string(),
  pullRequests: z.array(z.object({ identity: z.string(), proof: verdictSchema, rowSlugs: z.array(z.string()) })),
});

/** A stored ask's proofs, as `talk pack --write` keeps them. */
export const storedPackProofsSchema = z.array(
  z.discriminatedUnion("verdict", [
    z.object({ checkedIso: z.string(), identity: z.string(), verdict: z.literal("met") }),
    z.object({ checkedIso: z.string(), gap: z.string(), identity: z.string(), verdict: z.literal("unmet") }),
    z.object({ checkedIso: z.string(), identity: z.string(), verdict: z.literal("unread"), why: z.string() }),
  ]),
);

/**
 * Read the recorded currency document's verdicts.
 *
 * @param document the reading's parsed document
 * @returns the verdicts and when they were read, or why the document carries none
 */
export function packProofSourceOf({ document }: { document: unknown }): PackProofSource {
  const parsed = readingSchema.safeParse(document);
  if (!parsed.success) {
    return {
      kind: "unread",
      why: `the last handover currency reading carries no readable pull-request verdicts: ${parsed.error.issues[0]!.message}`,
    };
  }
  return { checkedIso: parsed.data.checkedIso, kind: "read", pullRequests: parsed.data.pullRequests };
}

/**
 * The verdicts bearing on one ask: every pull request whose verdict names the ask's row among the rows naming it, and
 * which that row still names NOW — a reading is a tick old and a slug is reused, so the slug alone could carry a gap
 * about a pull request the row no longer names.
 *
 * @param source the recorded verdicts
 * @param slug the ask's row
 * @param named every pull request the ask's row names on the board being read (its `prNamed`)
 * @returns the ask's proofs, unmet first — `undefined` when no reading was read, never an empty list standing for it
 */
export function packProofsFor({
  source,
  slug,
  named,
}: {
  source: PackProofSource;
  slug: string;
  named: readonly string[];
}): readonly PackProof[] | undefined {
  if (source.kind === "unread") {
    return undefined;
  }
  const proofs: PackProof[] = [];
  for (const pr of source.pullRequests) {
    if (!pr.rowSlugs.includes(slug) || !named.includes(pr.identity)) {
      continue;
    }
    const { checkedIso } = source;
    const { identity, proof } = pr;
    if (proof.kind === "requested-and-unmet") {
      proofs.push({ checkedIso, gap: proof.gap, identity, verdict: "unmet" });
    } else if (proof.kind === "body-unread") {
      proofs.push({ checkedIso, identity, verdict: "unread", why: proof.why });
    } else {
      proofs.push({ checkedIso, identity, verdict: "met" });
    }
  }
  return [...proofs.filter((one) => one.verdict === "unmet"), ...proofs.filter((one) => one.verdict !== "unmet")];
}

/**
 * The lines one ask's proofs add: the unmet gaps, which lead the entry, and the rest, which follow the owner's words.
 *
 * @param proofs the ask's proofs, `undefined` when no reading carried verdicts — the pack's "Not read" section says
 * that once, so the entry adds nothing
 * @returns the leading lines and the trailing ones
 */
export function proofLines({ proofs }: { proofs: readonly PackProof[] | undefined }): {
  readonly lead: readonly string[];
  readonly after: readonly string[];
} {
  const lead: string[] = [];
  const after: string[] = [];
  if (proofs === undefined) {
    return { after, lead };
  }
  for (const proof of proofs) {
    if (proof.verdict === "unmet") {
      lead.push(`  SAY THIS FIRST, before the question — ${proof.gap} (body read ${proof.checkedIso})`);
    } else if (proof.verdict === "unread") {
      after.push(
        `  proof on ${proof.identity}: the owner asked for it; the body was not checked (${proof.why}) — say not checked, never missing`,
      );
    } else {
      after.push(`  proof on ${proof.identity}: the body carried what the owner asked for at ${proof.checkedIso}`);
    }
  }
  return { after, lead };
}
