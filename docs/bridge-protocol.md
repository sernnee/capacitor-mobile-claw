# Bridge Protocol

The bridge protocol defines all messages exchanged between the UI layer (your app) and the embedded Node.js worker. Messages are JSON objects passed through the Capacitor-NodeJS message channel.

Source: [`src/services/bridge-protocol.ts`](../src/services/bridge-protocol.ts)

## UI to Worker Messages

### Agent Control

| Message Type | Fields | Description |
|-------------|--------|-------------|
| `agent.start` | `agentId`, `sessionKey`, `prompt`, `provider?`, `model?` | Start an agent turn with a prompt |
| `agent.stop` | — | Cancel the running agent turn |
| `agent.steer` | `text` | Inject a follow-up instruction into a running turn |
| `tool.approve` | `toolCallId`, `approved` | Approve or deny a pending tool execution |

### Configuration

| Message Type | Fields | Description |
|-------------|--------|-------------|
| `config.update` | `config` | Update worker settings (API key, model, etc.) |
| `config.status` | — | Request current auth profile status |
| `config.models` | — | Request list of available models |

### Sessions

| Message Type | Fields | Description |
|-------------|--------|-------------|
| `session.list` | `agentId` | List all past sessions |
| `session.latest` | `agentId` | Get the most recent session |
| `session.load` | `sessionKey`, `agentId` | Load message history for a session |
| `session.resume` | `sessionKey`, `agentId` | Resume a previous session |
| `session.clear` | — | Clear current conversation state |

### File Operations

| Message Type | Fields | Description |
|-------------|--------|-------------|
| `file.read` | `path` | Read a file from the workspace |
| `file.write` | `path`, `content` | Write a file to the workspace |

### Tool Invocation

| Message Type | Fields | Description |
|-------------|--------|-------------|
| `tool.invoke` | `toolName`, `args` | Invoke a tool directly (bypasses agent) |

## Worker to UI Messages

### Agent Events

| Message Type | Fields | Description |
|-------------|--------|-------------|
| `agent.event` | `eventType`, `data` | Streaming event (text_delta, tool_use, tool_result, thinking, error) |
| `agent.completed` | `sessionKey`, `usage?`, `durationMs` | Agent turn finished |
| `agent.error` | `error`, `code?` | Agent execution failed |
| `tool.approval_request` | `toolCallId`, `toolName`, `args` | Agent wants to run a tool (awaits approve/deny) |

### System

| Message Type | Fields | Description |
|-------------|--------|-------------|
| `worker.ready` | `nodeVersion`, `openclawRoot`, `mcpToolCount?` | Worker initialized and ready |

### Result Messages

| Message Type | Fields | Description |
|-------------|--------|-------------|
| `session.list.result` | `agentId`, `sessions[]` | Response to `session.list` |
| `session.latest.result` | session info or null | Response to `session.latest` |
| `session.load.result` | `sessionKey`, `messages[]` | Response to `session.load` |
| `session.resume.result` | — | Response to `session.resume` |
| `session.clear.result` | `success` | Response to `session.clear` |
| `file.read.result` | `path`, `content`, `error?` | Response to `file.read` |
| `config.status.result` | `hasKey`, `masked` | Response to `config.status` |
| `config.models.result` | `models[]` | Response to `config.models` |
| `tool.invoke.result` | `toolName`, `result?`, `error?` | Response to `tool.invoke` |

## Event Types in `agent.event`

The `eventType` field in `agent.event` messages specifies the kind of streaming data:

| eventType | Data Fields | Description |
|-----------|------------|-------------|
| `text_delta` | `text` | Incremental text from the assistant |
| `tool_use` | `toolName`, `toolCallId`, `args` | Agent is calling a tool |
| `tool_result` | `toolCallId`, `result`, `error?` | Tool execution completed |
| `thinking` | `text` | Extended thinking content |
| `error` | `message` | Non-fatal error during the turn |

## Usage in Framework Wrappers

The `MobileClawEngine.onMessage()` method provides raw bridge access for building framework-specific wrappers:

```typescript
const engine = new MobileClawEngine()

// Low-level: listen for any bridge message type
engine.onMessage('agent.event', (msg) => {
  if (msg.eventType === 'text_delta') {
    appendText(msg.data.text)
  }
})

// High-level: use the Capacitor event API
engine.addListener('agentEvent', (event) => {
  // Same data, mapped through the event system
})
```
