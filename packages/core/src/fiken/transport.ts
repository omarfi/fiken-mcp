export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface FikenHttpRequest {
  method: HttpMethod;
  /**
   * Path relative to https://api.fiken.no/api/v2, starting with "/". Path parameters are
   * already encoded and the query string is appended.
   */
  path: string;
  headers?: Record<string, string>;
  body?: string | ArrayBuffer;
}

/**
 * Sends one HTTP request to the Fiken API on behalf of the signed-in user.
 *
 * The platform implements it. It owns authentication (the bearer token) and Fiken's rate
 * limits: at most one concurrent request per user and at most 4 per second.
 */
export interface FikenTransport {
  send(request: FikenHttpRequest): Promise<Response>;
}
