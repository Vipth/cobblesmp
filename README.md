# CobbleSMP Bot

Discord ↔ Minecraft (Fabric / RCON) bot for CobbleSMP:

- **Account linking** — members link their Minecraft (Java) name to their Discord account (`/link`). The name is checked against Mojang and added to the server whitelist. Optionally grants a "linked" Discord role (`LINKED_ROLE_ID`).
- **Cross-platform ban sync** — a Discord ban bans the linked player in-game, and an in-game ban bans them on Discord (auto or with an admin confirmation button).
- **Optional link-to-play** — enforce that only linked accounts can join, with a reconciler that keeps the server whitelist in sync with the link table ([details](#require-a-discord-link-to-join-whitelist-enforcement)).
- **Admin commands over RCON** — `/ban`, `/pardon`, `/kick`, `/give`, `/tp`, `/whitelist`, `/say`, gated to an admin role and audit-logged.
- **Lookups** — `/mcname @user`, `/discorduser <name>`, `/whoami`, `/list`.

RCON is console-level (op 4) with a single privilege tier, so **every command that reaches the server is built by the bot from validated slash-command options** — there is no raw passthrough, and non-admins cannot run anything.

## How the two ban directions work

| Direction | Mechanism |
|---|---|
| Discord → Minecraft | `guildBanAdd` / `guildBanRemove` gateway events → RCON `ban` / `pardon` |
| Minecraft → Discord | poll `banlist` over RCON every `BAN_SYNC_INTERVAL_MS`, diff against the last seen set |

The bot has no server log/console access (it runs on a separate host), which is why the Minecraft → Discord direction is polling-based. A loop guard (`ban_actions` table) stops an action the bot just performed on one side from bouncing back from the other.

## Prerequisites

1. **Enable RCON** in the server's `server.properties`:
   ```properties
   enable-rcon=true
   rcon.port=25575
   rcon.password=choose-a-strong-secret
   ```
   Restart the server. **Firewall the RCON port so only the bot's IP can reach it** — RCON auth is plaintext with no TLS.

   ### If the server runs on Pterodactyl

   Pterodactyl doesn't use RCON itself, and the server can only listen on ports
   assigned to it as **allocations**. To expose RCON:

   - Admin → Nodes → *node* → Allocations → add one (e.g. `0.0.0.0:25575`).
   - Admin → Servers → *server* → Build → assign that allocation to the server.
   - Set `rcon.port` to that port, restart.
   - If the egg rewrites `server.properties` on boot, set `enable-rcon` / `rcon.port`
     via the egg's startup variables instead.

   ### If the bot and server are on different networks

   RCON needs its own path — a playit.gg Minecraft tunnel only forwards the game port.

   - **Recommended:** put both machines on a [Tailscale](https://tailscale.com) tailnet
     and point `RCON_HOST` at the server host's `100.x.y.z` address. RCON stays private
     and encrypted.
   - **Alternative:** add a second playit.gg **TCP** tunnel to `127.0.0.1:25575` and use
     the `*.playit.gg` host/port it gives you. RCON is then publicly reachable, so use a
     40+ character random `RCON_PASSWORD` and keep the tunnel address private.

   Check connectivity from the bot's machine before running the bot:

   ```bash
   node src/rcon-check.js
   ```

2. **Create a Discord application** at <https://discord.com/developers/applications>:
   - Add a **Bot**, copy its **token** → `DISCORD_TOKEN`.
   - Copy the **Application ID** → `DISCORD_CLIENT_ID`.
   - Under *Bot → Privileged Gateway Intents*: none are required.
   - Invite it with this URL (replace `CLIENT_ID`), which grants `bot` + `applications.commands` and the **Ban Members** + **Manage Roles** permissions:
     ```
     https://discord.com/api/oauth2/authorize?client_id=CLIENT_ID&scope=bot%20applications.commands&permissions=268435460
     ```
     (Manage Roles is only needed if you use `LINKED_ROLE_ID`. If you do, also drag the
     bot's own role **above** the linked role in Server Settings → Roles.)

3. In your server: note the **guild ID**, the **admin role ID**, a **log channel ID**, and
   optionally a **linked-member role ID** (enable Developer Mode → right-click → Copy ID).

## Configuration

```bash
cp .env.example .env
# then fill in every value
```

| var | notes |
|---|---|
| `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `GUILD_ID` | from the steps above |
| `ADMIN_ROLE_ID` | members with this role may run `/ban`, `/kick`, `/give`, … |
| `LOG_CHANNEL_ID` | audit lines + ban-sync proposals go here |
| `RCON_HOST` / `RCON_PORT` / `RCON_PASSWORD` | must match `server.properties` |
| `RCON_DRY_RUN` | `true` = log commands instead of sending them |
| `BAN_SYNC_INTERVAL_MS` | banlist poll cadence, default `60000` (keep ≥ 60000 on a Pi) |
| `BAN_SYNC_MODE` | `propose` (default, admin confirms via button) or `auto` |
| `DEPLOY_COMMANDS_ON_START` | `true` re-registers slash commands on every boot |

## Run locally

```bash
npm install
npm run deploy   # register slash commands to your guild (run again when commands change)
npm start
```

Dev loop with auto-restart: `npm run dev`.

Run the parser tests: `npm test`.

## Run with Docker

```bash
cp .env.example .env   # fill it in

# one-time (and whenever commands change): register slash commands
docker compose run --rm bot node src/deploy-commands.js

docker compose up -d
docker compose logs -f
```

The SQLite database persists in `./data` on the host.

### Building for a Raspberry Pi 3 B+

The Pi has ~1 GB RAM and shouldn't compile native modules. Build a multi-arch
image on a dev machine / CI and pull it on the Pi (assumes 64-bit Raspberry Pi OS):

```bash
docker buildx create --use --name cobble || docker buildx use cobble
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t YOUR_REGISTRY/cobblesmp-bot:latest \
  --push .
```

Then on the Pi, point `docker-compose.yml` at `image: YOUR_REGISTRY/cobblesmp-bot:latest`,
drop the `build: .` line, and `docker compose up -d`.

If the Pi runs 32-bit Raspberry Pi OS, add `linux/arm/v7` to `--platform`.

## Commands

### Everyone
- `/link <username>` — link your Minecraft account (whitelists you)
- `/unlink` — remove your link (removes you from the whitelist)
- `/whoami` — show your linked account
- `/mcname <@user>` — a member's Minecraft name
- `/discorduser <username>` — which member owns a Minecraft name
- `/list` — who's online

### Admin role only (also audit-logged to the log channel)
- `/ban <target> [reason]` — ban on Minecraft **and** Discord
- `/pardon <target>` — unban on both
- `/kick <target> [reason]`
- `/op <target>` / `/deop <target>` — grant/revoke in-game operator
- `/give <target> <item> [count]`
- `/tp <target> <destination>`
- `/whitelist add|remove|list|sync` — `sync` reconciles the whitelist with linked accounts now
- `/say <message> [color] [bold]` — broadcast via `tellraw`; prefix set by `SAY_PREFIX` (supports `&` codes)
- `/forcelink <@user> <username>` — link on someone's behalf
- `/links [page]` — list all links
- `/linking open|close|status` — open or close new `/link` sign-ups (e.g. to stop a rush of new players). Existing links and `/forcelink` are unaffected; persists across restarts.

`<target>` accepts a Minecraft username, an `@mention`, or a raw Discord ID.

Admin commands are gated **only** by holding the `ADMIN_ROLE_ID` role (the server
owner is also always allowed, as a failsafe). Discord's global "Administrator"
permission is **not** a bypass. If `ADMIN_ROLE_ID` doesn't match a real role, the bot
logs a warning to the console and the log channel on startup.

## Require a Discord link to join (whitelist enforcement)

Off by default. To make linking mandatory:

1. In `server.properties`: `white-list=true` and `enforce-whitelist=true`, then restart once.
   Optional but recommended in that same restart: `broadcast-rcon-to-ops=false` so ops
   don't see the bot's periodic `whitelist` commands in chat.
2. In `.env`, set `WHITELIST_MODE`:
   - `additive` — the bot runs `whitelist on`, keeps every linked user whitelisted, and
     **reports** (never removes) whitelisted accounts that have no link. Use this first so
     current players can `/link` before they're locked out.
   - `strict` — same, plus it **removes and kicks** whitelisted accounts that aren't linked
     or listed in `WHITELIST_EXEMPT`.
3. `WHITELIST_EXEMPT` — comma-separated usernames the reconciler never touches (ops, alts).

The reconciler runs on startup and every `WHITELIST_RECONCILE_INTERVAL_MS` (default 5 min),
and posts a summary + the list of unlinked accounts to the log channel. Trigger it manually
with `/whitelist sync`.

Note: once `WHITELIST_MODE` is `additive`/`strict` and the whitelist is on, unlinked players
can't rejoin after logging off — that's the point.

## Linked-member role

Set `LINKED_ROLE_ID` to a Discord role and the bot grants it on `/link` / `/forcelink` and
removes it on `/unlink`. A reconcile every 15 minutes re-grants it to linked members who are
missing it (e.g. after leaving and rejoining). It's **add-only** — it won't strip the role
from someone who has it without a link (that needs the privileged members intent).

Requires the bot to have **Manage Roles** and its own role positioned **above** the linked
role. The bot checks this on startup and warns in the log channel if it can't assign it.

## Notes / limitations

- **Linking is not identity-verified** — a member can link any existing username. Tighten later with a companion Fabric mod that exposes an in-game `/link <code>`.
- Bedrock/Geyser names (with a prefix like `.`) won't pass the Mojang check; add them with `/forcelink` or `/whitelist add` if needed.
- If RCON is unreachable the bot stays up, retries with backoff, and posts a warning to the log channel.
