# Security

Beeblio is designed to run for one trusted user on one computer. Keep its UI and agent bound to `127.0.0.1`. The agent can execute commands with the permissions of the local user, and linked project folders are edited in place. Do not expose either server to an untrusted network or run it against data you cannot afford to change.

## Supported versions

Security fixes are made on `main` and shipped in the latest published stable desktop release. Older desktop releases do not receive backported fixes. Install the newest stable release when a security update is published. Source users should update to the latest `main` commit.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/alharkan7/beeblio/security/advisories/new) to report security issues. If GitHub reporting is unavailable, email [mail@beeblio.org](mailto:mail@beeblio.org). Include a description, reproduction steps, affected versions, and impact; omit credentials and private project files. Please do not open a public issue before the maintainer can assess the report. The maintainer will acknowledge reports and coordinate a fix and disclosure through the private advisory.
