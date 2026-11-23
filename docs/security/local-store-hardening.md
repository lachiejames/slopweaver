# Hardening the local store

Part of [Security & trust](../security.md).

**Docker is a requirement, not an option.** The local store is `supabase start` run from this repository
([the local stack](../store/overview-and-local-stack.md#where-the-local-stack-is-and-how-to-open-studio)), and
that stack is a set of Docker containers, so everyone who installs Slopweaver runs Docker: the owner rules it a required dependency of every install.
`slopweaver doctor` grades a machine with neither Docker Desktop nor a `docker` CLI as fatal; it does not check
that a runtime is actually running. Nothing on this page replaces Docker. It is three
things you can do to make the store harder to reach, plus the lock `yarn store:start` applies by itself (§ 4),
and for each one, what it removes and what it does not.
Onboarding offers them once the store exists ([securing the store](../../skills/onboard/reference/securing-the-store.md)).

## 1 · Keep the store's ports on this Mac only

The stack publishes two ports to the host: Postgres on `55322` and the API gateway on `55321` (Storage publishes
nothing, and Mailpit is off). Docker publishes a port on **every** network interface unless
told otherwise ([Docker: port publishing](https://docs.docker.com/engine/network/port-publishing/)), and
`supabase/config.toml` names ports but no bind address — its `[db.network_restrictions]` block is off and allows
every address. So on a default install, another machine on the same network can open a connection to the
store's Postgres and its API gateway. Without the lock (§ 4), no credential of yours stands in front of either: the database
password and the service-role key are the Supabase CLI's own defaults, the same on every install that kept them.
MEASURED: `docker exec supabase_db_slopweaver printenv POSTGRES_PASSWORD` printed `postgres`, and the
service key's claims (`docker exec supabase_storage_slopweaver printenv SERVICE_KEY | cut -d. -f2 | base64 -d`)
name the issuer `supabase-demo`. That makes this the step that matters most.

**The step.** In Docker Desktop's settings, set **Port binding behavior** to local only — the value Docker's
[settings reference](https://docs.docker.com/desktop/enterprise/hardened-desktop/settings-management/settings-reference/#port-binding-behavior)
calls `local-only-port-binding` (its release notes label it "Localhost only"). Use Docker Desktop 4.88.0 or
later: that release "fixed port bindings reported by `docker ps` to accurately reflect active listeners" under
this setting ([Docker Desktop release notes](https://docs.docker.com/desktop/release-notes/)), and the check
below reads `docker ps`, so on an older Desktop its rows prove nothing — update first. MEASURED,
`docker version --format "{{.Server.Platform.Name}}"`: `Docker Desktop 4.91.0`. The setting applies to containers created after it changes, so recreate the
stack: `yarn store:stop && yarn store:start` (`stop` keeps every data volume; only `--no-backup` deletes them;
`store:start` relocks the new containers, § 4).
Another runtime (colima, OrbStack) has its own setting; the check below is the same for all of them.

**The check — the live bindings, never the setting.** A setting is a preference; the bindings are the property.

```bash
docker ps --format "{{.Names}}\t{{.Ports}}"
```

Every published `supabase_*_slopweaver` port must show `127.0.0.1:` or `[::1]:` before its `->`. A
`0.0.0.0:` or `[::]:` is a port any machine that can route to this one may open. A container with no `->` in
its row publishes nothing and needs no binding. MEASURED with that command, on a Docker Desktop whose
setting reads local only: `supabase_db_slopweaver 127.0.0.1:55322->5432/tcp, [::1]:55322->5432/tcp`, the gateway on
`127.0.0.1:55321` and also on `[::1]`, and Storage with no `->`.

**And the engine must honour the binding.** Docker Engine before 28.0.0 let a host on the same network segment
reach a port published to `127.0.0.1` ([Docker: port publishing](https://docs.docker.com/engine/network/port-publishing/)).
So the check is not proven until `docker version --format "{{.Server.Version}}"` reads 28.0.0 or later —
MEASURED, `29.8.0`. An older
engine is upgraded first; a loopback row on one is not a wall. One later hole is narrower: on a **Linux host
running firewalld**, engines 28.2.0 to 28.3.2 lose the protection after a firewalld reload, fixed in 28.3.3
([CVE-2025-54388](https://github.com/moby/moby/security/advisories/GHSA-x4rx-4gw3-53p4), which names Docker
Desktop as unaffected), so a Linux engine on firewalld needs 28.3.3 or later.

**And nothing routes around the binding.** A binding governs the HOST port. Docker can also be told to let
another machine reach a container's own address directly — the daemon option `allow-direct-routing`, or a
per-network bridge option such as a `routed` or `nat-unprotected` gateway mode or `trusted_host_interfaces`
([Docker: port publishing](https://docs.docker.com/engine/network/port-publishing/)) — and a peer with a route
to that subnet then reaches Postgres past every loopback row. Docker's default does none of these. The check is
not a list of options to rule out, which a new Docker release can lengthen, and it reads the whole daemon
configuration only where that is one file:

- **On a Docker Desktop no organisation manages**, the app starts the daemon itself, and the one place you
  configure it is the Docker Engine JSON in its settings (`~/.docker/daemon.json`) — there is no flag of yours on
  its command line. A MANAGED Docker Desktop can also take daemon options from its Settings Management
  (`/Library/Application Support/com.docker.docker/admin-settings.json`, which device management can push, or
  a Docker organisation's Admin Console policy for a signed-in user): its `linuxVM.dockerDaemonOptions`
  "overrides the Docker daemon configuration … without modifying local configuration files"
  ([Docker: Settings Management](https://docs.docker.com/enterprise/security/hardened-desktop/settings-management/),
  [its settings reference](https://docs.docker.com/enterprise/security/hardened-desktop/settings-management/settings-reference/)).
  So the proof is: `docker context inspect --format "{{.Endpoints.docker.Host}}"` prints
  `unix://` followed by your own `~/.docker/run/docker.sock`, so every `docker` command here reads THIS Mac's
  Docker Desktop rather than another daemon a context or `DOCKER_HOST` points at (a context's NAME proves
  nothing — any context can be called `desktop-linux`); no `admin-settings.json` at that path, Docker Desktop not signed in to an organisation that
  sets policy, the `daemon.json` carries NO top-level key beyond the two Docker Desktop writes itself, `builder`
  and `experimental` — any other key (`allow-direct-routing`, `iptables`, or one a later release adds) is
  unproven until read against Docker's documentation — and
  `docker network inspect supabase_network_slopweaver --format "{{json .Options}}"` carries NOTHING beyond
  `com.docker.network.enable_ipv4` and `com.docker.network.enable_ipv6`, on the same terms — and that is the
  ONLY network the store sits on: `docker ps --filter name=_slopweaver --format "{{.Names}}\t{{.Networks}}"`
  names `supabase_network_slopweaver` and nothing else on every row, since a container also joined to a
  `routed` network is reachable through that one instead. If either management
  source is present, routing is **not proven** here, as on another runtime. MEASURED: the endpoint `unix://` and the user's own `~/.docker/run/docker.sock` (and
  `tcp://127.0.0.1:1` when run with that as `DOCKER_HOST`, so the read follows an override), no
  `/Library/Application Support/com.docker.docker/` directory, a `daemon.json` holding only `builder` and
  `experimental`, the options `{"com.docker.network.enable_ipv4":"true","com.docker.network.enable_ipv6":"false"}`,
  and all three store containers on `supabase_network_slopweaver` alone.
- **On any other runtime** (colima, OrbStack, a Linux engine), the daemon can also take command-line flags and
  the runtime's own configuration, which this page cannot enumerate. The network-options half still applies,
  but the routing half is **not proven** here — check that runtime's own daemon settings for direct routing.

- **It removes:** Docker itself publishing the store's Postgres or API to any other machine on the
  network — a café's Wi-Fi, an office LAN, a VPN that routes to you — on an engine at 28.0.0 or later (28.3.3
  on Linux with firewalld), with Docker's default routing, which this page can prove on Docker Desktop only. On
  a stack that kept the CLI's defaults, this is the only thing between that machine and the store.
- **It does not remove:** anything already running on this Mac, which reaches `127.0.0.1` exactly as before —
  including a forwarder or an SSH tunnel that re-publishes one of these ports to the network, which hands
  another machine the access this step took away; anything that can drive Docker (§ 3), which can also turn direct routing on; or a copy of the data at rest
  (§ What none of this covers).

The console already listens on `127.0.0.1` only, for the same reason
([credentials](credentials.md), "How a value gets there from the console").

## 2 · Keep the service key in a `0600` file, and nowhere else on the host

`store-service-key` is the local stack's service-role key. It authenticates the Storage uploads and downloads of
measurement bodies and **bypasses row level security**, so it is read by the object client only, never by a
bot-facing read ([the credential table](credentials.md)). Only a workflow that writes or reads a Storage-held measurement body needs it; if
nothing you run does, do not set it — a copy you do not need is exposure, not hardening.

**On a stack that kept the CLI's defaults, this key is not a secret.** It is signed with the Supabase CLI's
default JWT secret, so it is the same value on every such install (the issuer `supabase-demo`, measured in § 1).
What keeps it from being used against your store is § 1 — nothing off this Mac reaches the gateway — and § 3,
not this file. Changing the stack's own secret is not one of these steps. The file still matters for two
reasons: the key stays out of your history and the transcript, and `secrets/` also holds your provider tokens,
which ARE secrets, so the directory checks below protect them.

**The step.** When you do need it, pipe it straight from the container into the secrets store, so it never
crosses your screen, your shell history or a process list:

```bash
docker exec supabase_storage_slopweaver printenv SERVICE_KEY | slopweaver secrets set store-service-key --stdin
```

`secrets set` writes `$SLOPWEAVER_HOME/secrets/store-service-key` at mode `0600` in a `0700` directory, never
through a symlink at the key or at `secrets/` (a home that is itself a symlink is followed), and refuses a home whose MODE lets others write. **The check is two reads.** `slopweaver
secrets status` names the file and its mode and never its value; a `loose-mode` row means the mode drifted, and
re-running `secrets set` (or `chmod 600` on the file) restores it. But a mode is only the permission bits, and
macOS also honours an access control list, which neither `secrets set` nor `secrets status` touches or reads —
an ACL letting another user read the key, or write the home or `secrets/` and swap a path mid-write, passes both.
`secrets status` reads neither the owner nor the directories either. So the proof is this, which reads the
home exactly as Slopweaver resolves it — `$SLOPWEAVER_HOME` when set, else `~/.slopweaver`:

```bash
ls -led "$HOME" "${SLOPWEAVER_HOME:-$HOME/.slopweaver}" "${SLOPWEAVER_HOME:-$HOME/.slopweaver}/secrets" "${SLOPWEAVER_HOME:-$HOME/.slopweaver}/secrets/store-service-key"
```

The first row is your macOS home folder, the directory the Slopweaver home sits in. MEASURED with
that command, on a Mac with no `store-service-key` set: the home folder `drwxr-x---+` with the single entry
`0: group:everyone deny delete`, the Slopweaver home and `secrets/` both `drwx------@`, all owned by the user,
and `No such file or directory` for the key. An `@` after the mode marks
extended attributes, not an ACL. Run it whether or not the key is set: the home and `secrets/` rows are what
close the directory to other users, provider tokens included, and with no key only the key's own row is
missing. It holds only when **all** of these are true of what it prints:

- every row it prints names **you** as owner — a key someone else owns is deleted and set again with `secrets set`;
- the key's row is exactly `-rw-------` — a regular file. An `l` is a symlink: `ls` then describes the link,
  not the file read through it, while `secrets status` reports the target's mode. Re-running `secrets set`
  replaces the link with a file;
- `secrets/` is exactly `drwx------` (`chmod 700` restores it), and the home's mode has no `w` for group or
  others (`chmod go-w` removes it);
- the home's row starts with `d`. An `l` means the home is a symlink, whose own row says nothing about the
  directory behind it: run the same `ls -led` with the path `realpath` prints for the home in place of the home and
  hold that row to this list instead;
- the home (its `realpath`, if a symlink) sits directly in your own macOS home folder, as the default
  `~/.slopweaver` does. Anywhere else — in the Mac's shared folder, say — a directory above it that another user can
  write lets them move the home aside and put their own in its place, and these rows cannot see that, so the
  step is **not proven** there;
- the volume enforces ownership at all: `df "$HOME"` names the volume it sits on, and that volume's line in
  `mount` carries no `noowners` (Finder's "Ignore ownership on this volume", common on an external disk), since
  on such a volume every row here is decoration. MEASURED: `/System/Volumes/Data`, mounted
  `apfs, local, journaled, nobrowse, protect, root data`;
- your home folder's mode has no `w` for group or others — whoever can write it can move `.slopweaver` aside
  and put their own in its place;
- no row has a `+` after its mode or a numbered entry under it — that is an ACL, which can grant what the mode
  refuses; `chmod -N <path>` removes it. The ONE exception is your home folder's macOS default, whose entries
  are all `deny` (`group:everyone deny delete`): a `deny` only takes away, so it passes, while any `allow`
  entry there fails this check. Never `chmod -N` your home folder.

- **It removes:** the key landing in shell history, an argv or the transcript; and, when the rows above all
  hold, another macOS user account opening anything in `secrets/` from then on — the provider tokens included.
- **It does not remove:** anyone knowing this key's value anyway, since it is the CLI default; a copy another
  user read, or a file they still hold open, before the rows held — a mode fixed afterwards takes back neither,
  so a provider token that ever sat readable is rotated at its provider; any process running as **you**, which
  can read a `0600` file you own; root; or the copy the Storage container always carries in its own
  environment, which anything that can drive Docker reads with the same `printenv` (§ 3). Credentials are not encrypted at rest on this machine — filesystem access is
  the trust boundary ([credentials](credentials.md), "How they are stored"); in a backup they are encrypted.

## 3 · Treat Docker access as store access

**Anything that can drive the Docker daemon can read the whole store.** `docker exec supabase_db_slopweaver psql -U
postgres` opens Postgres inside the container with no password, as a role that bypasses row level security —
MEASURED, `docker exec supabase_db_slopweaver psql -U postgres -tAc "select current_user, rolbypassrls
from pg_roles where rolname = current_user"` printed `postgres|t`. `docker exec supabase_storage_slopweaver printenv
SERVICE_KEY` prints the service key. Neither the bind of § 1 nor the file mode of § 2 is in that path.

Who can drive it is whoever can write to the daemon's socket. On Docker Desktop for Mac that is
`~/.docker/run/docker.sock`, owned by you, with `/var/run/docker.sock` a symlink to it. MEASURED,
`ls -la /var/run/docker.sock ~/.docker/run/docker.sock`: the socket is `srwxr-xr-x`, owner your user, so every
process running as you can drive Docker, and other macOS users cannot. That is the same set of processes the
`0600` files already trust — so the steps here are about **not widening** it:

- **Never expose the daemon over TCP** (a `tcp://` host or `DOCKER_HOST` pointing at one without TLS): every
  host that can reach the port gets the access in this section.
- **Never mount the socket into a container you would not trust with the corpus.** A container given
  `-v /var/run/docker.sock:/var/run/docker.sock` — a dashboard, a CI runner, a devcontainer that runs Docker
  outside Docker — can `exec` into the store exactly as above. Without the socket, and with no daemon
  endpoint on TCP (the bullet above), a container is shut out of both paths to the daemon this page names — but that is not the same as not
  reaching the store.
- **Never attach a container you would not trust with the corpus to `supabase_network_slopweaver`.** Containers
  on one Docker network reach each other directly, past every loopback row in § 1, so one run with
  `--network supabase_network_slopweaver` opens Postgres and the API with the CLI's default password and key. Any
  other container you run is not proven unable to reach the store either; treat what you run as trusted.
- **Do not give a tool a shell as you unless you would give it the store.** A process running as you is past
  every wall on this page.

- **It prevents, kept from now on:** a container, or a remote host, gaining that access through a daemon
  endpoint you would otherwise open. There is no check here that proves it, so it is advice, never "proven".
- **It does not remove:** an endpoint already open — a daemon already listening on TCP, a socket already mounted
  into a running container, a container already on the store's network — which this page neither finds nor closes: look in your runtime's own daemon
  settings and at the containers you run; or anything already running as you, which has the socket, loopback
  and your files whatever you do here. These steps draw a boundary around **your user account**, not around one process inside it.

## 4 · The store lock — one login from the Mac, its password yours

`yarn store:start` runs `slopweaver store start`, which locks the stack after starting it. With the database
published on loopback only (§ 1), every Postgres login from the Mac arrives from the Docker network's gateway.
The lock reads the database's publication first and refuses, changing nothing, when any of it is beyond
loopback: MEASURED with Docker Desktop's default binding, Mac logins arrived from `192.168.65.1` rather than the
gateway, so the image's own `192.168/16` rule still admitted `postgres:postgres`. It checks the database port
only; § 1's check still covers the API gateway. The lock puts two `pg_hba.conf` lines above the rule
that admits that address: the verbs' own role `slopweaver_login`, with a random per-install password, and then
every other role refused. The CLI-default `postgres:postgres` therefore no longer opens Postgres from this Mac
or past the port binding. The lock also ends sessions that came in before the rule, and takes the API roles'
table rights in the store away. Mechanism, order and convergence: [the local lock](../../skills/store/reference/local-lock.md).

**The check is `slopweaver store verify`**: it tries the login and both default doors, reads the rules as
Postgres parses them, counts stray sessions and reads the grants. Any finding fails it. MEASURED on a
throwaway stack: all five lock checks held after a lock. After a stop and recreate through `store start`, the
file had reverted and was rewritten. A `postgres:postgres` session held open from the Mac before the lock was
ended (`terminating connection due to administrator command`).

- **It removes:** the CLI-default database password as a way in from this Mac, or through any forward to the
  host port. A session opened with it before the lock is ended. So are the API roles' rights on the store's
  tables, through the gateway on `55321` too.
- **It does not remove:** anything running as you, which reads `secrets/store-url` and drives Docker (§ 3);
  the window between a container recreate and the next `store start`, when the image's rules are back (the
  lock ends a session that used it but cannot prevent one); or a container on the store's network, which
  reaches Postgres the way every Supabase service does (§ 3). The service key (§ 2) is unchanged.

## What none of this covers

The store's data lives in Docker's volumes on this Mac's disk, and the credentials in plain files. A lost or
stolen Mac that is **powered off** is covered by **FileVault** — macOS full-disk encryption — and by nothing on
this page; one taken while logged in has its disk already unlocked, so FileVault does not cover it, and only
the screen lock stands between it and every file here. The off-machine copy is the nightly backup, whose
credentials leg is encrypted; what the rest of it carries, and how, is [the backup](../store/backup.md).

**What a "proven" here proves.** Each check reads the configuration this page names, on the machine it
describes: one Mac, Docker Desktop, the default home. It catches a setting left at the wrong value, or a
default changed by accident. It is not proof against someone on this Mac building a state to fool it — a
context renamed to look local, a volume remounted without ownership, a forwarder, a second network. Anyone who
can do that already has an account or a process here, which § 2 and § 3 say is past these walls. A "proven"
means "nothing we know to check is wrong", never "nothing can reach the store".

| Step                         | Removes                                                                                                 | Leaves                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Ports on loopback only       | Docker publishing Postgres or the API to other machines (engine ≥ 28.0.0)                               | every process on this machine, a forwarder or tunnel among them; Docker access; data at rest                            |
| Service key `0600`, by stdin | the key in history, argv or the transcript; other macOS users opening `secrets/`, when no ACL widens it | the key's value, which is the CLI default; a copy read before; every process running as you; root; the container's copy |
| Docker access kept narrow    | prevents a container or remote host driving a daemon endpoint opened from now on                        | an endpoint already open; a container on the store's network; every process running as you                              |
| The store lock               | `postgres:postgres` from the Mac or a forward to it; sessions opened before; API roles' table rights    | every process running as you; the recreate window before the next `store start`; a container on the store's network     |
