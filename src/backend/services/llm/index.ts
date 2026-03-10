/**
 * Agent Providers
 * Factory and exports for LLM provider abstraction
 *
 * This module provides a unified interface for interacting with different
 * LLM providers (Anthropic Claude, Google Gemini, etc.)
 *
 * Usage:
 *   const provider = createProvider('gemini', { apiKey: '...' });
 *   const response = await provider.chat(messages, options);
 */

// Re-export all types
export type {
  // Message types
  UnifiedRole,
  UnifiedMessage,
  UnifiedContent,
  TextContent,
  ToolUseContent,
  ToolResultContent,
  ImageContent,

  // Tool types
  UnifiedTool,
  UnifiedToolCall,
  JSONSchema,

  // Response types
  UnifiedResponse,
  StopReason,

  // Streaming types
  UnifiedStreamChunk,
  StreamEventType,
  TextDelta,
  ToolInputDelta,

  // Configuration types
  ModelTier,
  ModelConfig,
  ChatOptions,
  ProviderConfig,
  ProviderOptions,
  GeminiOptions,
  AnthropicOptions,

  // Provider types
  AgentProvider,
  ProviderName,
  ProviderCapabilities,
  ProviderFactory,
  ProviderRegistry,
} from "./types";

// Import provider implementations
import { createAnthropicProvider, AnthropicProvider } from "./anthropic";
import { createGeminiProvider, GeminiProvider } from "./gemini";
import { createOpenAIProvider, OpenAIProvider } from "./openai";

// Import types for factory
import type {
  AgentProvider,
  ProviderName,
  ProviderConfig,
  ProviderRegistry,
  ModelConfig,
} from "./types";

// Re-export provider classes and factories
export {
  AnthropicProvider,
  createAnthropicProvider,
  GeminiProvider,
  createGeminiProvider,
  OpenAIProvider,
  createOpenAIProvider,
};

// Re-export utility functions from both providers
export {
  extractToolCalls,
  extractText,
  hasToolCalls,
  createToolResultMessage,
} from "./anthropic";

/**
 * Provider registry - maps provider names to factory functions
 */
const providerRegistry: ProviderRegistry = {
  anthropic: createAnthropicProvider,
  gemini: createGeminiProvider,
  openai: createOpenAIProvider,
};

/**
 * Default model configurations for each provider
 */
export const DEFAULT_MODELS: Record<ProviderName, ModelConfig> = {
  anthropic: {
    fast: "claude-sonnet-4-5-20250929",
    smart: "claude-opus-4-0-20250514",
  },
  gemini: {
    fast: "gemini-3-flash-preview",
    smart: "gemini-3-pro-preview",
  },
  openai: {
    fast: "gpt-4o-mini",
    smart: "gpt-4o",
  },
};

/**
 * Create a provider instance
 *
 * @param name - The provider name ('anthropic', 'gemini', 'openai')
 * @param config - Provider configuration (apiKey, models, etc.)
 * @returns An AgentProvider instance
 *
 * @example
 * ```ts
 * // Create a Gemini provider
 * const provider = createProvider('gemini', {
 *   apiKey: process.env.GEMINI_API_KEY!,
 * });
 *
 * // Use it
 * const response = await provider.chat(messages, {
 *   tier: 'fast',
 *   maxTokens: 4096,
 *   systemPrompt: 'You are a helpful assistant.',
 *   tools: myTools,
 * });
 * ```
 */
export function createProvider(
  name: ProviderName,
  config: Partial<ProviderConfig> & { apiKey: string },
): AgentProvider {
  const factory = providerRegistry[name];

  if (!factory) {
    throw new Error(
      `Unknown provider: ${name}. Available providers: ${Object.keys(providerRegistry).join(", ")}`,
    );
  }

  // Merge with defaults
  const fullConfig: ProviderConfig = {
    apiKey: config.apiKey,
    models: config.models || DEFAULT_MODELS[name],
    baseUrl: config.baseUrl,
    defaultOptions: config.defaultOptions,
  };

  return factory(fullConfig);
}

/**
 * Get the provider name from environment variable
 * Defaults to 'gemini' (Gemini 3 Flash) if not set
 */
export function getProviderFromEnv(): ProviderName {
  const envProvider = process.env.AGENT_PROVIDER?.toLowerCase();

  if (envProvider === "anthropic" || envProvider === "claude") {
    return "anthropic";
  }

  if (envProvider === "openai") {
    return "openai";
  }

  // Default to Gemini 3 Flash - fast and intelligent
  return "gemini";
}

/**
 * Get the API key for a provider from environment
 */
export function getApiKeyFromEnv(provider: ProviderName): string {
  switch (provider) {
    case "anthropic":
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey) {
        throw new Error("ANTHROPIC_API_KEY environment variable is required");
      }
      return anthropicKey;

    case "gemini":
      const geminiKey =
        process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
      if (!geminiKey) {
        throw new Error(
          "GEMINI_API_KEY or GOOGLE_AI_API_KEY environment variable is required",
        );
      }
      return geminiKey;

    case "openai":
      const openaiKey = process.env.OPENAI_API_KEY;
      if (!openaiKey) {
        throw new Error("OPENAI_API_KEY environment variable is required");
      }
      return openaiKey;

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Create a provider from environment configuration
 *
 * Uses AGENT_PROVIDER env var to determine which provider to use,
 * and the appropriate API key env var for that provider.
 *
 * @example
 * ```ts
 * // Set AGENT_PROVIDER=gemini and GEMINI_API_KEY=...
 * const provider = createProviderFromEnv();
 * ```
 */
export function createProviderFromEnv(
  overrides?: Partial<ProviderConfig>,
): AgentProvider {
  const providerName = getProviderFromEnv();
  const apiKey = getApiKeyFromEnv(providerName);

  return createProvider(providerName, {
    apiKey,
    ...overrides,
  });
}

/**
 * Check if a provider is available (has API key configured)
 */
export function isProviderAvailable(provider: ProviderName): boolean {
  try {
    getApiKeyFromEnv(provider);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get list of available providers (those with API keys configured)
 */
export function getAvailableProviders(): ProviderName[] {
  const providers: ProviderName[] = ["anthropic", "gemini", "openai"];
  return providers.filter(isProviderAvailable);
}
