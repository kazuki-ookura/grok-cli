import OpenAI from "openai";
import axios from "axios";
import type { ChatCompletionMessageParam } from "openai/resources/chat";

export type GrokMessage = ChatCompletionMessageParam;

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
  private toolCompatibleFallbackModel: string = "grok-4-1-fast-reasoning";
  private hasWarnedAboutModelFallback = false;

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
      this.currentModel = this.resolveToolCompatibleModel(model);
    }
  }

  /**
   * Sets the AI model to be used by the agent.
   * 
   * @param model - Model name to update (e.g., "grok-3", "grok-2").
   */
  setModel(model: string): void {
    this.currentModel = this.resolveToolCompatibleModel(model);
  }

  /**
   * Retrieves the currently configured AI model name.
   * 
   * @returns Current model name.
   */
  getCurrentModel(): string {
    return this.currentModel;
  }

  private supportsServerSideTools(model: string): boolean {
    return typeof model === "string" && model.toLowerCase().includes("grok-4");
  }

  private resolveToolCompatibleModel(model: string): string {
    if (this.supportsServerSideTools(model)) {
      return model;
    }

    if (!this.hasWarnedAboutModelFallback) {
      console.warn(
        `Model ${model} does not support tool-enabled requests. Falling back to ${this.toolCompatibleFallbackModel}.`
      );
      this.hasWarnedAboutModelFallback = true;
    }

    return this.toolCompatibleFallbackModel;
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
      const toolPayload = (tools || []).map(t => {
        if (t.type === "function") {
          return {
            type: "function",
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters
          };
        }
        return t;
      });

      // Reset state if we have a fresh conversation
      if (messages.length <= 2 && this.lastResponseId) {
        this.lastResponseId = null;
      }

      const lastMessage = messages[messages.length - 1];
      let input: any;

      if (this.lastResponseId) {
        // If continuing, only send the latest message
        if (lastMessage.role === "tool") {
          input = [{
            role: "tool",
            tool_call_id: lastMessage.tool_call_id,
            content: lastMessage.content
          }];
        } else {
          input = lastMessage.content;
        }
      } else {
        // Starting fresh
        input = messages;
      }

      const requestModel = this.resolveToolCompatibleModel(model || this.currentModel);

      const payload: any = {
        model: requestModel,
        input,
        tools: toolPayload,
        tool_choice: tools && tools.length > 0 ? "auto" : undefined,
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
      const toolPayload = (tools || []).map(t => {
        if (t.type === "function") {
          return {
            type: "function",
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters
          };
        }
        return t;
      });

      // Reset state if we have a fresh conversation
      if (messages.length <= 2 && this.lastResponseId) {
        this.lastResponseId = null;
      }

      const lastMessage = messages[messages.length - 1];
      let input: any;

      if (this.lastResponseId) {
        // If continuing, only send the latest message
        if (lastMessage.role === "tool") {
          input = [{
            role: "tool",
            tool_call_id: lastMessage.tool_call_id,
            content: lastMessage.content
          }];
        } else {
          input = lastMessage.content;
        }
      } else {
        // Starting fresh
        input = messages;
      }

      const requestModel = this.resolveToolCompatibleModel(model || this.currentModel);

      const payload: any = {
        model: requestModel,
        input,
        tools: toolPayload,
        tool_choice: tools && tools.length > 0 ? "auto" : undefined,
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
      const pendingToolCalls = new Map<
        string,
        { id: string; name: string; arguments: string }
      >();

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
              pendingToolCalls.set(data.item.id, {
                id: data.item.call_id || data.item.id,
                name: data.item.name,
                arguments: data.item.arguments || ""
              });
            } else if (data.type === "response.function_call_arguments.delta" && data.item_id) {
              const pending = pendingToolCalls.get(data.item_id) || {
                id: data.item_id,
                name: "",
                arguments: ""
              };
              pending.arguments += data.delta || "";
              pendingToolCalls.set(data.item_id, pending);
            } else if (data.type === "response.function_call_arguments.done" && data.item_id) {
              const pending = pendingToolCalls.get(data.item_id) || {
                id: data.item_id,
                name: "",
                arguments: ""
              };
              pending.arguments = data.arguments || pending.arguments;
              pendingToolCalls.set(data.item_id, pending);
            } else if (data.type === "response.output_item.done" && data.item?.type === "function_call") {
              const pending = pendingToolCalls.get(data.item.id);
              const toolName = data.item.name || pending?.name || "";
              const toolArguments = data.item.arguments || pending?.arguments || "";
              pendingToolCalls.delete(data.item.id);

              yield {
                choices: [{
                  delta: {
                    tool_calls: [{
                      index: 0,
                      id: data.item.call_id || data.item.id,
                      type: "function",
                      function: {
                        name: toolName,
                        arguments: toolArguments
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

    return this.chat([searchMessage], [{ type: "web_search" }, { type: "x_search" }]);
  }
}
