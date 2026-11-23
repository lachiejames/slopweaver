/**
 * The card merchants an install groups its card charges under — the pure half: the document `spend merchants set`
 * takes and `show --json` prints, its validation, and the classification every spend reader runs.
 *
 * Every integration is generic, Airwallex included; vendor behaviour lives in the integration,
 * and a company's accounts, preferences and policies live in the database. Which merchants a company's card pays,
 * how its provider spells them, and where their receipts are mailed from is that company's, so it is rows in the
 * store (`../../store/schema/spendMerchant.ts`) and never a list in code. An install that registers none still gets a
 * per-merchant total: each charge groups under its own merchant string.
 *
 * ## One merchant string, at most one merchant — by construction
 *
 * A prefix matches a merchant string at a WORD boundary ({@link isWordPrefix}): `openai` matches `OPENAI *CHATGPT`
 * and never `openaix`. The parser refuses any document where one prefix is a word-boundary prefix of another, within
 * one merchant or across two, so no classification ever depends on row order: if a string matched two prefixes, the
 * shorter would be a word-boundary prefix of the longer, which is exactly what was refused.
 */
import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";

import { type SpendMerchantError, SpendMerchantErrors } from "./errors.js";

/** A merchant slug: lowercase letters, digits and hyphens, opening on a letter or digit. */
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/**
 * A lowercase DNS name with at least one dot, every label letters, digits and inner hyphens. A receipt domain is
 * interpolated into a Gmail query, so nothing but a bare name may enter the store.
 */
const RECEIPT_DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * A character that continues a word, so a prefix ending before one is not a whole-word match — the same set as a
 * regex `\b` over lowercased text, underscore included.
 */
const WORD_CHARACTER = /[a-z0-9_]/;

/** One merchant this install registers. */
export interface SpendMerchant {
  /** The name a report groups the merchant's charges under. */
  readonly slug: string;
  /** Normalised merchant-string prefixes the card provider bills it under. */
  readonly prefixes: readonly string[];
  /** The domains its receipt mail comes from; empty when no receipt is ever searched for. */
  readonly receiptDomains: readonly string[];
}

/** The whole register, as `set` takes it and `show --json` prints it. */
export interface SpendMerchantDocument {
  readonly schemaVersion: 1;
  readonly merchants: readonly SpendMerchant[];
}

/** Which group a charge falls in: a registered merchant, or its own merchant string. */
export type MerchantIdentity =
  { readonly kind: "merchant"; readonly slug: string } | { readonly kind: "raw"; readonly merchant: string };

const documentSchema = z.strictObject({
  merchants: z.array(
    z.strictObject({
      prefixes: z.array(z.string()),
      receiptDomains: z.array(z.string().regex(RECEIPT_DOMAIN, "must be a bare lowercase domain with a dot")),
      slug: z.string().regex(SLUG, "must be a lowercase slug of letters, digits and hyphens"),
    }),
  ),
  schemaVersion: z.literal(1),
});

/**
 * One prefix, or one merchant string, as matching compares it: trimmed, lowercased, inner whitespace one space.
 *
 * @param prefix the text as typed or as the provider printed it
 * @returns the normalised text
 */
export function normaliseMerchantPrefix({ prefix }: { prefix: string }): string {
  return prefix.trim().toLowerCase().replaceAll(/\s+/gu, " ");
}

/**
 * Whether `prefix` opens `value` as whole words: equal, or followed by a non-word character, or itself ending on one.
 * Both are already normalised.
 *
 * @param prefix the shorter, normalised text
 * @param value the normalised text it may open
 * @returns true on a whole-word match
 */
function isWordPrefix({ prefix, value }: { prefix: string; value: string }): boolean {
  if (!value.startsWith(prefix)) {
    return false;
  }
  if (value.length === prefix.length) {
    return true;
  }
  const last = prefix.at(-1)!;
  const next = value.charAt(prefix.length);
  return !WORD_CHARACTER.test(last) || !WORD_CHARACTER.test(next);
}

/** One prefix a merchant earlier in the register already claimed. */
interface OwnedPrefix {
  readonly slug: string;
  readonly prefix: string;
}

/**
 * The problems one non-empty prefix has against every prefix registered before it.
 *
 * @param slug the merchant offering the prefix
 * @param owned the prefixes earlier merchants, and earlier prefixes of this one, already claimed
 * @returns one issue per overlap, in registration order
 */
function overlapIssues({
  owned,
  prefix,
  slug,
}: {
  owned: readonly OwnedPrefix[];
  prefix: string;
  slug: string;
}): string[] {
  return owned
    .filter(
      (earlier) =>
        isWordPrefix({ prefix: earlier.prefix, value: prefix }) || isWordPrefix({ prefix, value: earlier.prefix }),
    )
    .map(
      (earlier) =>
        `merchant ${slug}: prefix "${prefix}" overlaps "${earlier.prefix}" of ${earlier.slug}, so a charge could ` +
        "match both",
    );
}

/**
 * The problems one merchant's prefixes carry: an empty one, or one overlapping a prefix already claimed. Every
 * non-empty prefix is appended to `owned`, so the next merchant is checked against it.
 *
 * @param owned the running claim list this call extends
 * @returns the merchant's prefix issues, in prefix order
 */
