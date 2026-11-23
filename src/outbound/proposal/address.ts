/**
 * Where ONE published proposal lives — a provider-tagged address, the same shape whichever destination wrote it.
 *
 * The destination (`./destination.ts`) is where an install publishes NEXT; an address is where a proposal
 * already IS. The intake and the register both hold one, so a re-publish updates the artifact it made, a
 * teaser links it, and drift reads its edit time — none of which may assume the artifact is a Notion page.
 *
 * ## The provider is part of the identity
 *
 * Two providers can mint the same id, so an address is `(provider, id)`, never a bare id. `url` is optional
 * because not every destination hands one back; where it is absent a reader prints `provider:id`.
 *
 * ## Legacy rows are a NOTION address, decided by field presence
 *
 * Every record written before this shape carried `pageId`/`pageUrl`, and every one of them was a Notion page,
 * because Notion was the only door. So a row with no `address` key and a legacy page id IS a Notion address —
 * an explicit schema-version branch, not a default. A row that carries `address` is read strictly from it and
 * never rescued from legacy keys: a malformed new-format row is unreadable, never quietly Notion.
 */
import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";
import { strictForm } from "../strictForm.js";

/** Every provider a published proposal can live on. */
const PROPOSAL_PROVIDERS = ["notion", "linear", "local"] as const;

/** A provider a published proposal can live on. */
export type ProposalProvider = (typeof PROPOSAL_PROVIDERS)[number];

/** An id or URL: present, with no Unicode whitespace (`\p{White_Space}`, which `\s` under-covers). */
const addressPart = z
  .string()
  .min(1)
  .refine((value) => !/\p{White_Space}/u.test(value), { message: "must not contain whitespace" });

/** The strict wire shape of an address, as the intake and the register journal hold it. */
const proposalAddressSchema = strictForm({
  id: addressPart,
  provider: z.enum(PROPOSAL_PROVIDERS),
  url: addressPart.optional(),
});

/** Where one published proposal lives. */
export type ProposalAddress = z.infer<typeof proposalAddressSchema>;

/**
 * Read an address off parsed JSON, strictly.
 *
 * @param raw the value under an `address` key
 * @returns the address, or one line per schema issue
 */
export function parseProposalAddress({ raw }: { raw: unknown }): Result<ProposalAddress> {
  const parsed = proposalAddressSchema.safeParse(raw);
  if (parsed.success) {
    return ok(parsed.data);
  }
  return err(
    parsed.error.issues.map((issue) =>
      issue.path.length === 0 ? issue.message : `${issue.path.join(".")}: ${issue.message}`,
    ),
  );
}

/**
 * The Notion address a `pageId`/`pageUrl` pair names — what `notion page` reports writing, and what every
 * legacy record's page fields meant.
 *
 * @param pageId the Notion page id
 * @param pageUrl the page URL, when one was reported or recorded
 * @returns the equivalent provider-tagged address
 */
export function notionPageAddress({
  pageId,
  pageUrl,
}: {
  pageId: string;
  pageUrl: string | undefined;
}): ProposalAddress {
  if (pageUrl === undefined) {
    return { id: pageId, provider: "notion" };
  }
  return { id: pageId, provider: "notion", url: pageUrl };
}

/**
 * The key two addresses share exactly when they name the same artifact.
 *
 * A Notion page id has two spellings, dashed UUID and compact hex, in either case, and Notion treats them as
 * one page, so a Notion id is keyed lowercased with its dashes removed. Every other provider's id is opaque
 * here and keyed as written.
 *
 * @param address the address to key
 * @returns `provider:id`, with a Notion id in its canonical compact form
 */
export function addressIdentityKey({ address }: { address: ProposalAddress }): string {
  if (address.provider === "notion") {
    return `notion:${address.id.toLowerCase().replaceAll("-", "")}`;
  }
  return `${address.provider}:${address.id}`;
}

/**
 * What a reader is shown for an address: its URL, or `provider:id` when the destination handed none back.
 *
 * @param address the published address
 * @returns one printable token
 */
export function addressLabel({ address }: { address: ProposalAddress }): string {
  if (address.url === undefined) {
    return `${address.provider}:${address.id}`;
  }
  return address.url;
}
