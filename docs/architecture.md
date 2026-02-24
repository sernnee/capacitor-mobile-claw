# Architecture

## Overview

Mobile Claw is a Capacitor plugin that embeds a full AI agent runtime on Android and iOS. The agent runs inside an embedded Node.js worker process and communicates with the UI layer through a typed bridge protocol.

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

## Layer Breakdown

### UI Layer (`src/engine.ts`)
The `MobileClawEngine` class is the public API. It is framework-agnostic — no Vue, React, or other UI framework dependency. It manages:
- Worker lifecycle (init, ready detection, timeouts)
- Bridge message send/receive
- MCP server management
- Event listener subscriptions

### Bridge Protocol (`src/services/bridge-protocol.ts`)
Typed message definitions for UI-to-Worker and Worker-to-UI communication. Messages are JSON-serialized and passed via the Capacitor-NodeJS message channel. Two categories:
- **UI → Node**: `agent.start`, `agent.stop`, `tool.approve`, `agent.steer`, `config.update`, `session.*`, `file.*`
- **Node → UI**: `agent.event`, `agent.completed`, `agent.error`, `tool.approval_request`, `worker.ready`, `session.*.result`, `file.*.result`

### Node.js Worker (`nodejs-assets/nodejs-project/main.js`)
The embedded Node.js runtime (v18.20.4 via Capacitor-NodeJS) that runs the Pi agent. Handles:
- Agent orchestration via `@mariozechner/pi-agent-core`
- LLM API calls (streaming) via `@mariozechner/pi-ai`
- File tools (read, write, edit, find, grep, ls)
- Code execution (JavaScript sandbox + Python via Pyodide)
- Git operations via `isomorphic-git`
- Session persistence (JSONL transcripts)
- Tool approval gates
- MCP device tool discovery and integration

### MCP Subsystem (`src/mcp/`)
Model Context Protocol implementation for extensible device tools:
- **`mcp-server-manager.ts`** — Lifecycle management for MCP server instances
- **`device-mcp-server.ts`** — MCP server that exposes registered `DeviceTool` implementations
- **`bridge-server-transport.ts`** — In-process IPC transport (default, zero latency)
- **`stomp-server-transport.ts`** — WebSocket transport for remote MCP access
- **`transport-manager.ts`** — Coordinates multiple transports concurrently

## Key Design Decisions

1. **No cloud relay** — The only network call is from the device to the Anthropic API. No intermediate servers.
2. **Embedded Node.js** — Using Capacitor-NodeJS gives access to npm ecosystem (isomorphic-git, pyodide) that would be impossible in a WebView.
3. **Bridge protocol over localhost HTTP** — IPC via Capacitor message channel is faster and doesn't require port allocation.
4. **MCP for device tools** — Standard protocol means tools written for desktop MCP clients work on mobile with minimal adaptation.
5. **Pi framework as agent core** — Minimal, proven engine (4 core tools, <1000 token system prompt) that's lightweight enough for mobile.
