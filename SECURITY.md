# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Mobile Claw, **please do NOT open a public issue**.

Instead, report it privately by emailing the maintainers. Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge your report within 48 hours and aim to provide a fix within 90 days.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |
| < 1.0   | No        |

## Security Model

Mobile Claw runs an AI agent **entirely on-device**. Key security properties:

- **No cloud relay** — The only network call is from the device directly to the Anthropic API. No intermediate servers see your data.
- **Sandboxed workspace** — File operations are restricted to the agent's workspace directory.
- **Tool approval gate** — When enabled, the user must approve each tool execution before it runs.
- **API keys stored locally** — Authentication credentials are stored on-device and never transmitted to third parties.
- **Worker isolation** — The Node.js worker runs in a separate process from the UI layer.

## Sensitive Data

- API keys (`sk-ant-*`) are stored in the worker's auth profiles file on-device
- OAuth tokens are managed by `@anthropic-ai/sdk` and stored locally
- Session transcripts (JSONL) are stored on-device in the workspace directory
