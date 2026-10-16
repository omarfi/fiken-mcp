import { SERVER_DISPLAY_NAME } from "@fiken-mcp/core";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export interface PageOptions {
  title: string;
  /** Trusted HTML. Escape every value that came from a client or a user. */
  body: string;
  status?: number;
  /** Extra origins the page's form may submit to, through redirects included. */
  formAction?: string[];
  headers?: Headers;
}

/** Renders a server page with a strict CSP. Pages carry no script. */
export function htmlPage(options: PageOptions): Response {
  const nonce = base64(crypto.getRandomValues(new Uint8Array(16)));
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.append(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      `style-src 'nonce-${nonce}'`,
      `form-action ${["'self'", ...(options.formAction ?? [])].join(" ")}`,
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join("; "),
  );

  const html = `<!doctype html>
<html lang="nb">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(options.title)} · ${escapeHtml(SERVER_DISPLAY_NAME)}</title>
<style nonce="${nonce}">${STYLES}</style>
</head>
<body>
<main>
<div class="brand">${escapeHtml(SERVER_DISPLAY_NAME)}</div>
${options.body}
<footer>${escapeHtml(SERVER_DISPLAY_NAME)} er ikke tilknyttet Fiken AS.</footer>
</main>
</body>
</html>`;
  return new Response(html, { status: options.status ?? 200, headers });
}

export function messagePage(status: number, title: string, message: string, detail?: string): Response {
  const body = `<section class="card">
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
${detail ? `<p class="detail">${escapeHtml(detail)}</p>` : ""}
</section>`;
  return htmlPage({ title, body, status });
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const STYLES = `
:root{color-scheme:light dark;--bg:#fafafa;--surface:#fff;--border:#e5e5e5;--border-strong:#a3a3a3;--text:#171717;--muted:#666;--primary:#171717;--on-primary:#fff;--warn-bg:#fffbeb;--warn-border:#fcd34d}
@media (prefers-color-scheme:dark){:root{--bg:#0a0a0a;--surface:#141414;--border:#262626;--border-strong:#525252;--text:#ededed;--muted:#a1a1a1;--primary:#ededed;--on-primary:#0a0a0a;--warn-bg:#1f1a0b;--warn-border:#78591a}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:460px;margin:0 auto;padding:56px 16px 40px}
.brand{font-size:13px;font-weight:600;color:var(--muted);margin:0 0 16px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px}
h1{font-size:20px;line-height:1.3;font-weight:600;margin:0 0 8px;letter-spacing:-.01em}
p{margin:0 0 16px;color:var(--muted)}
.detail{font-size:13px}
dl{margin:0 0 20px;border-top:1px solid var(--border)}
dl div{display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid var(--border);font-size:14px}
dt{color:var(--muted)}
dd{margin:0;font-weight:500;text-align:right;word-break:break-all}
.warning{background:var(--warn-bg);border:1px solid var(--warn-border);border-radius:8px;padding:12px;margin:0 0 20px;font-size:14px;color:var(--text)}
fieldset{border:0;margin:0 0 24px;padding:0}
legend{font-size:14px;font-weight:600;margin:0 0 8px;padding:0}
label.option{display:flex;gap:12px;align-items:flex-start;padding:12px;border:1px solid var(--border);border-radius:8px;cursor:pointer}
label.option+label.option{margin-top:8px}
label.option:has(input:checked){border-color:var(--border-strong)}
label.option input{margin:3px 0 0;accent-color:var(--primary)}
label.option strong{display:block;font-weight:500}
label.option span{display:block;color:var(--muted);font-size:14px}
.actions{display:flex;gap:8px;justify-content:flex-end}
button{font:inherit;font-weight:500;font-size:14px;padding:8px 14px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer}
button.primary{background:var(--primary);border-color:var(--primary);color:var(--on-primary)}
button:focus-visible,input:focus-visible{outline:2px solid var(--text);outline-offset:2px}
footer{margin-top:20px;font-size:13px;color:var(--muted)}
`;
