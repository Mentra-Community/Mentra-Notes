/**
 * OpenAI Provider
 * GPT implementation of the AgentProvider interface
 */

import OpenAI from "openai";
import type {
  AgentProvider,
  ProviderConfig,
  ProviderCapabilities,
  ModelConfig,
  UnifiedMessage,
  UnifiedContent,
  UnifiedResponse,
  UnifiedStreamChunk,
  UnifiedTool,
  ChatOptions,
  ModelTier,
  StopReason,
  TextContent,
  ToolUseContent,
  ToolResultContent,
} from "./types";

const DEFAULT_MODELS: ModelConfig = {
  fast: "gpt-4o-mini",
  smart: "gpt-4o",
};

const CAPABILITIES: ProviderCapabilities = {
  toolCalling: true,
  vision: true,
  audio: false,
  video: false,
  streaming: true,
  thinking: false,
  maxContextTokens: 128000,
  maxOutputTokens: 16384,
};

/**
 * Convert unified message to OpenAI format
 */
function toOpenAIMessage(
  message: UnifiedMessage,
): OpenAI.Chat.ChatCompletionMessageParam {
  if (message.role === "system") {
    const text =
      typeof message.content === "string"
        ? message.content
        : (message.content as any[])
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join("\n");
    return { role: "system", content: text };
  }

  if (typeof message.content === "string") {
    return {
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content,
    };
  }

  // Check if this message contains tool results
  const toolResults = message.content.filter(
    (c) => c.type === "tool_result",
  ) as ToolResultContent[];
  if (toolResults.length > 0) {
    // OpenAI uses separate "tool" role messages for each result
    // Return the first one; caller handles multiple
    const tr = toolResults[0];
    return {
      role: "tool" as const,
      tool_call_id: tr.toolUseId,
      content: tr.content,
    };
  }

  // Check if this is an assistant message with tool calls
  const toolUses = message.content.filter(
    (c) => c.type === "tool_use",
  ) as ToolUseContent[];
  if (toolUses.length > 0 && message.role === "assistant") {
    const textParts = message.content
      .filter((c) => c.type === "text")
      .map((c) => (c as TextContent).text)
      .join("");

    return {
      role: "assistant",
      content: textParts || null,
      tool_calls: toolUses.map((tu) => ({
        id: tu.id,
        type: "function" as const,
        function: {
          name: tu.name,
          arguments: JSON.stringify(tu.input),
        },
      })),
    };
  }

  // Regular user/assistant message with content parts
  const parts: OpenAI.Chat.ChatCompletionContentPart[] = [];
  for (const block of message.content) {
    if (block.type === "text") {
      parts.push({ type: "text", text: (block as TextContent).text });
    } else if (block.type === "image") {
      const img = block as any;
      if (img.source.type === "base64" && img.source.data) {
        parts.push({
          type: "image_url",
          image_url: {
            url: `data:${img.source.mediaType || "image/png"};base64,${img.source.data}`,
          },
        });
      } else if (img.source.url) {
        parts.push({
          type: "image_url",
          image_url: { url: img.source.url },
        });
      }
    }
  }

  return {
    role: message.role === "assistant" ? "assistant" : "user",
    content: parts.length > 0 ? parts : "",
  };
}

/**
 * Convert unified tools to OpenAI format
 */
function toOpenAITool(
  tool: UnifiedTool,
): OpenAI.Chat.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties: tool.parameters.properties,
        required: tool.parameters.required,
      },
    },
  };
}

/**
 * Convert OpenAI response to unified format
 */
function fromOpenAIResponse(
  response: OpenAI.Chat.ChatCompletion,
): UnifiedResponse {
  const choice = response.choices[0];
  const content: UnifiedContent[] = [];

  if (choice.message.content) {
    content.push({ type: "text", text: choice.message.content });
  }

  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      content.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments || "{}"),
      });
    }
  }

  let stopReason: StopReason = "end_turn";
  if (choice.finish_reason === "tool_calls") stopReason = "tool_use";
  else if (choice.finish_reason === "length") stopReason = "max_tokens";
  else if (choice.finish_reason === "stop") stopReason = "end_turn";

  return {
    id: response.id,
    content,
    stopReason,
    usage: {
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
    },
    raw: response,
  };
}

/**
 * Flatten unified messages into OpenAI format.
 * Handles tool_result content blocks that need to become separate "tool" messages.
 */
