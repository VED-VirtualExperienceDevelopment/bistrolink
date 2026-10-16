# Contributing to BistroLink


## Security rules (mandatory for all contributors)


This repository and organization are PUBLIC.
Anyone on the internet can see all code, commits and comments.


### NEVER commit:
- Passwords, API keys, tokens or secrets of any kind
- Contents of .env files (use .env.example with empty values)
- Database connection strings with credentials
- Private certificates or .pfx files
- Server IPs or URLs containing tokens


### All secrets go ONLY in GitHub Secrets:
github.com/VED-VirtualExperienceDevelopment/bistrolink/settings/secrets/actions


### If you accidentally commit a secret:
1. Do NOT fix it with another commit — the history is already public
2. Immediately revoke/rotate the exposed credential in the provider
3. Notify the team immediately
4. Ask an Owner to purge the history with git filter-repo
