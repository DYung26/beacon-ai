/**
 * LLM Abstraction Layer
 *
 * Provides a pluggable, OpenAI-compatible interface for LLM backends.
 * Supports swappable models (OpenAI, Claude, Ollama, etc.) via environment config.
 *
 * Default implementation uses OpenAI API.
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LLMCompletionResponse {
  content: string
  finishReason: string
  tokensUsed?: number
}

export interface LLMProvider {
  complete(messages: LLMMessage[]): Promise<LLMCompletionResponse>
}

/**
 * OpenAI API provider implementation.
 * Uses OPENAI_API_KEY and OPENAI_MODEL from environment.
 */
class OpenAIProvider implements LLMProvider {
  private apiKey: string
  private model: string
  private baseUrl: string

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || ''
    this.model = process.env.OPENAI_MODEL || 'gpt-4o-mini'
    this.baseUrl = 'https://api.openai.com/v1'
  }

  async complete(messages: LLMMessage[]): Promise<LLMCompletionResponse> {
    if (!this.apiKey) {
      throw new Error('[LLM] OPENAI_API_KEY is not set')
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.7,
        max_tokens: 1024,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`[LLM] OpenAI API error: ${response.status} ${error}`)
    }

    const data = (await response.json()) as Record<string, unknown>
    const choices = data.choices as Array<{ message?: { content?: string }; finish_reason?: string }> | undefined
    
    if (!choices || choices.length === 0) {
      throw new Error('[LLM] No choices in response')
    }

    const content = choices[0].message?.content || ''
    const finishReason = choices[0].finish_reason || 'unknown'

    return {
      content,
      finishReason,
      tokensUsed: (data.usage as { total_tokens?: number } | undefined)?.total_tokens,
    }
  }
}

// Global provider instance
let globalProvider: LLMProvider | null = null

/**
 * Get or initialize the default LLM provider.
 * Uses OpenAI by default.
 * Can be extended to support other providers.
 */
export function getProvider(): LLMProvider {
  if (globalProvider) {
    return globalProvider
  }

  // Default to OpenAI
  globalProvider = new OpenAIProvider()
  return globalProvider
}

/**
 * Set a custom LLM provider (useful for testing or alternative backends).
 */
export function setProvider(provider: LLMProvider): void {
  globalProvider = provider
}
