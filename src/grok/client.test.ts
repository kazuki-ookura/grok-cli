import { Readable } from "node:stream";
import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrokClient } from "./client.js";

describe("GrokClient", () => {
  beforeEach(() => {
    delete process.env.GROK_DISABLE_NATIVE_SEARCH;
    delete process.env.GROK_FORCE_NATIVE_SEARCH;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends all trailing tool outputs as function_call_output items", async () => {
    const postSpy = vi.spyOn(axios, "post").mockResolvedValue({
      data: {
        id: "resp_next",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "ok" }],
          },
        ],
      },
    } as any);

    const client = new GrokClient("dummy", "grok-code-fast-1") as any;
    client.lastResponseId = "resp_prev";

    await client.chat(
      [
        { role: "system", content: "sys" },
        { role: "user", content: "hello" },
        { role: "assistant", content: "", tool_calls: [] },
        { role: "tool", tool_call_id: "call_1", content: "FIRST" },
        { role: "tool", tool_call_id: "call_2", content: "SECOND" },
      ] as any,
      [
        {
          type: "web_search",
        },
        {
          type: "x_search",
        },
        {
          type: "function",
          function: {
            name: "view_file",
            description: "View a file",
            parameters: {
              type: "object",
              properties: {},
              required: [],
            },
          },
        },
      ] as any
    );

    const [, payload] = postSpy.mock.calls[0] as [string, any];
    expect(payload.model).toBe("grok-code-fast-1");
    expect(payload.previous_response_id).toBe("resp_prev");
    expect(payload.input).toEqual([
      {
        type: "function_call_output",
        call_id: "call_1",
        output: "FIRST",
      },
      {
        type: "function_call_output",
        call_id: "call_2",
        output: "SECOND",
      },
    ]);
    expect(payload.tools).toEqual([
      {
        type: "function",
        name: "view_file",
        description: "View a file",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    ]);
  });

  it("uses a Grok 4 model for built-in search when the current model does not support it", async () => {
    const postSpy = vi.spyOn(axios, "post").mockResolvedValue({
      data: {
        id: "resp_search",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "search result" }],
          },
        ],
      },
    } as any);

    const client = new GrokClient("dummy", "grok-3-fast");
    await client.search("latest xAI news");

    const [, payload] = postSpy.mock.calls[0] as [string, any];
    expect(payload.model).toBe("grok-4-1-fast-reasoning");
    expect(payload.tools).toEqual([{ type: "web_search" }, { type: "x_search" }]);
  });

  it("normalizes continuation payloads in chatStream as well", async () => {
    const postSpy = vi.spyOn(axios, "post").mockResolvedValue({
      data: Readable.from([
        'data: {"id":"resp_stream","type":"response.output_text.delta","delta":"hel"}\n',
        'data: {"type":"response.output_text.delta","delta":"lo"}\n',
        "data: [DONE]\n",
      ]),
    } as any);

    const client = new GrokClient("dummy", "grok-code-fast-1") as any;
    client.lastResponseId = "resp_prev";

    const chunks: string[] = [];
    for await (const chunk of client.chatStream(
      [
        { role: "assistant", content: "", tool_calls: [] },
        { role: "tool", tool_call_id: "call_stream_1", content: "ONE" },
        { role: "tool", tool_call_id: "call_stream_2", content: "TWO" },
      ] as any,
      [{ type: "web_search" }] as any
    )) {
      const content = chunk.choices?.[0]?.delta?.content;
      if (content) {
        chunks.push(content);
      }
    }

    const [, payload] = postSpy.mock.calls[0] as [string, any];
    expect(payload.input).toEqual([
      {
        type: "function_call_output",
        call_id: "call_stream_1",
        output: "ONE",
      },
      {
        type: "function_call_output",
        call_id: "call_stream_2",
        output: "TWO",
      },
    ]);
    expect(payload.tools).toEqual([]);
    expect(chunks.join("")).toBe("hello");
  });
});
