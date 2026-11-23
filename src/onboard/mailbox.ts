/**
 * The organisation-owned mailbox an assistant plan signs up on, as a STEP of `slopweaver onboard`.
 *
 * ## The question this answers
 *
 * Can anyone on their own work laptop install the plugin, run /slopweaver:onboard and have it provision uniform
 * emails for them? Yes, and the uniformity is in code: `../alias/address.ts` holds
 * every address to `<identity>-<provider>-<label>@<zone>` and refuses one it could not read back. What was
 * missing was the STEP. `onboard` declared five corpus sources and nothing else, so a person installing the
 * plugin on their own work laptop finished the whole flow without learning the mailbox existed.
 *
 * ## Why this DERIVES and names, and never writes
 *
 * `../../cli/manifests/onboard.ts` says of this verb, literally, that it "reads no state home, holds no
 * token, touches no network and writes no file", which is why it is `dryParseSafe` and needs no door.
 * Performing the Cloudflare write here would flip its effect to `external-write`, break that, and — the
 * point — require a Cloudflare token on the laptop, which is the one credential this whole step argues
 * against carrying. So the write stays in `slopweaver alias provision`, and `onboard` does for the mailbox
 * exactly what it already does for the Slack app and the Google OAuth client: names the step, derives what
 * it can, prints the one command.
 *
 * ## The one thing everyone gets wrong about the catch-all
 *
 * A catch-all reads as "the shape that needs no per-seat step", and it is — but it has **one destination for
 * the whole zone** (`../cli/commands/alias/core.ts`'s `AliasCatchAllOptions` carries a single `destination`,
 * and Cloudflare replaces the zone's rule wholesale). So it expresses *uniform addresses into one shared
 * mailbox* and cannot express *each person's alias into their own*. The second needs a rule per seat, hence
 * a token carrying Zone · Email Routing Rules · Edit, which reaches every zone on the account. Both halves
 * are printed at the point of choice, because somebody who turns a zone-wide catch-all on expecting
 * per-person delivery has made a wide write that does not do what they think.
 *
 * Pure: no I/O, no clock, no network. Nothing here can emit a token, a zone or a mailbox it was not given.
 */

import { ALIAS_PROVIDERS, type AliasProvider, aliasAddress } from "../alias/address.js";

/**
 * The label of the seat `onboard` derives.
 *
 * Onboarding is by definition somebody's first provisioned seat, so the label is fixed rather than asked
 * for — a third question to name a value that is `one` every time is a cost with no answer behind it. Later
 * seats say so explicitly on the `alias provision` command line, which the block prints.
 */
export const FIRST_SEAT_LABEL = "one";

/** The flag that names whose plan the address is for. */
export const IDENTITY_FLAG = "--identity";

/** The flag that names the Cloudflare zone the address lives on. */
export const MAILBOX_ZONE_FLAG = "--mailbox-zone";

/** The placeholder a command carries where `onboard` has a value it cannot verify and must not assert. */
const MAILBOX_PLACEHOLDER = "<verified mailbox>";

/**
 * One derived address: which assistant it is for, and what it reads as.
 *
 * @internal — the element type of {@link MailboxPlan}'s `seats`; every reader reaches it through the plan.
 */
export interface MailboxSeat {
  readonly provider: AliasProvider;
  /** `<identity>-<provider>-one@<zone>`, built by {@link ../alias/address.aliasAddress}, never re-joined here. */
  readonly address: string;
}

/**
 * What `onboard` can say about the mailbox, given what it was told.
 *
 * Three states rather than a bag of optional fields, because each one renders completely differently: no
 * flags means teach the shape and name the flags; bad flags means show the refusal the real verb would have
 * given; good flags means show the person their own two addresses.
 */
export type MailboxPlan =
  | {
      readonly kind: "unasked";
      /** The flags that were not given, in the order the usage line lists them. */
      readonly missing: readonly string[];
    }
  | {
      readonly kind: "refused";
      /** `aliasAddress`'s own message, so `onboard` and `alias provision` refuse in identical words. */
      readonly why: string;
    }
  | {
      readonly kind: "derived";
      readonly identity: string;
      readonly zone: string;
      /** One seat per provider, in {@link ../alias/address.ALIAS_PROVIDERS} order. */
      readonly seats: readonly MailboxSeat[];
    };

/**
 * Decide what the mailbox block can say.
 *
 * @param identity whose plan it is, from `--identity`, or undefined when it was not given
 * @param zone the Cloudflare zone, from `--mailbox-zone`, or undefined when it was not given
 * @returns the plan the block renders from
 */
