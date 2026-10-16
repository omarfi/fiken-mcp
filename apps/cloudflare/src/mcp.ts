import type { OAuthResourceAuth } from "@cloudflare/workers-oauth-provider";
import { FikenClient, FikenTransportError, handleMcpRequest, type FikenTransport } from "@fiken-mcp/core";
import { accessFromScopes, type AccessProps } from "./auth/props.ts";
import { log } from "./log.ts";
import { issueUploadLink } from "./upload.ts";

/** Protected /mcp route. OAuthProvider has validated our access token and decrypted the grant props. */
export const mcpHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { props, auth } = ctx as ExecutionContext<AccessProps> & { auth?: OAuthResourceAuth };
    const access = accessFromScopes(auth?.scope);
    return handleMcpRequest(request, {
      fiken: new FikenClient(queueTransport(env, props)),
      access,
      issueUploadLink: (target) => issueUploadLink(env, props, target),
      onToolCall: (event) => log("tool_call", { ...event, access }),
      // The error name only: messages can carry tool input.
      onError: (error) => log("mcp_error", { error: error instanceof Error ? error.name : typeof error }),
    });
  },
};

/** Sends every Fiken call through this user's FikenUserQueue. */
export function queueTransport(env: Env, props: AccessProps): FikenTransport {
  const queue = env.FIKEN_USER_QUEUE.get(env.FIKEN_USER_QUEUE.idFromName(props.queueKey));
  return {
    async send(request) {
      const result = await queue.send({ ...request, accessToken: props.fiken.accessToken });
      if (!result.ok) throw new FikenTransportError(result.kind, result.retryAfterSeconds);
      return new Response(result.body, { status: result.status, headers: result.headers });
    },
  };
}
