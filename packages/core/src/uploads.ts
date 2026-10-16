import type { FikenClient } from "./fiken/client.ts";

/**
 * Receipts and vouchers the user uploads through a one-time link. The platform owns the link and
 * the page; core owns where the file goes in Fiken.
 */

export const UPLOAD_TARGET_TYPES = ["inbox", "purchase_draft", "sale_draft", "purchase", "sale"] as const;
export type UploadTargetType = (typeof UPLOAD_TARGET_TYPES)[number];

export interface UploadTarget {
  companySlug: string;
  type: UploadTargetType;
  /** The draft, purchase or sale. Not used for the inbox. */
  id?: number | undefined;
}

export interface UploadLink {
  url: string;
  expiresAt: string;
}

export type UploadLinkIssuer = (target: UploadTarget) => Promise<UploadLink>;

/** File types Fiken accepts for attachments (spec: "Must end with either .png, .jpeg, .jpg, .gif or .pdf"). */
export const UPLOAD_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".gif"] as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface UploadFile {
  name: string;
  type: string;
  bytes: ArrayBuffer;
}

/** Why a file was refused, in Norwegian for the upload page; undefined when it is fine. */
export function checkUpload(file: UploadFile): string | undefined {
  const name = file.name.toLowerCase();
  if (!UPLOAD_EXTENSIONS.some((extension) => name.endsWith(extension))) return "Filen må være PDF, PNG, JPG eller GIF.";
  if (file.bytes.byteLength === 0) return "Filen er tom.";
  if (file.bytes.byteLength > MAX_UPLOAD_BYTES) return "Filen er større enn 10 MB.";
  return undefined;
}

/** Sends the file to its target in Fiken as multipart, which every attachment endpoint takes. */
export async function uploadAttachment(fiken: FikenClient, target: UploadTarget, file: UploadFile): Promise<void> {
  const problem = checkUpload(file);
  if (problem) throw new Error(problem);

  const form = new FormData();
  form.set("filename", file.name);
  form.set("file", new Blob([file.bytes], { type: file.type || "application/octet-stream" }), file.name);
  const companySlug = target.companySlug;

  if (target.type === "inbox") {
    form.set("name", file.name);
    form.set("description", "Lastet opp via Fiken av Wollum AS");
    await fiken.api.POST("/companies/{companySlug}/inbox", { params: { path: { companySlug } }, body: form as never });
    return;
  }

  const id = target.id;
  if (id === undefined) throw new Error("Upload target needs an id");
  const body = form as never;
  switch (target.type) {
    case "purchase_draft":
      await fiken.api.POST("/companies/{companySlug}/purchases/drafts/{draftId}/attachments", { params: { path: { companySlug, draftId: id } }, body });
      return;
    case "sale_draft":
      await fiken.api.POST("/companies/{companySlug}/sales/drafts/{draftId}/attachments", { params: { path: { companySlug, draftId: id } }, body });
      return;
    case "purchase":
      await fiken.api.POST("/companies/{companySlug}/purchases/{purchaseId}/attachments", { params: { path: { companySlug, purchaseId: id } }, body });
      return;
    case "sale":
      await fiken.api.POST("/companies/{companySlug}/sales/{saleId}/attachments", { params: { path: { companySlug, saleId: id } }, body });
      return;
  }
}
