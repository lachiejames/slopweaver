/**
 * Where THIS install publishes a proposal — one strict tagged value, held in the store rather than the code.
 *
 * The proposal itself is one typed form and one rendered document whatever its destination. Which workspace
 * that document lands in is a property of the installation (one team keeps proposals in Notion, another in a
 * Linear document, another on a local page), so it is declared once with `proposal destination set` and read
 * by `proposal publish` on every run. Nothing about a destination is a constant in this repository.
 *
 * ## One tagged value, not a bag of optional ids
 *
 * Each arm is the exact input its door needs and nothing else, so a value naming two destinations, or a
 * destination missing the id its door requires, is unrepresentable rather than checked after the fact. A
 * destination is added by adding an ARM here and an adapter beside the publish verb — never by a flag on the
 * proposal form, which stays one.
 *
 * ## Strict, and versioned
 *
 * An unknown key is REFUSED (`strictForm`), because a hand-edited file carrying `parnet` would otherwise parse
 * as a destination with no parent at all. `schemaVersion` is a literal so a file written by a later build is
 * named as such instead of being read under the wrong shape.
 */
import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";
import { parseNotionReadAddress } from "../../live/notion/read.js";
import type { LinearDocumentDestinationKind } from "../linear/documentTypes.js";
import { strictForm } from "../strictForm.js";
import type { ProposalProvider } from "./address.js";
import { type ProposalDestinationError, ProposalDestinationErrors } from "./destinationErrors.js";

/** The one schema version this build writes and reads. */
export const PROPOSAL_DESTINATION_SCHEMA_VERSION = 1;

/** A provider id or URL: present, and carrying no whitespace a shell or a provider would split on. */
const addressText = z
  .string()
  .min(1, { abort: true })
  // `\p{White_Space}`, not `\s`: `\s` omits U+0085 NEXT LINE, which is Unicode whitespace.
  .refine((value) => !/\p{White_Space}/u.test(value), { abort: true, message: "must not contain whitespace" });

/**
 * A Notion page address the Notion door will accept — judged by that door's OWN parser, so `destination set`
 * can never store a parent a first live publish then refuses, and no second notion of a valid address drifts.
 */
const notionPageAddress = addressText.refine(
  (value) => parseNotionReadAddress({ address: value, kind: "page" }).isOk(),
  {
    message:
      "must be a Notion page UUID or a https://*.notion.so/... or https://app.notion.com/... URL ending in its 32-hex id",
  },
);

/** A Notion page: each proposal is created as a child of `parent`, inheriting its permissions. */
const notionPageArm = strictForm({
  kind: z.literal("notion-page"),
  parent: notionPageAddress,
  schemaVersion: z.literal(PROPOSAL_DESTINATION_SCHEMA_VERSION),
});

/**
 * A local page under the state home's `pages/`, through the same page door `slopweaver page publish` uses. It
 * needs no input: the page's slug comes from the proposal itself, so there is nothing per-install to name.
 */
const localPageArm = strictForm({
  kind: z.literal("local-page"),
  schemaVersion: z.literal(PROPOSAL_DESTINATION_SCHEMA_VERSION),
});

/** The Linear entity kinds a document can belong to — the Linear document door's own set. */
export const LINEAR_TARGET_KINDS = [
  "initiative",
  "issue",
  "project",
  "team",
] as const satisfies readonly LinearDocumentDestinationKind[];

/**
 * A Linear document, created under one Linear entity through the `linear document` door. `target` is exactly
 * the destination that door's form carries, so a stored destination can never name one the door refuses.
 */
const linearDocumentArm = strictForm({
  kind: z.literal("linear-document"),
  schemaVersion: z.literal(PROPOSAL_DESTINATION_SCHEMA_VERSION),
  target: strictForm({ id: addressText, kind: z.enum(LINEAR_TARGET_KINDS) }),
});

/** Every destination an install can choose. One arm per door a proposal can be published through. */
export const proposalDestinationSchema = z.discriminatedUnion("kind", [notionPageArm, localPageArm, linearDocumentArm]);

/** The install's chosen destination, exactly as `destination.json` holds it. */
export type ProposalDestination = z.infer<typeof proposalDestinationSchema>;

/** Every destination kind this build knows, for usage text and refusals. */
export const PROPOSAL_DESTINATION_KINDS: readonly ProposalDestination["kind"][] = [
  "notion-page",
  "local-page",
  "linear-document",
];

/** The provider each destination kind publishes onto — a total record, so a new arm cannot compile without one. */
const DESTINATION_PROVIDER: Readonly<Record<ProposalDestination["kind"], ProposalProvider>> = {
  "linear-document": "linear",
  "local-page": "local",
  "notion-page": "notion",
};

/**
 * The provider a destination publishes onto, which a recorded address is compared against before a re-publish.
 *
 * @param destination the configured destination
 * @returns the provider every proposal published there lives on
 */
export function proposalDestinationProvider({ destination }: { destination: ProposalDestination }): ProposalProvider {
  return DESTINATION_PROVIDER[destination.kind];
}

/** The command that sets a destination — quoted by every refusal that finds none, so the fix is one paste. */
export const PROPOSAL_DESTINATION_SET_HINT =
  "slopweaver proposal destination set notion-page --parent <page-id-or-url> | local-page | linear-document --target-kind <project|initiative|issue|team> --target-id <id>";

/** Where in the file a schema issue sits: its dotted key path, or `(root)` for the whole value. */
function issuePath({ path }: { path: readonly PropertyKey[] }): string {
  if (path.length === 0) {
    return "(root)";
  }
  return path.map(String).join(".");
}

/**
 * Narrow parsed JSON into a destination, or say exactly why it is not one.
 *
 * @param raw the parsed contents of `destination.json`
 * @param path where it was read from, so the refusal names the file to fix
 * @returns the destination, or `DESTINATION_INVALID` carrying every schema issue
 */
export function parseProposalDestination({
  raw,
  path,
}: {
  raw: unknown;
  path: string;
}): Result<ProposalDestination, ProposalDestinationError> {
  const parsed = proposalDestinationSchema.safeParse(raw);
  if (!parsed.success) {
    return err(
      ProposalDestinationErrors.invalid({
        issues: parsed.error.issues.map((issue) => `${issuePath({ path: issue.path })}: ${issue.message}`),
        path,
      }),
    );
  }
  return ok(parsed.data);
}

/**
 * One line naming a destination for a reader — what `destination show` prints and `publish` reports.
 *
 * @param destination the configured destination
 * @returns e.g. `notion-page under <parent>`, or `local-page under the state home's pages/`
 */
export function describeProposalDestination({ destination }: { destination: ProposalDestination }): string {
  switch (destination.kind) {
    case "notion-page":
      return `${destination.kind} under ${destination.parent}`;
    case "local-page":
      return `${destination.kind} under the state home's pages/`;
    case "linear-document":
      return `${destination.kind} under Linear ${destination.target.kind} ${destination.target.id}`;
  }
}