export function mailboxPlan({
  identity,
  zone,
}: {
  identity: string | undefined;
  zone: string | undefined;
}): MailboxPlan {
  const missing: string[] = [];
  if (identity === undefined) {
    missing.push(IDENTITY_FLAG);
  }
  if (zone === undefined) {
    missing.push(MAILBOX_ZONE_FLAG);
  }
  if (identity === undefined || zone === undefined) {
    return { kind: "unasked", missing };
  }
  const seats: MailboxSeat[] = [];
  for (const provider of ALIAS_PROVIDERS) {
    const built = aliasAddress({ identity, label: FIRST_SEAT_LABEL, provider, zone });
    if (built.isErr()) {
      return { kind: "refused", why: built.error.message };
    }
    seats.push({ address: built.value.address, provider });
  }
  return { identity, kind: "derived", seats, zone };
}

/**
 * The `alias provision` command for one seat, built from the plan's own parts so the printed command and
 * the printed address can never disagree.
 *
 * The destination stays a placeholder: `onboard` cannot verify a mailbox, and a value it cannot verify is
 * one it should not assert — Cloudflare refuses an unverified destination anyway
 * (`DESTINATION_UNVERIFIED`), and writes nothing when it does.
 *
 * @param provider which assistant the seat is for
 * @param identity whose plan it is
 * @param zone the zone the address lives on
 * @returns the command, as one line
 */
export function provisionCommand({
  provider,
  identity,
  zone,
}: {
  provider: AliasProvider;
  identity: string;
  zone: string;
}): string {
  return (
    `slopweaver alias provision --domain ${zone} --identity ${identity} ` +
    `--provider ${provider} --label ${FIRST_SEAT_LABEL} --destination ${MAILBOX_PLACEHOLDER}`
  );
}

/**
 * The `alias catch-all` command for one zone, built the same way.
 *
 * @param zone the zone whose catch-all is being pointed
 * @returns the command, as one line
 */
export function catchAllCommand({ zone }: { zone: string }): string {
  return `slopweaver alias catch-all --domain ${zone} --enable --destination ${MAILBOX_PLACEHOLDER}`;
}

/**
 * The `alias list` probe for one zone — the read that says whether the token sees the zone at all.
 *
 * A builder rather than a literal for the reason the other two are: it is the FIRST command the block tells
 * anybody to run, and spelling it by hand left it printing `--domain <zone>` beside two sibling commands
 * that had the real zone interpolated. Somebody copying the block top to bottom ran a placeholder.
 *
 * @param zone the zone to read the routing rules of
 * @returns the command, as one line
 */
export function listCommand({ zone }: { zone: string }): string {
  return `slopweaver alias list --domain ${zone}`;
}

/** The zone shown in a command when the reader has not named one — never a real zone this install holds. */
const EXAMPLE_ZONE = "<your zone>";

/** The identity shown in a command when `--identity` was not given. */
const EXAMPLE_IDENTITY = "<your-name>";

/** What the block says about the addresses themselves, which differs completely per plan state. */
function addressLines({ plan }: { plan: MailboxPlan }): readonly string[] {
  if (plan.kind === "unasked") {
    return [
      `  Run it again with ${plan.missing.join(" and ")} and this block prints YOUR addresses instead of the shape.`,
      `    slopweaver onboard ${IDENTITY_FLAG} <your-name> ${MAILBOX_ZONE_FLAG} <a zone your org holds>`,
      "",
      "  The shape, which is the same for everybody:",
      `    <identity>-claude-${FIRST_SEAT_LABEL}@<zone>      <identity>-codex-${FIRST_SEAT_LABEL}@<zone>`,
    ];
  }
  if (plan.kind === "refused") {
    return [
      "  Those flags cannot make an address that can be read back, so nothing is derived:",
      `    ${plan.why}`,
      "  This is the same refusal `slopweaver alias provision` would have given, in the same words.",
    ];
  }
  return [
    `  Your addresses, on ${plan.zone}:`,
    ...plan.seats.map((seat) => `    ${seat.address.padEnd(44)}the ${seat.provider} plan`),
  ];
}

/**
 * The zone every command in the block is spelled with — the real one once it is known, the placeholder
 * until then. Asked ONCE, so two commands in one block can never disagree about which zone they are for.
 */
function zoneFor({ plan }: { plan: MailboxPlan }): string {
  return plan.kind === "derived" ? plan.zone : EXAMPLE_ZONE;
}

/**
 * The identity every command in the block is spelled with, on the same contract as {@link zoneFor}.
 *
 * A plan that is not `derived` has no identity at all — a half-given pair does not derive — so a command
 * showing a real name beside a placeholder zone would claim a derivation the block above it did not make.
 */
function identityFor({ plan }: { plan: MailboxPlan }): string {
  return plan.kind === "derived" ? plan.identity : EXAMPLE_IDENTITY;
}

