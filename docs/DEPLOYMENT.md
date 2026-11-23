# Deployment

Relay runs one personal inbox per service instance. Deploy separate instances for separate owners. Use HTTPS beyond loopback and preserve the data volume when updating.

## Standalone HTTPS

Copy `.env.example` to `.env`, configure your DNS hostname and a random setup secret, then run:

```sh
docker compose up -d --build
```

Point DNS to the host and allow TCP 80 and 443. Caddy obtains and renews certificates. SQLite, ciphertext, and device authorizations live in the persistent `relay-data` volume. Caddy state lives in its own volumes. Back these up privately. Never run `docker compose down --volumes` unless intentionally deleting the inbox.

## Private-network service with a separate gateway

Use `compose.tailnet.yaml` for a service exposed only on host loopback, with sandboxing and persistent storage. Load your private configuration as described in [configuration](CONFIGURATION.md):

```sh
pnpm deploy:config
pnpm deploy:up
```

A private-network HTTPS proxy can forward to `127.0.0.1:4318`. A separately managed public Caddy gateway can connect to that HTTPS proxy using `deploy/relay-public.caddy`. Render the fragment with `pnpm gateway:render /private/path/relay.caddy`, validate it, and integrate it into the gateway's existing configuration. Keep TLS verification enabled and preserve unrelated virtual hosts.

Trust only the actual proxy addresses using `RELAY_TRUSTED_PROXIES`. The gateway must replace client-supplied forwarding addresses. Do not broadly trust arbitrary internet clients, or they can spoof addresses used for rate limiting.

## Updates and rollback

Record the source revision and retain the previous working image before an update. Build the new image, recreate only Relay, and check `/api/health`. Keep the data volume. To roll back, select the retained image and recreate only Relay without rebuilding. Gateway reloads require a separately validated configuration.

The service creates a private first-setup secret when none is supplied. After setup, export an inbox recovery file from a trusted client. Recovery files contain credentials and encryption keys and belong in private storage, never in an image, repository, or shared server directory. Database ciphertext cannot recover a lost inbox key.

The private-network Compose file sets an initial 1 GiB memory limit and one CPU. Docker may terminate the container for exceeding memory or throttle CPU. These are conservative operator defaults, not measured capacity guarantees. Storage and transfer limits are documented in the README.
