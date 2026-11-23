# Private configuration

Routine development works without a configuration file. To customize native signing or deployment once per machine:

```sh
mkdir -p ~/.config/relay
chmod 700 ~/.config/relay
cp config.example.env ~/.config/relay/local.env
chmod 600 ~/.config/relay/local.env
```

Edit that file locally. Never commit it. `pnpm config:check` reports which settings are present without printing their values. Keep a private backup for new computers.

Commands read `~/.config/relay/local.env` automatically. `RELAY_CONFIG_FILE` selects a different file. Explicit environment variables take precedence over saved values. Files use dotenv syntax and are parsed as data, not executed as shell scripts.

| Setting | Purpose | Default |
| --- | --- | --- |
| `RELAY_APPLE_TEAM` | Apple signing team | Empty, for unsigned checks |
| `RELAY_BUNDLE_ID_PREFIX` | Bundle IDs, app groups, and Keychain group suffix | `org.example.relay` |
| `RELAY_DEFAULT_SERVER` | Initial native server URL, after any saved user preference | `http://127.0.0.1:4318` |
| `RELAY_DOMAIN` | HTTPS gateway domain | Required for gateway rendering |
| `RELAY_UPSTREAM` | HTTPS URL of a separately hosted service | Required for gateway rendering |
| `RELAY_UPSTREAM_HOST` | Upstream Host header and TLS server name | Required for gateway rendering |
| `RELAY_TRUSTED_PROXIES` | Comma-separated forwarding proxies trusted by the API | Loopback only in private-network Compose |

`pnpm apple:generate` creates the ignored Xcode project and signing files. Keep the same prefix and team when updating existing apps. Do not commit generated projects, provisioning profiles, certificates, recovery files, database files, or private configuration.

The service host needs only its proxy/deployment settings. The gateway needs only its domain/upstream settings. Neither needs the Apple signing settings or an inbox recovery file. The phone receives its build defaults inside the signed app and needs no external configuration file.

`pnpm deploy:config` validates the private-network Compose setup. `pnpm deploy:up` builds and updates that deployment. Both load the private file. Direct `docker compose` users can pass `--env-file ~/.config/relay/local.env`; an ignored `.env` symlink to that file also preserves automatic loading in the deployment directory.

`pnpm gateway:render /private/path/relay.caddy` renders a gateway fragment with mode 0600. Review and validate it with Caddy before incorporating it into an existing gateway. Rendering does not reload or replace a running gateway.

`pnpm privacy:check` checks source files for private-network addresses, non-example personal email addresses, and sensitive file types. A private `~/.config/relay/privacy-deny.txt` can list additional identifying strings, one per line. `pnpm privacy:check --history` also checks all reachable commit contents and commit metadata. These checks supplement secret scanning; they do not prove that source contains no sensitive information.

To enable the same check before every push from a checkout, run `git config core.hooksPath .githooks`. CI also checks the full history. Hooks are optional checkout configuration and must be enabled again in a fresh clone.
