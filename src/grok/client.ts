import OpenAI from "openai";
import axios from "axios";
import type { ChatCompletionMessageParam } from "openai/resources/chat";

export type GrokMessage = ChatCompletionMessageParam;

const BUILT_IN_SEARCH_TOOL_TYPES = new Set(["web_search", "x_search"]);

export type GrokTool = 
  | {
      type: "function";
      function: {
        name: string;
        description: string;
        parameters: {
          type: "object";
          properties: Record<string, any>;
          required: string[];
        };
      };
    }
  | {
      type: "web_search";
    }
  | {
      type: "x_search";
    };

export interface GrokToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface GrokResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: GrokToolCall[];
    };
    finish_reason: string;
  }>;
}

function supportsNativeSearchTools(model: string | undefined): boolean {
  const normalizedModel = (model || "").toLowerCase();

  if (process.env.GROK_DISABLE_NATIVE_SEARCH === "1") {
    return false;
  }

  if (process.env.GROK_FORCE_NATIVE_SEARCH === "1") {
    return true;
  }

  // xAI currently documents agentic search tooling against the Grok 4 family.
  return normalizedModel.startsWith("grok-4");
}

function normalizeToolsForModel(
  tools: GrokTool[] | undefined,
  model: string
): any[] {
  return (tools || [])
    .map((tool) => {
      if (tool.type === "function") {
        return {
          type: "function",
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        };
      }

      if (
        BUILT_IN_SEARCH_TOOL_TYPES.has(tool.type) &&
        !supportsNativeSearchTools(model)
      ) {
        return null;
      }

      return tool;
    })
    .filter(Boolean);
}

function normalizeResponseInput(
  messages: GrokMessage[],
  lastResponseId: string | null
): any[] {
  if (!lastResponseId) {
    return messages;
  }

  if (messages.length === 0) {
    return [];
  }

  const trailingToolMessages: any[] = [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const message: any = messages[index];
    if (message.role !== "tool") {
      break;
    }
    trailingToolMessages.unshift(message);
  }

  if (trailingToolMessages.length > 0) {
    return trailingToolMessages.map((message) => ({
      type: "function_call_output",
      call_id: message.tool_call_id,
      output:
        typeof message.content === "string"
          ? message.content
          : JSON.stringify(message.content ?? ""),
    }));
  }

  const lastMessage: any = messages[messages.length - 1];
  return [
    {
      role: lastMessage.role,
      content: lastMessage.content ?? "",
    },
  ];
}

/**
 * Client class for interacting with the Grok API.
 */
export class GrokClient {
  private client: OpenAI;
  private currentModel: string = "grok-4-1-fast-reasoning"; // Use model that supports the Responses API and tools
  private defaultMaxTokens: number;
  private lastResponseId: string | null = null;
  private apiKey: string;
  private baseURL: string;

