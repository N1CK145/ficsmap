# Security policy

## Supported versions

Only the latest release gets security fixes. Older versions are not patched. Upgrade to the latest release before you report a problem, if you can.

## Reporting a vulnerability

Please report vulnerabilities privately. Do not open a public issue, pull request or discussion for them.

1. Go to the repository's **Security** tab on GitHub.
2. Click **Report a vulnerability**. This uses GitHub's private vulnerability reporting.
3. Describe the problem, the affected version, and how to reproduce it. A proof of concept helps.

You will get an answer as soon as possible. This is a spare-time project, so please allow a few days. Once a fix is released, the advisory is published and you are credited if you want to be.

## Scope

In scope: the ficsmap server and web app in this repository, and the Docker images built from it.

Out of scope: your own deployment setup (reverse proxy, TLS, host), the Discord platform, and third-party dependencies. Report problems in dependencies to their maintainers. If a dependency problem affects ficsmap in a specific way, you can still report that here.

## Handling secrets

Never post secrets in an issue or report: no `.env` contents, Discord client secrets, session or invite secrets, cookies, invite links, upload keys (`fsm_…`) or the save watcher scripts that contain them. Never attach save files.
