import type { OAuthResourceAuth } from "@cloudflare/workers-oauth-provider";
import { FikenClient, FikenTransportError, handleMcpRequest, type FikenTransport } from "@fiken-mcp/core";
import { accessFromScopes, type GrantProps } from "./auth/props.ts";
import { log } from "./log.ts";

/** Protected /mcp route. OAuthProvider has validated our access token and decrypted the grant props. */
export const mcpHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { props, auth } = ctx as ExecutionContext<GrantProps> & { auth?: OAuthResourceAuth };
    const access = accessFromScopes(auth?.scope);
    return handleMcpRequest(request, {
      fiken: new FikenClient(queueTransport(env, props)),
      access,
      onToolCall: (event) => log("tool_call", { ...event, access }),
      // The error name only: messages can carry tool input.
      onError: (error) => log("mcp_error", { error: error instanceof Error ? error.name : typeof error }),
    });
  },
};

/** Sends every Fiken call through this user's FikenUserQueue. */
function queueTransport(env: Env, props: GrantProps): FikenTransport {
  const queue = env.FIKEN_USER_QUEUE.get(env.FIKEN_USER_QUEUE.idFromName(props.queueKey));
  return {
    async send(request) {
      const result = await queue.send({ ...request, accessToken: props.fiken.accessToken });
      if (!result.ok) throw new FikenTransportError(result.kind, result.retryAfterSeconds);
      return new Response(result.body, { status: result.status, headers: result.headers });
    },
  };
}
