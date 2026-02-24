# Mobile Claw

[![npm](https://img.shields.io/npm/v/capacitor-mobile-claw)](https://www.npmjs.com/package/capacitor-mobile-claw)
[![CI](https://github.com/rogelioRuiz/capacitor-mobile-claw/actions/workflows/ci.yml/badge.svg)](https://github.com/rogelioRuiz/capacitor-mobile-claw/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**On-device AI agent engine for mobile apps** — run Claude directly on your phone with file tools, code execution, git, and extensible MCP tool support.

Mobile Claw is a [Capacitor](https://capacitorjs.com/) plugin that embeds a full AI agent runtime on Android and iOS via an embedded Node.js worker. No cloud relay, no proxy — the agent runs locally on the device and talks directly to the Anthropic API.

> Built on [OpenClaw](https://github.com/openclaw/openclaw) and the [Pi framework](https://www.npmjs.com/package/@mariozechner/pi-ai) by [Mario Zechner](https://github.com/badlogic). Pi's philosophy of *"what you leave out matters more than what you put in"* — just 4 core tools and a system prompt under 1,000 tokens — is what makes running a capable AI agent on a phone possible at all.

## How It Works

```
┌─────────────────────────────────────────────────────┐
│  Your App (Vue, React, Svelte, vanilla JS)          │
│  ┌───────────────────────────────────────────────┐  │
│  │  MobileClawEngine (framework-agnostic)        │  │
│  │  - sendMessage() / stopTurn() / steerAgent()  │  │
│  │  - readFile() / writeFile()                   │  │
│  │  - listSessions() / resumeSession()           │  │
│  │  - invokeTool()                               │  │
│  └──────────────────┬────────────────────────────┘  │
│                     │ Bridge Protocol (IPC)          │
│  ┌──────────────────▼────────────────────────────┐  │
│  │  Embedded Node.js Worker (Capacitor-NodeJS)   │  │
│  │  ┌──────────────┐  ┌──────────────────────┐   │  │
│  │  │ Pi Agent     │  │ MCP Server           │   │  │
│  │  │ (@mariozechner│  │ - Bridge transport   │   │  │
│  │  │  /pi-ai)     │  │ - STOMP transport    │   │  │
│  │  │              │  │ - Custom tools (BYO) │   │  │
│  │  └──────┬───────┘  └──────────────────────┘   │  │
│  │         │                                      │  │
│  │         ▼ Anthropic Messages API               │  │
│  └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## Quick Start

### Install

```bash
npm install capacitor-mobile-claw
```

Peer dependencies:
```bash
npm install @capacitor/core @capacitor/device
# capacitor-nodejs is distributed via GitHub Releases (not npm):
npm install https://github.com/hampoelz/Capacitor-NodeJS/releases/download/v1.0.0-beta.9/capacitor-nodejs.tgz
# Optional (for MCP device tools):
npm install @modelcontextprotocol/sdk
```

### Basic Usage

```typescript
import { MobileClawEngine } from 'capacitor-mobile-claw'

const engine = new MobileClawEngine()

// Initialize the embedded Node.js worker
await engine.init()

// Listen for streaming text
engine.addListener('agentEvent', (event) => {
  if (event.eventType === 'text_delta') {
    process.stdout.write(event.data.text)
  }
})

// Send a message
await engine.sendMessage('What files are in my workspace?')
```

### With Custom MCP Tools

```typescript
import { MobileClawEngine } from 'capacitor-mobile-claw'
import type { DeviceTool } from 'capacitor-mobile-claw/mcp/tools/types'

const myTools: DeviceTool[] = [
  {
    name: 'get_battery',
    description: 'Get current battery level and charging state',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => ({ level: 0.85, charging: true }),
  },
]

const engine = new MobileClawEngine()

await engine.init({
  tools: myTools,
  enableBridge: true,
})
```

## Features

- **Real-time streaming** — text deltas, tool use, and thinking events
- **Multi-turn conversations** — session persistence with JSONL transcripts
- **OAuth PKCE + API key** — sign in with Claude Max or use a direct API key
- **File tools** — sandboxed read/write/edit/find/grep
- **Code execution** — JavaScript (sandbox) + Python (Pyodide/WebAssembly)
- **Git** — clone, commit, push, diff via isomorphic-git
- **MCP device tools** — extensible via Model Context Protocol
- **Tool approval gate** — approve/deny tool executions before they run
- **Agent steering** — inject follow-up instructions into a running turn

## API Reference

### MobileClawEngine

| Method | Description |
|--------|-------------|
| `init(options?)` | Start the Node.js worker and MCP bridge |
| `sendMessage(prompt, agentId?)` | Send a prompt to the agent |
| `stopTurn()` | Cancel the running agent turn |
| `approveTool(toolCallId, approved)` | Approve/deny a tool execution |
| `steerAgent(text)` | Inject a follow-up instruction |
| `updateConfig(config)` | Update worker config (auth, model, etc.) |
| `getAuthStatus()` | Get current auth profile status |
| `getModels()` | List available models |
| `readFile(path)` / `writeFile(path, content)` | Workspace file operations |
| `listSessions()` / `resumeSession(key)` | Session management |
| `invokeTool(toolName, args?)` | Call a tool directly |
| `addListener(eventName, handler)` | Subscribe to agent events |

### Events

| Event | Fired When |
|-------|-----------|
| `agentEvent` | Text delta, tool use, tool result, or thinking update |
| `agentCompleted` | Agent turn finished (includes token usage) |
| `agentError` | Agent execution failed |
| `toolApprovalRequest` | Agent wants to run a tool (approval gate) |
| `workerReady` | Node.js worker initialized |

## Documentation

- [Architecture](docs/architecture.md) — system design and layer breakdown
- [Bridge Protocol](docs/bridge-protocol.md) — UI-to-Worker message reference
- [Creating Device Tools](docs/creating-tools.md) — how to build custom MCP tools
- [Reference App](examples/reference-app/) — complete Vue 3 demo with chat UI

## Related Packages

- [capacitor-mobile-claw-device-tools](https://github.com/rogelioRuiz/capacitor-mobile-claw-device-tools) — 64+ pre-built device tools (camera, clipboard, sensors, SSH, etc.)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, workflow, and guidelines.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Mobile framework | [Capacitor 8](https://capacitorjs.com/) |
| Agent core | [Pi](https://www.npmjs.com/package/@mariozechner/pi-ai) by Mario Zechner |
| Embedded runtime | [Capacitor-NodeJS](https://github.com/hampoelz/Capacitor-NodeJS) |
| Tool protocol | [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) |
| LLM provider | [Anthropic Claude](https://anthropic.com/) |
| Git | [isomorphic-git](https://isomorphic-git.org/) |
| Python | [Pyodide](https://pyodide.org/) (CPython via WebAssembly) |
| Type system | TypeScript (strict mode) |
| Tests | [Vitest](https://vitest.dev/) |

## Acknowledgments

Mobile Claw is built on [OpenClaw](https://github.com/openclaw/openclaw) and the [Pi framework](https://www.npmjs.com/package/@mariozechner/pi-ai) by [Mario Zechner](https://github.com/badlogic) (creator of [libGDX](https://libgdx.com/)). Pi demonstrated that a truly capable AI agent doesn't need a massive framework — just four well-designed tools and a focused system prompt. That minimalism is what makes on-device mobile execution feasible.

## License

MIT