function prefixIssues({ merchant, owned }: { merchant: SpendMerchant; owned: OwnedPrefix[] }): string[] {
  const issues: string[] = [];
  for (const prefix of merchant.prefixes) {
    if (prefix === "") {
      issues.push(`merchant ${merchant.slug}: a prefix is empty`);
      continue;
    }
    issues.push(...overlapIssues({ owned, prefix, slug: merchant.slug }));
    owned.push({ prefix, slug: merchant.slug });
  }
  return issues;
}

/** Every problem the schema cannot see: empty or overlapping prefixes, repeated slugs and domains. */
function documentIssues({ merchants }: { merchants: readonly SpendMerchant[] }): string[] {
  const issues: string[] = [];
  const slugs = new Set<string>();
  const owned: OwnedPrefix[] = [];
  for (const merchant of merchants) {
    if (slugs.has(merchant.slug)) {
      issues.push(`merchant ${merchant.slug}: the slug is registered twice`);
    }
    slugs.add(merchant.slug);
    if (new Set(merchant.receiptDomains).size !== merchant.receiptDomains.length) {
      issues.push(`merchant ${merchant.slug}: a receipt domain is listed twice`);
    }
    issues.push(...prefixIssues({ merchant, owned }));
  }
  return issues;
}

/**
 * Validate a register offered for storage, or read back from it, into its canonical form: prefixes normalised,
 * merchants in slug order. Every problem is named at once.
 *
 * @param value the untrusted document
 * @returns the canonical document, or `SPEND_MERCHANT_INVALID` naming every problem
 */
export function parseSpendMerchantDocument({
  value,
}: {
  value: unknown;
}): Result<SpendMerchantDocument, SpendMerchantError> {
  const parsed = documentSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const where = issue.path.length === 0 ? "document" : issue.path.join(".");
      return `${where}: ${issue.message}`;
    });
    return err(SpendMerchantErrors.invalid({ issues }));
  }
  const merchants = parsed.data.merchants
    .map((merchant) => ({
      prefixes: merchant.prefixes.map((prefix) => normaliseMerchantPrefix({ prefix })),
      receiptDomains: merchant.receiptDomains,
      slug: merchant.slug,
    }))
    .toSorted((left, right) => left.slug.localeCompare(right.slug));
  const issues = documentIssues({ merchants });
  if (issues.length > 0) {
    return err(SpendMerchantErrors.invalid({ issues }));
  }
  return ok({ merchants, schemaVersion: 1 });
}

/**
 * The group one merchant string falls in.
 *
 * @param merchant the merchant exactly as the provider printed it
 * @param merchants the install's registered merchants
 * @returns the registered merchant whose prefix opens it, else the trimmed string itself
 */
export function merchantIdentityOf({
  merchant,
  merchants,
}: {
  merchant: string;
  merchants: readonly SpendMerchant[];
}): MerchantIdentity {
  const value = normaliseMerchantPrefix({ prefix: merchant });
  const hit = merchants.find((row) => row.prefixes.some((prefix) => isWordPrefix({ prefix, value })));
  if (hit === undefined) {
    return { kind: "raw", merchant: merchant.trim() };
  }
  return { kind: "merchant", slug: hit.slug };
}

/**
 * A map key for one identity that carries its kind, so a registered `acme` and a raw `acme` never merge.
 *
 * @param identity the group
 * @returns the key
 */
export function merchantIdentityKey({ identity }: { identity: MerchantIdentity }): string {
  if (identity.kind === "merchant") {
    return `merchant:${identity.slug}`;
  }
  return `raw:${identity.merchant}`;
}

/**
 * What a report calls one group.
 *
 * @param identity the group
 * @returns the slug, or the merchant string
 */
export function merchantIdentityLabel({ identity }: { identity: MerchantIdentity }): string {
  if (identity.kind === "merchant") {
    return identity.slug;
  }
  return identity.merchant;
}

/**
 * The registered merchant an identity names.
 *
 * @param identity the group
 * @param merchants the install's registered merchants
 * @returns the merchant, or undefined for a raw merchant string
 */
export function registeredMerchantOf({
  identity,
  merchants,
}: {
  identity: MerchantIdentity;
  merchants: readonly SpendMerchant[];
}): SpendMerchant | undefined {
  if (identity.kind === "raw") {
    return undefined;
  }
  return merchants.find((row) => row.slug === identity.slug);
}

/**
 * The lines `spend merchants show` prints for a person.
 *
 * @param document the register
 * @returns one line per merchant, or one saying there are none
 */
export function merchantRegisterLines({ document }: { document: SpendMerchantDocument }): readonly string[] {
  if (document.merchants.length === 0) {
    return ["spend merchants: none registered"];
  }
  return [
    `spend merchants: ${String(document.merchants.length)} registered`,
    ...document.merchants.map((merchant) => {
      const prefixes = merchant.prefixes.map((prefix) => `"${prefix}"`).join(", ");
      const domains = merchant.receiptDomains.length === 0 ? "(no receipt search)" : merchant.receiptDomains.join(", ");
      return `  ${merchant.slug}  prefixes ${prefixes}  receipts from ${domains}`;
    }),
  ];
}
