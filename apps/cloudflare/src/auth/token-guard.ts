/** client_id from the form, Basic auth, or the issuer of a private_key_jwt assertion. */
export async function tokenClientId(request: Request): Promise<string | undefined> {
  const basic = /^Basic\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (basic) {
    try {
      // RFC 6749 form-encodes the client ID, but a URL client ID sent raw also contains ":". The secret
      // follows the last colon either way.
      const credentials = atob(basic);
      return decodeURIComponent(credentials.slice(0, Math.max(0, credentials.lastIndexOf(":"))));
    } catch {
      return undefined;
    }
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return undefined;
  }
  const clientId = form.get("client_id");
  if (typeof clientId === "string" && clientId) return clientId;
  const assertion = form.get("client_assertion");
  if (typeof assertion !== "string") return undefined;
  try {
    const payload = JSON.parse(atob((assertion.split(".")[1] ?? "").replace(/-/g, "+").replace(/_/g, "/"))) as { iss?: unknown };
    return typeof payload.iss === "string" ? payload.iss : undefined;
  } catch {
    return undefined;
  }
}
