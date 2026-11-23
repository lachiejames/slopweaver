/**
 * The ONE key list of Claude's `GET /api/oauth/usage` answer, shared by both readers of it: `claude reset`
 * (`./resetStatus.ts`, the `cedar_ember` block) and `claude spend` (`./spendStatus.ts`, the `extra_usage` block).
 * Pure.
 *
 * Each reader spreads {@link USAGE_SIBLINGS} into its own strict object and adds the two blocks a reader may read,
 * declaring the one it does not read `unread`. So a key the provider adds is loud in both, and the list cannot
 * drift between two copies, because there is one.
 *
 * MEASURED on a Max subscription: the unskipped answer carries exactly
 * these keys plus `cedar_ember` and `extra_usage`; reproduce with `slopweaver claude spend --plan <alias>`, whose
 * refusal names any key the provider has since added.
 */
import { z } from "zod";

/**
 * A key a reader declares and does not read. Its ABSENCE is not loud, because nothing reads it and whether each
 * is sent for every account state is unmeasured; a key NOT declared still is.
 */
export const unread = z.unknown().optional();

/**
 * Every key of the answer but `cedar_ember` and `extra_usage`, each declared and unread. Most are experiment
 * codenames, so this is the part of the boundary the provider moves most often, and a refusal naming one is fixed
 * by declaring it here — once, for both readers.
 */
export const USAGE_SIBLINGS = {
  amber_cistern: unread,
  amber_cistern_offer: unread,
  amber_gauge: unread,
  amber_ladder: unread,
  brass_thimble: unread,
  cinder_cove: unread,
  copper_kite: unread,
  five_hour: unread,
  granite_teacup: unread,
  harbor_lantern: unread,
  iguana_necktie: unread,
  juniper_tide: unread,
  limits: unread,
  member_dashboard_available: unread,
  nimbus_quill: unread,
  omelette_promotional: unread,
  pace: unread,
  promo_credits: unread,
  seven_day: unread,
  seven_day_breakdown: unread,
  seven_day_cowork: unread,
  seven_day_oauth_apps: unread,
  seven_day_omelette: unread,
  seven_day_opus: unread,
  seven_day_sonnet: unread,
  spend: unread,
  starry_waterfall: unread,
  tangelo: unread,
  wattle_ember: unread,
  weekly_scoped_shares: unread,
} as const;
