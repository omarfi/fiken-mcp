import { checkUpload, FikenClient, MAX_UPLOAD_BYTES, UPLOAD_EXTENSIONS, uploadAttachment, type UploadLink, type UploadTarget } from "@fiken-mcp/core";
import type { GrantProps } from "./auth/props.ts";
import { PUBLIC_ORIGIN } from "./config.ts";
import { log } from "./log.ts";
import { queueTransport } from "./mcp.ts";
import { escapeHtml, htmlPage, messagePage } from "./ui/page.ts";

const TTL_SECONDS = 15 * 60;
const KEY_PREFIX = "upload:";

/** What an upload link carries. Stored encrypted with a key only the link itself derives. */
interface UploadRecord {
  queueKey: string;
  accessToken: string;
  target: UploadTarget;
  expiresAt: number;
}

const TARGET_NAMES: Record<UploadTarget["type"], string> = {
  inbox: "innboksen i Fiken",
  purchase_draft: "kjøpsutkast",
  sale_draft: "salgsutkast",
  purchase: "kjøp",
  sale: "salg",
};

/**
 * Issues a one-time link: a random 256-bit token. KV holds only the SHA-256 of the token and the
 * record encrypted with AES-GCM under a key derived from the token, so KV alone reveals nothing.
 */
export async function issueUploadLink(env: Env, props: GrantProps, target: UploadTarget): Promise<UploadLink> {
  const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = Date.now() + TTL_SECONDS * 1000;
  const record: UploadRecord = { queueKey: props.queueKey, accessToken: props.fiken.accessToken, target, expiresAt };
  const { id, key } = await derive(token);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(record)));
  await env.OAUTH_KV.put(KEY_PREFIX + id, JSON.stringify({ iv: base64Url(iv), data: base64Url(new Uint8Array(sealed)) }), {
    expirationTtl: TTL_SECONDS,
  });
  log("upload_link_issued", { target: target.type });
  return { url: `${PUBLIC_ORIGIN}/upload/${token}`, expiresAt: new Date(expiresAt).toISOString() };
}

/** GET /upload/:token: the upload page. */
export async function showUploadPage(env: Env, token: string): Promise<Response> {
  const record = await open(env, token);
  if (!record) return expired();
  const what = TARGET_NAMES[record.target.type] + (record.target.id === undefined ? "" : ` ${record.target.id}`);
  return htmlPage({
    title: "Last opp kvittering",
    body: `<section class="card">
<h1>Last opp kvittering eller bilag</h1>
<p>Filen legges på ${escapeHtml(what)}. PDF eller bilde, maks 10 MB. Lenken virker én gang.</p>
<form method="post" enctype="multipart/form-data">
  <fieldset>
    <legend>Fil</legend>
    <input type="file" name="file" required accept="${UPLOAD_EXTENSIONS.join(",")}">
  </fieldset>
  <div class="actions"><button type="submit" class="primary">Last opp</button></div>
</form>
</section>`,
  });
}

/** POST /upload/:token: sends the file to Fiken through the user's queue. The link is spent first, so it works once. */
export async function receiveUpload(env: Env, token: string, request: Request): Promise<Response> {
  const record = await open(env, token);
  if (!record) return expired();
  const { id } = await derive(token);
  await env.OAUTH_KV.delete(KEY_PREFIX + id);

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_UPLOAD_BYTES + 64 * 1024) return messagePage(413, "Filen er for stor", "Filen kan være maks 10 MB. Be om en ny lenke i samtalen.");

  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") return messagePage(400, "Ingen fil", "Velg en fil og prøv igjen. Be om en ny lenke i samtalen.");
  const upload = { name: file.name, type: file.type, bytes: await file.arrayBuffer() };
  const problem = checkUpload(upload);
  if (problem) return messagePage(400, "Filen kan ikke lastes opp", `${problem} Be om en ny lenke i samtalen.`);

  const props = { queueKey: record.queueKey, fiken: { accessToken: record.accessToken, refreshToken: "", expiresAt: 0 } } satisfies GrantProps;
  try {
    await uploadAttachment(new FikenClient(queueTransport(env, props)), record.target, upload);
  } catch (error) {
    log("upload_failed", { target: record.target.type, error: error instanceof Error ? error.name : "unknown" });
    return messagePage(502, "Opplastingen feilet", "Fiken tok ikke imot filen. Be om en ny lenke i samtalen og prøv igjen.");
  }
  log("upload_done", { target: record.target.type, bytes: upload.bytes.byteLength });
  return messagePage(200, "Filen er lastet opp", "Du kan lukke vinduet og gå tilbake til samtalen.");
}

async function open(env: Env, token: string): Promise<UploadRecord | undefined> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
  const { id, key } = await derive(token);
  const stored = await env.OAUTH_KV.get<{ iv: string; data: string }>(KEY_PREFIX + id, "json");
  if (!stored) return undefined;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(stored.iv) }, key, fromBase64Url(stored.data));
    const record = JSON.parse(new TextDecoder().decode(plain)) as UploadRecord;
    return record.expiresAt > Date.now() ? record : undefined;
  } catch {
    return undefined;
  }
}

async function derive(token: string): Promise<{ id: string; key: CryptoKey }> {
  const digest = (label: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${label}:${token}`));
  const id = [...new Uint8Array(await digest("id"))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const key = await crypto.subtle.importKey("raw", await digest("key"), "AES-GCM", false, ["encrypt", "decrypt"]);
  return { id, key };
}

function expired(): Response {
  return messagePage(410, "Lenken er brukt eller utløpt", "Be om en ny lenke i samtalen.");
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