/** The two delivery shapes, with the command each one takes filled in as far as the plan allows. */
function deliveryLines({ plan }: { plan: MailboxPlan }): readonly string[] {
  const zone = zoneFor({ plan });
  const identity = identityFor({ plan });
  return [
    "  Two ways a zone can deliver them, and they are NOT interchangeable",
    "",
    "    CATCH-ALL — one admin write, once per zone, and after it nobody needs a Cloudflare token or a",
    "      per-seat command ever again. The catch is that a catch-all has ONE destination for the WHOLE",
    "      zone: every address on it, minted or not, lands in the same mailbox. That is uniform addresses",
    "      into a SHARED inbox, and it is the shape that genuinely works on anybody's laptop.",
    `      ${catchAllCommand({ zone })}`,
    "",
    "    PER SEAT — one forwarding rule per address, and the only shape that can send each person's mail to",
    "      their OWN mailbox. It needs a Cloudflare token carrying Zone · Email Routing Rules · Edit, and",
    "      that token reaches every zone on the account — an admin credential, so expect an admin to run",
    "      this rather than to hand you one.",
    `      ${provisionCommand({ identity, provider: "claude", zone })}`,
    "",
  ];
}

/**
 * The whole mailbox block — what the address is for, the person's own two addresses when it can derive
 * them, the two delivery shapes with their costs, and the one-time steps that gate both.
 *
 * @param plan what `onboard` was told, already decided by {@link mailboxPlan}
 * @returns the lines to print, in order
 */
export function mailboxLines({ plan }: { plan: MailboxPlan }): readonly string[] {
  return [
    "The mailbox your NEXT assistant plan signs up on",
    "  A Claude or ChatGPT plan should sign up on an address the ORGANISATION owns rather than a personal",
    "  one, so the data behind it is not sitting on somebody's personal account. The address shape is the",
    "  same for every person and every plan — <identity>-<provider>-<label>@<zone> — and the identity leads",
    "  so the routing rules alone answer whose plan a seat is, and whether it can be cancelled.",
    "",
    "  You are reading this from a session running on a plan you already hold, so this step cannot be about",
    `  that one. It is the NEXT seat: your first provisioned one is labelled \`${FIRST_SEAT_LABEL}\`, and later`,
    "  ones are `--label two`, `three`, and so on.",
    "",
    ...addressLines({ plan }),
    "",
    ...deliveryLines({ plan }),
    "  Both shapes are gated by the same two one-time facts, and each REFUSES rather than half-writing",
    "    · Email Routing must be ON for the zone — Cloudflare dashboard → the zone → Email → Email Routing.",
    "      Until it is, `alias provision` refuses with ROUTING_DISABLED and writes nothing.",
    "    · The destination must be VERIFIED: Cloudflare mails a code there once and somebody follows it.",
    "      Until it is, `alias provision` refuses with DESTINATION_UNVERIFIED and writes nothing.",
    "  And one probe that says which of them you are looking at — the cheapest read of whether your token",
    "  sees the zone at all. A 403 here is the missing Edit scope, not a defect.",
    `    ${listCommand({ zone: zoneFor({ plan }) })}`,
    "",
    "  `onboard` writes NONE of this — it derives the address and names the command, the same way it does",
    "  for the Slack app and the Google OAuth client. The signup itself stays a hand step on purpose:",
    '  Anthropic\'s Usage Policy names "utilize automation in account creation" under Do Not Abuse our',
    "  Platform, so no verb here drives it.",
    "",
  ];
}
/**
 * The mailbox stanza of `onboard`'s command list — the probe, and one command per delivery shape.
 *
 * It lives here rather than in `./render.ts` for the reason every other line in this file does: these
 * commands are BUILT from the same parts the address block prints the address from, so a stanza here can
 * never name a different identity or zone than the seat it provisions. It is its own stanza, and last,
 * because nothing else in the flow needs it — the corpus, the derive, the distil and the first answer all
 * work on an install that never provisions an address.
 *
 * It takes the PLAN rather than the two raw flags for that same reason. Given `--identity` and no
 * `--mailbox-zone`, raw flags would print a real name beside a placeholder zone while the block above —
 * which does not derive from half a pair — printed placeholders for both, so one session's output would
 * show two different identities for one seat.
 *
 * @param plan the same derivation {@link mailboxLines} rendered, so the two can never disagree
 * @returns the stanza's lines, opening with a blank one so it separates itself from what came before
 */
export function mailboxCommandLines({ plan }: { plan: MailboxPlan }): readonly string[] {
  const zone = zoneFor({ plan });
  const identity = identityFor({ plan });
  return [
    "",
    "  # the mailbox your NEXT assistant plan signs up on — optional; nothing above needs it",
    `  ${listCommand({ zone })}`,
    "                                                    # the cheapest probe: can your token see the zone?",
    "                                                    # a 403 is the missing Zone · Email Routing Rules · Edit",
    `  ${catchAllCommand({ zone })}`,
    "                                                    # ONE destination for the WHOLE zone — shared inbox",
    `  ${provisionCommand({ identity, provider: "claude", zone })}`,
    "                                                    # per seat, so each person's mail can go to their own",
    "                                                    # mailbox — this is the one that needs the Edit scope",
  ];
}