function flattenMessages(
  messages: UnifiedMessage[],
  systemPrompt?: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  if (systemPrompt) {
    result.push({ role: "system", content: systemPrompt });
  }

  for (const msg of messages) {
    if (msg.role === "system") {
      result.push(toOpenAIMessage(msg));
      continue;
    }

    // If content is an array with multiple tool_result blocks, split them
    if (typeof msg.content !== "string") {
      const toolResults = msg.content.filter(
        (c) => c.type === "tool_result",
      ) as ToolResultContent[];

      if (toolResults.length > 1) {
        for (const tr of toolResults) {
          result.push({
            role: "tool",
            tool_call_id: tr.toolUseId,
            content: tr.content,
          });
        }
        continue;
      }
    }

    result.push(toOpenAIMessage(msg));
  }

  return result;
}

export class OpenAIProvider implements AgentProvider {
  readonly name = "openai" as const;
  readonly capabilities = CAPABILITIES;
  readonly models: ModelConfig;

  private client: OpenAI;

  constructor(config: ProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
    this.models = config.models || DEFAULT_MODELS;
  }

  getModel(tier: ModelTier): string {
    return this.models[tier];
  }

  async validate(): Promise<boolean> {
    try {
      await this.client.chat.completions.create({
        model: this.models.fast,
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      });
      return true;
    } catch (error) {
      console.error("[OpenAIProvider] Validation failed:", error);
      return false;
    }
  }

  async chat(
    messages: UnifiedMessage[],
    options: ChatOptions,
  ): Promise<UnifiedResponse> {
    // Separate system messages
    const systemMessages = messages.filter((m) => m.role === "system");
    const conversationMessages = messages.filter((m) => m.role !== "system");

    let systemPrompt = options.systemPrompt || "";
    for (const msg of systemMessages) {
      const text =
        typeof msg.content === "string"
          ? msg.content
          : (msg.content as any[])
              .filter((c) => c.type === "text")
              .map((c) => c.text)
              .join("\n");
      systemPrompt += (systemPrompt ? "\n\n" : "") + text;
    }

    const openaiMessages = flattenMessages(conversationMessages, systemPrompt);
    const openaiTools = options.tools?.map(toOpenAITool);

    const response = await this.client.chat.completions.create({
      model: this.getModel(options.tier),
      max_tokens: options.maxTokens,
      messages: openaiMessages,
      tools: openaiTools && openaiTools.length > 0 ? openaiTools : undefined,
      temperature: options.temperature,
    });

    return fromOpenAIResponse(response);
  }

  async *streamChat(
    messages: UnifiedMessage[],
    options: ChatOptions,
  ): AsyncIterable<UnifiedStreamChunk> {
    const systemMessages = messages.filter((m) => m.role === "system");
    const conversationMessages = messages.filter((m) => m.role !== "system");

    let systemPrompt = options.systemPrompt || "";
    for (const msg of systemMessages) {
      const text =
        typeof msg.content === "string"
          ? msg.content
          : (msg.content as any[])
              .filter((c) => c.type === "text")
              .map((c) => c.text)
              .join("\n");
      systemPrompt += (systemPrompt ? "\n\n" : "") + text;
    }

    const openaiMessages = flattenMessages(conversationMessages, systemPrompt);
    const openaiTools = options.tools?.map(toOpenAITool);

    const stream = await this.client.chat.completions.create({
      model: this.getModel(options.tier),
      max_tokens: options.maxTokens,
      messages: openaiMessages,
      tools: openaiTools && openaiTools.length > 0 ? openaiTools : undefined,
      temperature: options.temperature,
      stream: true,
    });

    yield { type: "message_start" };

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        yield {
          type: "content_block_delta",
          delta: { type: "text_delta", text: delta.content },
        };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.id) {
            yield {
              type: "content_block_start",
              contentBlock: {
                type: "tool_use",
                id: tc.id,
                name: tc.function?.name,
              },
            };
          }
          if (tc.function?.arguments) {
            yield {
              type: "content_block_delta",
              delta: {
                type: "input_json_delta",
                partialJson: tc.function.arguments,
              },
            };
          }
        }
      }

      if (chunk.choices[0]?.finish_reason) {
        const fr = chunk.choices[0].finish_reason;
        let stopReason: StopReason = "end_turn";
        if (fr === "tool_calls") stopReason = "tool_use";
        else if (fr === "length") stopReason = "max_tokens";

        yield { type: "message_delta", stopReason };
      }
    }

    yield { type: "message_stop" };
  }
}

export function createOpenAIProvider(config: ProviderConfig): AgentProvider {
  return new OpenAIProvider(config);
}
