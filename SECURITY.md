# Security

Relay is early software and has not had an independent security audit. The protocol and threat boundaries are documented in [docs/PROTOCOL.md](docs/PROTOCOL.md). Only the current main branch is maintained.

Report vulnerabilities through the repository's Security tab using **Report a vulnerability**, when private reporting is enabled. Do not put credentials, recovery files, private uploads, or exploit details in a public issue. If private reporting is unavailable, open an issue requesting a private reporting channel without disclosing the vulnerability.

Include the affected revision, a minimal reproduction using synthetic data, and the expected and observed behavior. Response times and fixes are not guaranteed.

Encryption protects stored content and filenames from the relay service. It does not protect an unlocked or compromised client, conceal all traffic metadata, or erase files already copied to another device. The single-owner first-setup secret must remain private. iPhone background push is not implemented. Public sharing links and multi-user hosted accounts are outside the current scope.
