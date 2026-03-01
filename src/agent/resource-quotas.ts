/**
 * Per-session resource quota tracker.
 *
 * Prevents runaway agents from consuming unbounded tool calls in a single session.
 */

export class ResourceQuotaTracker {
  private toolCalls = 0
  private readonly maxToolCalls: number

  constructor(maxToolCalls = 200) {
    this.maxToolCalls = maxToolCalls
  }

  recordToolCall(): { allowed: boolean; reason?: string } {
    this.toolCalls++
    if (this.toolCalls > this.maxToolCalls) {
      return {
        allowed: false,
        reason: `Session tool limit exceeded (${this.maxToolCalls} calls). Start a new conversation.`,
      }
    }
    return { allowed: true }
  }

  get count(): number {
    return this.toolCalls
  }

  reset(): void {
    this.toolCalls = 0
  }
}
