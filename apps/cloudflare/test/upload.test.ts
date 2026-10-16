import { describe, expect, it } from "vitest";
import type { GrantProps } from "../src/auth/props.ts";
import type { QueuedRequest, QueueResult } from "../src/queue.ts";
import { issueUploadLink, receiveUpload, showUploadPage } from "../src/upload.ts";

const SECRET_TOKEN = "fiken-access-token-abc123";

/** An in-memory stand-in for the bindings upload.ts uses. */
function fakeEnv() {
  const kv = new Map<string, string>();
  const sent: QueuedRequest[] = [];
  const env = {
    OAUTH_KV: {
      put: (key: string, value: string) => Promise.resolve(void kv.set(key, value)),
      get: (key: string) => Promise.resolve(kv.has(key) ? JSON.parse(kv.get(key) ?? "null") : null),
      delete: (key: string) => Promise.resolve(void kv.delete(key)),
    },
    FIKEN_USER_QUEUE: {
      idFromName: (name: string) => name,
      get: () => ({
        send: (request: QueuedRequest): Promise<QueueResult> => {
          sent.push(request);
          return Promise.resolve({ ok: true, status: 201, headers: [["location", "https://api.fiken.no/api/v2/x/1"], ["content-length", "0"]], body: null });
        },
      }),
    },
  } as unknown as Env;
  return { env, kv, sent };
}

const props: GrantProps = { queueKey: "user-hash", fiken: { accessToken: SECRET_TOKEN, refreshToken: "r", expiresAt: 0 } };
const target = { companySlug: "test-as", type: "purchase_draft" as const, id: 8 };

function tokenOf(url: string): string {
  return url.split("/").at(-1) ?? "";
}

function uploadRequest(token: string, name = "kvittering.pdf"): Request {
  const form = new FormData();
  form.set("file", new File([new TextEncoder().encode("%PDF-1.4")], name, { type: "application/pdf" }));
  return new Request(`https://fiken.mcp.wollums.no/upload/${token}`, { method: "POST", body: form });
}

describe("upload links", () => {
  it("stores nothing readable in KV: no token, no Fiken access token", async () => {
    const { env, kv } = fakeEnv();
    const link = await issueUploadLink(env, props, target);
    const token = tokenOf(link.url);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = [...kv.entries()].join(" ");
    expect(stored).not.toContain(token);
    expect(stored).not.toContain(SECRET_TOKEN);
    expect(stored).not.toContain("test-as");
  });

  it("shows the page, sends the file to the target through the user's queue, and works once", async () => {
    const { env, sent } = fakeEnv();
    const token = tokenOf((await issueUploadLink(env, props, target)).url);

    const page = await showUploadPage(env, token);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await page.text()).toContain("kjøpsutkast 8");

    const done = await receiveUpload(env, token, uploadRequest(token));
    expect(done.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ method: "POST", path: "/companies/test-as/purchases/drafts/8/attachments", accessToken: SECRET_TOKEN });

    expect((await receiveUpload(env, token, uploadRequest(token))).status).toBe(410);
    expect((await showUploadPage(env, token)).status).toBe(410);
    expect(sent).toHaveLength(1);
  });

  it("refuses an unknown or malformed token and a file type Fiken does not take", async () => {
    const { env, sent } = fakeEnv();
    expect((await showUploadPage(env, "x".repeat(43))).status).toBe(410);
    expect((await showUploadPage(env, "../../etc")).status).toBe(410);

    const token = tokenOf((await issueUploadLink(env, props, target)).url);
    const refused = await receiveUpload(env, token, uploadRequest(token, "program.exe"));
    expect(refused.status).toBe(400);
    expect(sent).toHaveLength(0);
  });
});
