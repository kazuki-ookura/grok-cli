import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GrokClient } from "./client.js";

vi.mock("axios", () => ({
  default: {
    post: vi.fn(),
    isAxiosError: vi.fn(() => false),
  },
}));

import axios from "axios";

describe("GrokClient.chatStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("buffers streamed function arguments until the tool call is complete", async () => {
    const mockedAxios = vi.mocked(axios, true);
    mockedAxios.post.mockResolvedValue({
      data: Readable.from([
        'data: {"id":"resp_123","type":"response.created"}\n',
        'data: {"type":"response.output_item.added","item":{"arguments":"","call_id":"call_123","name":"bash","type":"function_call","id":"fc_123","status":"in_progress"},"output_index":0}\n',
        'data: {"type":"response.function_call_arguments.delta","delta":"{\\"command\\":\\"du -sh ~/Sites\\"}","item_id":"fc_123","output_index":0}\n',
        'data: {"type":"response.function_call_arguments.done","arguments":"{\\"command\\":\\"du -sh ~/Sites\\"}","item_id":"fc_123","output_index":0}\n',
        'data: {"type":"response.output_item.done","item":{"arguments":"{\\"command\\":\\"du -sh ~/Sites\\"}","call_id":"call_123","name":"bash","type":"function_call","id":"fc_123","status":"completed"},"output_index":0}\n',
        "data: [DONE]\n",
      ]),
    });

    const client = new GrokClient("test-key", "grok-4-1-fast-reasoning");
    const chunks: any[] = [];

    for await (const chunk of client.chatStream(
      [{ role: "user", content: "calculate the size of ~/Sites" } as any],
      [{
        type: "function",
        function: {
          name: "bash",
          description: "Execute a bash command",
          parameters: {
            type: "object",
            properties: {
              command: { type: "string" },
            },
            required: ["command"],
          },
        },
      }]
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].choices[0].delta.tool_calls[0]).toEqual({
      index: 0,
      id: "call_123",
      type: "function",
      function: {
        name: "bash",
        arguments: '{"command":"du -sh ~/Sites"}',
      },
    });
  });
});