  /**
   * Initializes a new instance of GrokClient.
   * 
   * @param apiKey - API authentication key.
   * @param model - AI model name to use (defaults to "grok-4-1-fast-reasoning").
   * @param baseURL - Base URL for API requests. Defaults to env var or x.ai endpoint.
   */
  constructor(apiKey: string, model?: string, baseURL?: string) {
    this.apiKey = apiKey;
    this.baseURL = baseURL || process.env.GROK_BASE_URL || "https://api.x.ai/v1";
    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      timeout: 360000,
    });
    const envMax = Number(process.env.GROK_MAX_TOKENS);
    this.defaultMaxTokens = Number.isFinite(envMax) && envMax > 0 ? envMax : 1536;
    if (model) {
      this.currentModel = model;
    }
  }

  /**
   * Sets the AI model to be used by the agent.
   * 
   * @param model - Model name to update (e.g., "grok-3", "grok-2").
   */
  setModel(model: string): void {
    this.currentModel = model;
  }

  /**
   * Retrieves the currently configured AI model name.
   * 
   * @returns Current model name.
   */
  getCurrentModel(): string {
    return this.currentModel;
  }

  /**
   * Executes chat completion in non-streaming format.
   * 
   * @param messages - Array of messages including chat history.
   * @param tools - Array of tool definitions available to the agent.
   * @param model - Optional model name to use temporarily.
   * @returns Response object from the Grok API.
   * @throws Detail error message if API communication fails.
   */
  async chat(
    messages: GrokMessage[],
    tools?: GrokTool[],
    model?: string
  ): Promise<GrokResponse> {
    try {
      const requestedModel = model || this.currentModel;
      const toolPayload = normalizeToolsForModel(tools, requestedModel);

      // Reset state if we have a fresh conversation
      if (messages.length <= 2 && this.lastResponseId) {
        this.lastResponseId = null;
      }

      const input = normalizeResponseInput(messages, this.lastResponseId);

      const payload: any = {
        model: requestedModel,
        input,
        tools: toolPayload,
        tool_choice: toolPayload.length > 0 ? "auto" : undefined,
        temperature: 0.7,
        max_output_tokens: this.defaultMaxTokens,
        stream: false
      };

      if (this.lastResponseId) {
        payload.previous_response_id = this.lastResponseId;
      }

      const response = await axios.post(`${this.baseURL}/responses`, payload, {
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        }
      });

      const data = response.data;
      this.lastResponseId = data.id;
      
      // Map xAI response back to OpenAI compatible choices format
      const assistantMessage: any = {
        role: "assistant",
        content: null,
        tool_calls: []
      };

      if (data.output) {
        for (const out of data.output) {
          if (out.type === "message" && out.content) {
            for (const c of out.content) {
              if (c.type === "output_text") {
                assistantMessage.content = (assistantMessage.content || "") + c.text;
              }
            }
          } else if (out.type === "function_call") {
            assistantMessage.tool_calls.push({
              id: out.call_id || out.id,
              type: "function",
              function: {
                name: out.name,
                arguments: out.arguments
              }
            });
          }
        }
      }

      return {
        choices: [
          {
            message: assistantMessage,
            finish_reason: assistantMessage.tool_calls.length > 0 ? "tool_calls" : "stop"
          }
        ]
      };
    } catch (error: any) {
      if (axios.isAxiosError(error) && error.response) {
        const status = error.response.status;
        const data = error.response.data;
        const msg = data.error || data.message || error.message;
        const code = data.code || 'None';
        throw new Error(`Grok API error (Status ${status}, Code ${code}): ${typeof msg === 'object' ? JSON.stringify(msg) : msg}`);
      }
      throw new Error(`Grok API error: ${error.message}`);
    }
  }

  /**
   * Executes chat completion in streaming format.
   * 
   * @param messages - Array of messages including chat history.
   * @param tools - Array of tool definitions available to the agent.
   * @param model - Optional model name to use temporarily.
   * @returns Async generator yielding chunks sequentially.
   * @throws Detail error message if API communication fails.
   */
  async *chatStream(
    messages: GrokMessage[],
    tools?: GrokTool[],
    model?: string
  ): AsyncGenerator<any, void, unknown> {
    try {
      const requestedModel = model || this.currentModel;
      const toolPayload = normalizeToolsForModel(tools, requestedModel);

      // Reset state if we have a fresh conversation
      if (messages.length <= 2 && this.lastResponseId) {
        this.lastResponseId = null;
      }

      const input = normalizeResponseInput(messages, this.lastResponseId);

      const payload: any = {
        model: requestedModel,
        input,
        tools: toolPayload,
        tool_choice: toolPayload.length > 0 ? "auto" : undefined,
        temperature: 0.7,
        max_output_tokens: this.defaultMaxTokens,
        stream: true
      };

      if (this.lastResponseId) {
        payload.previous_response_id = this.lastResponseId;
      }

      const response = await axios.post(`${this.baseURL}/responses`, payload, {
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        responseType: "stream"
      });

      const stream = response.data;
      let buffer = "";

      for await (const chunk of stream) {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.replace("data: ", "");
          if (jsonStr === "[DONE]") return;

          try {
            const data = JSON.parse(jsonStr);
            if (data.id) {
              this.lastResponseId = data.id;
            }
            // Map xAI stream event to OpenAI compatible chunk format
            if (data.type === "response.output_text.delta") {
              yield {
                choices: [{
                  delta: { content: data.delta }
                }]
              };
            } else if (data.type === "response.output_item.added" && data.item?.type === "function_call") {
              // Note: tool calls in stream might need more complex handling if streamed in parts
              // but /v1/responses seems to emit the full call at once or as chunks.
              // For simplicity, we emit when item is added.
              yield {
                choices: [{
                  delta: {
                    tool_calls: [{
                      index: 0,
                      id: data.item.call_id || data.item.id,
                      type: "function",
                      function: {
                        name: data.item.name,
                        arguments: data.item.arguments || ""
                      }
                    }]
                  }
                }]
              };
            }
          } catch (e) {
            // Ignore parse errors for incomplete lines
          }
        }
      }
    } catch (error: any) {
      const msg = error.response?.data?.error || error.message;
      throw new Error(`Grok API error: ${typeof msg === 'object' ? JSON.stringify(msg) : msg}`);
    }
  }

  /**
   * Searches for information using built-in web search tools.
   * 
   * @param query - Keywords or question to search for.
   * @returns API response containing web search results.
   */
  async search(
    query: string
  ): Promise<GrokResponse> {
    const searchMessage: GrokMessage = {
      role: "user",
      content: query,
    };

    const searchModel = supportsNativeSearchTools(this.currentModel)
      ? this.currentModel
      : "grok-4-1-fast-reasoning";

    return this.chat(
      [searchMessage],
      [{ type: "web_search" }, { type: "x_search" }],
      searchModel
    );
  }
}
