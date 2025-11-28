export type ChatMessageRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatMessageRole;
  content: string;
}

export interface AIClientConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs?: number;
}

export interface ChatRequestOptions {
  temperature?: number;
  signal?: AbortSignal;
}

/**
 * AIClient - generic OpenAI-compatible client using manual streaming fetch
 * Accepts caller-provided prompts/messages and configuration,
 * so feature modules (i18n, search, etc.) can reuse the same capability layer.
 */
export class AIClient {
  private readonly DEFAULT_TIMEOUT = 30000;

  constructor(private readonly config: AIClientConfig) {}

  /**
   * Send chat completion request and return the first message content
   */
  public async chat(messages: ChatMessage[], options?: ChatRequestOptions): Promise<string> {
    const timeoutMs = this.config.timeoutMs ?? this.DEFAULT_TIMEOUT;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    if (options?.signal) {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        options.signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    try {
      const text = await this.streamChatCompletion(messages, {
        temperature: options?.temperature,
        signal: controller.signal,
      });
      if (!text) {
        throw new Error('AI response is empty');
      }
      return text.trim();
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error('AI request timed out. Please try again.');
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  /**
   * Simple connectivity check using a tiny prompt
   */
  public async testConnection(): Promise<boolean> {
    try {
      await this.streamChatCompletion([{ role: 'user', content: 'ping' }], {
        temperature: 0,
        maxTokens: 5,
      });
      return true;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Normalize base URL for OpenAI-compatible endpoints
   * - remove trailing slashes
   * - ensure it ends with /v1 so downstream client appends /chat/completions correctly
   */
  private normalizeBaseUrl(value: string): string {
    const trimmed = value.replace(/\/+$/, '');
    if (trimmed.endsWith('/v1')) {
      return trimmed;
    }
    return `${trimmed}/v1`;
  }

  /**
   * Stream chat completions manually to support providers that only return content in streaming mode.
   * Accepts OpenAI-compatible streaming responses (data: {...}, [DONE]) and tolerates extra event names
   * like `stream-start` by simply ignoring unknown chunks.
   */
  private async streamChatCompletion(
    messages: ChatMessage[],
    options: { temperature?: number; signal?: AbortSignal; maxTokens?: number }
  ): Promise<string> {
    const url = `${this.normalizeBaseUrl(this.config.baseUrl)}/chat/completions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens,
        stream: true,
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `AI request failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`
      );
    }

    if (!response.body) {
      throw new Error('AI response is empty');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');

        const { eventName, data } = this.parseSSEEvent(rawEvent);
        if (!data) {
          continue;
        }
        if (data === '[DONE]') {
          return result;
        }

        try {
          const parsed = JSON.parse(data);
          const delta = this.extractTextDelta(parsed, eventName);
          if (delta) {
            result += delta;
          }
        } catch {
          // Ignore JSON parse errors for non-standard chunks
          continue;
        }
      }
    }

    return result;
  }

  /**
   * Basic SSE parser for a single event block
   */
  private parseSSEEvent(
    rawEvent: string
  ): { eventName: string | undefined; data: string | undefined } {
    const lines = rawEvent.split('\n');
    let eventName: string | undefined;
    const dataLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('event:')) {
        eventName = trimmed.slice('event:'.length).trim();
      } else if (trimmed.startsWith('data:')) {
        dataLines.push(trimmed.slice('data:'.length).trim());
      }
    }

    const data = dataLines.length > 0 ? dataLines.join('\n') : undefined;
    return { eventName, data };
  }

  /**
   * Extract text delta from various OpenAI-compatible streaming payloads.
   * Handles classic chat completions and tolerates provider-specific fields.
   */
  private extractTextDelta(payload: any, eventName?: string): string {
    if (!payload) {
      return '';
    }

    // Standard OpenAI chat completion delta
    const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined;
    if (choice) {
      const delta = choice.delta ?? choice.message;
      if (typeof delta?.content === 'string') {
        return delta.content;
      }
      if (Array.isArray(delta?.content)) {
        return delta.content.map((part: any) => part?.text ?? part?.content ?? '').join('');
      }
    }

    // OpenAI-style non-delta message (fallback)
    if (typeof payload.content === 'string') {
      return payload.content;
    }

    // Generic fallbacks for providers that emit text fields
    if (typeof payload.text === 'string') {
      return payload.text;
    }
    if (typeof payload.output_text === 'string') {
      return payload.output_text;
    }
    if (payload.delta && typeof payload.delta.text === 'string') {
      return payload.delta.text;
    }

    // Some providers put type on event name (e.g., stream-start). Ignore those.
    if (eventName && eventName !== 'text-generation') {
      return '';
    }

    return '';
  }
}
