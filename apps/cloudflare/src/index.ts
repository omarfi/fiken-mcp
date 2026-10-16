import { SERVER_DISPLAY_NAME } from "@fiken-mcp/core";

// Placeholder until M1 wires up OAuthProvider and the MCP endpoint.
export default {
  fetch(): Response {
    return new Response(`${SERVER_DISPLAY_NAME}\n`, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
} satisfies ExportedHandler<Env>;
