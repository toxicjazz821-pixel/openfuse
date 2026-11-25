import { createHmac, timingSafeEqual } from "node:crypto";

const GRAPH_BASE = "https://graph.facebook.com/v21.0";
const MAX_TEXT_LENGTH = 4096;

/** Meta signs every webhook POST with HMAC-SHA256 over the raw body. */
export function verifyWhatsAppSignature(
  rawBody: Buffer,
  signature: string | undefined,
  appSecret: string | undefined,
): boolean {
  if (!appSecret) return true;
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const actual = Buffer.from(signature.slice("sha256=".length), "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return actual.length === expectedBytes.length && timingSafeEqual(actual, expectedBytes);
}

/** Split on code points so a surrogate pair is never cut in half. */
export function chunkText(text: string, limit: number = MAX_TEXT_LENGTH): string[] {
  const chars = Array.from(text);
  const chunks: string[] = [];
  for (let i = 0; i < chars.length; i += limit) chunks.push(chars.slice(i, i + limit).join(""));
  return chunks.length ? chunks : [""];
}

export class WhatsAppClient {
  constructor(
    private readonly phoneNumberId: string,
    private readonly accessToken: string,
  ) {}

  private async postJson(path: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${GRAPH_BASE}/${this.phoneNumberId}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    if (!response.ok)
      throw new Error(
        `WhatsApp API ${response.status}: ${payload.error?.message ?? "request failed"}`,
      );
    return payload;
  }

  async sendText(to: string, text: string): Promise<void> {
    for (const chunk of chunkText(text)) {
      await this.postJson("/messages", {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: chunk },
      });
    }
  }

  /** Upload PNG bytes; returns the media ID used to send the image. */
  async uploadImage(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("file", new File([bytes], "generated-image.png", { type: "image/png" }));
    const response = await fetch(`${GRAPH_BASE}/${this.phoneNumberId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.accessToken}` },
      body: form,
    });
    const payload = (await response.json().catch(() => ({}))) as {
      id?: string;
      error?: { message?: string };
    };
    if (!response.ok || !payload.id)
      throw new Error(
        `WhatsApp media upload ${response.status}: ${payload.error?.message ?? "no media ID returned"}`,
      );
    return payload.id;
  }

  async sendImage(to: string, mediaId: string): Promise<void> {
    await this.postJson("/messages", {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "image",
      image: { id: mediaId },
    });
  }
}
