/**
 * The shape of one credential register row — what every category file under `src/secrets/credentials/`
 * declares its rows as, and what `src/secrets/registry.ts` re-exports as {@link CredentialSpec}.
 *
 * ## What each field is FOR, and which of them a machine checks
 *
 * The register is not documentation that happens to be typed. `src/devLint/secretsRegistry.ts` fails when
 * {@link CredentialSpec.reader} names a module that does not resolve the credential, when a `retired` entry
 * turns out to have a reader after all, and when `docs/security/credentials.md`'s table stops matching these rows cell
 * for cell. So `reader` and `lifecycle` are CHECKED CLAIMS; `platform`, `what` and `usedFor` are prose.
 *
 * `platform` is ALSO a grouping, and that half is read by code: the `secret-absent` monitor
 * (`src/monitor/secretAbsent.ts`) cards a live settable row that is absent while another live row with the
 * identical `platform` string is stored — a split that added a row nobody set. Two optional fields steer it and
 * change nothing in the doc table: {@link CredentialSpec.optional} says an absent file is a supported
 * configuration, and {@link CredentialSpec.absentMattersWith} links a row platform prose cannot group.
 *
 * {@link CredentialSpec.mintScope} is the one field no machine here can check, because it is a property of
 * how the owner minted the credential in somebody else's console rather than of anything on this disk. It
 * therefore carries `"unverified"` as a first-class value: a register that GUESSED at a scope would be
 * worse than one that says which rows nobody has confirmed. Do not silently promote an `"unverified"` row —
 * check the provider's console and record what you saw.
 */

/** How a credential is stored, which decides whether `secrets set` can write it at all. */
type CredentialShape =
  /** One non-empty line of text — the shape `secrets set` captures and `normaliseSecretInput` enforces. */
  | "line"
  /**
   * A whole FILE the owner installs by hand — a service-account key, say. `secrets set` cannot write one
   * (`normaliseSecretInput` refuses a multi-line value) and no verb here mints or refreshes it, which is
   * what separates it from a `grant`: a grant is an OAuth round trip this product performed and caches.
   */
  | "file"
  /** An owner-only JSON grant a `connect` verb writes: refresh token, approved scopes, bound account. */
  | "grant";

/** Whether the credential can only READ at the provider — the one claim here no local check can settle. */
type MintScope =
  /** Minted with read scopes only; nothing slopweaver holds can change the provider's state. */
  | "read-only"
  /** Carries at least one write scope, and a slopweaver verb uses it — the write is the point. */
  | "read-write"
  /** Not a credential at all: a host, a slug or an id stored here only because it names the organisation. */
  | "not-a-credential"
  /** Nobody has confirmed how this was minted. Stated rather than guessed — see this file's header. */
  | "unverified";

/** What, if anything, is known about when the credential stops working. */
type ExpiryKind =
  /** No expiry is recorded anywhere, and the provider issues none this install knows of. */
  | "none"
  /** The provider set one at mint time; it is not recorded on disk, so only the console can say when. */
  | "at-mint"
  /** A grant file's cached access token carries `expiryMs`, refreshed automatically on the next call. */
  | "grant-cache"
  /** Nobody has confirmed whether the provider issues one. Stated rather than guessed, as `mintScope` is. */
  | "unverified";

/** Whether a credential is still read by anything, and therefore whether it is worth keeping. */
type Lifecycle =
  /** Something in `src/` resolves it today — {@link CredentialSpec.reader} names what. */
  | "live"
  /** Nothing reads it. The file is dead weight, and the register says so instead of the owner finding out. */
  | "retired";

/** One credential the store may hold — everything the install can say about it WITHOUT reading its value. */
export interface CredentialSpec {
  /** The file name under `$SLOPWEAVER_HOME/secrets`. */
  readonly name: string;
  /** Whose credential it is, as the owner would name the product. */
  readonly platform: string;
  /** What the value IS, in one clause — the token family, not what it is used for. */
  readonly what: string;
  /** What slopweaver does with it. This is the cell `docs/security/credentials.md`'s table carries. */
  readonly usedFor: string;
  /** Whether it is read-only at mint. `"unverified"` is a real answer here — see the file header. */
  readonly mintScope: MintScope;
  /** How it is stored, which decides whether `secrets set` may write it. */
  readonly shape: CredentialShape;
  /** Whether `secrets set` accepts this name. Grant files and retired names are deliberately not settable. */
  readonly settable: boolean;
  /** Whether anything still reads it. */
  readonly lifecycle: Lifecycle;
  /** The repo-relative module that resolves it, or `null` for a `retired` entry. Gate-checked both ways. */
  readonly reader: string | null;
  /** Which verbs read it, as the owner would type them. */
  readonly readVerbs: string;
  /** What is known about its expiry. */
  readonly expiry: ExpiryKind;
  /**
   * How the value gets into the store in the first place. On every live settable row this is exactly
   * `slopweaver secrets set <name>` — `unit/secrets/registry.test.ts` pins it — which is what lets the
   * `secret-absent` monitor put it on the owner's pasteboard as the command to run.
   */
  readonly writtenBy: string;
  /**
   * Present when an absent file is a SUPPORTED configuration rather than a gap: something reads it when it is
   * there, and nothing breaks when it is not. No monitor asks for an optional row — `secret-absent`
   * (`src/monitor/secretAbsent.ts`) skips it however many of its siblings are stored.
   */
  readonly optional?: true;
  /**
   * Register rows, beyond those sharing this row's exact {@link CredentialSpec.platform}, whose being stored makes
   * THIS row's absence matter — a link platform prose cannot draw. `backup-passphrase` is the case: its platform
   * is the operator's own password manager, which no other row names, yet a stored backup destination with no passphrase is a
   * nightly backup running without its credentials leg. Directional: the rows named here are evidence for this
   * one, never the reverse. `unit/secrets/registry.test.ts` asserts every name resolves to a live row.
   */
  readonly absentMattersWith?: readonly string[];
  /**
   * The exact form a value must take, where one is knowable — `secrets set` refuses a value that does not
   * match, before anything is written. Measured: a `google-secops-client-id` pasted through
   * `secrets set` was stored as `http://<id>/`, because the paste had been autolinked, and the first consent
   * URL carried a `client_id` Google would reject. Refused rather than repaired: stripping a scheme is a
   * silent guess at what was meant.
   */
  readonly valueShape?: { readonly pattern: RegExp; readonly describe: string };
}
