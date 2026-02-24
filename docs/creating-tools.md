# Creating Device Tools

Device tools extend the agent's capabilities with access to native hardware and platform APIs. Tools are implemented using the `DeviceTool` interface and registered at engine init time.

## The DeviceTool Interface

```typescript
import type { DeviceTool } from 'capacitor-mobile-claw/mcp/tools/types'

const myTool: DeviceTool = {
  name: 'get_battery',
  description: 'Get current battery level and charging state',
  inputSchema: {
    type: 'object',
    properties: {
      detailed: {
        type: 'boolean',
        description: 'Include voltage and temperature',
      },
    },
  },
  handler: async (args) => {
    const info = await BatteryPlugin.getInfo()
    return { level: info.batteryLevel, charging: info.isCharging }
  },
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Unique tool identifier (snake_case) |
| `description` | `string` | What the tool does — the LLM reads this to decide when to use it |
| `inputSchema` | `object` | JSON Schema for the tool's input parameters |
| `handler` | `(args) => Promise<any>` | Async function that executes the tool and returns a result |

## Registering Tools

Pass tools to `engine.init()`:

```typescript
import { MobileClawEngine } from 'capacitor-mobile-claw'

const engine = new MobileClawEngine()

await engine.init({
  tools: [myTool, anotherTool],
  enableBridge: true,
})
```

Tools are exposed to the agent via MCP's `tools/list` JSON-RPC method. The agent discovers available tools automatically during each turn.

## Best Practices

1. **Descriptive names** — Use `snake_case` and be specific: `read_clipboard` not `clipboard`.
2. **Clear descriptions** — The LLM decides when to use a tool based on the description. Be precise about what it returns.
3. **Minimal input schemas** — Only require parameters the tool actually needs. Use `required` sparingly.
4. **Return structured data** — Return objects, not strings. The agent can reason about structured data more effectively.
5. **Handle errors gracefully** — Throw with descriptive messages. The error text is sent back to the agent.
6. **Request permissions lazily** — Don't request camera/location/etc. permissions until the tool is actually called.

## Example: Clipboard Tool

```typescript
import { Clipboard } from '@capacitor/clipboard'

const clipboardTools: DeviceTool[] = [
  {
    name: 'read_clipboard',
    description: 'Read the current text content of the system clipboard',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const { value } = await Clipboard.read()
      return { text: value }
    },
  },
  {
    name: 'write_clipboard',
    description: 'Write text to the system clipboard',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to copy' },
      },
      required: ['text'],
    },
    handler: async ({ text }) => {
      await Clipboard.write({ string: text })
      return { success: true }
    },
  },
]
```

## See Also

- [capacitor-mobile-claw-device-tools](https://www.npmjs.com/package/capacitor-mobile-claw-device-tools) — 64+ pre-built device tools (camera, sensors, clipboard, SSH, etc.)
- [MCP specification](https://modelcontextprotocol.io/) — Full protocol documentation
