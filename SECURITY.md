# Security Policy

## Supported Versions

Currently, only the latest major version is supported for security updates.

## Reporting a Vulnerability

Please do not report security vulnerabilities through public GitHub issues.

Instead, use
[GitHub private vulnerability reporting](https://github.com/mr-min-max/aidoc/security/advisories/new).
This keeps the report private while maintainers investigate it.

Provider-backed generation sends selected context to the configured provider.
Ollama is the local-provider option; OpenAI and Anthropic are remote-provider
options.

`aidoc plan` is provider-free. Provider impact context used by `aidoc update`
is deterministic and byte-bounded and excludes raw source, raw diffs, and
credential values. These boundaries reduce exposure but do not turn generated
output into trusted code or replace repository access controls.

Security reports should include the affected commit or beta version, a minimal
reproduction, and impact. Do not place working credentials or sensitive source
material in the report; coordinate a safe transfer through the private
advisory if maintainers need additional evidence.
