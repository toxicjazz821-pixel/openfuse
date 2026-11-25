import { randomUUID } from "node:crypto";
import type { Message } from "@ag-ui/core";
import { Hono } from "hono";
import type { OpenFuseClient } from "./agent.ts";
import { verifyWhatsAppSignature, type WhatsAppClient } from "./whatsapp.ts";

type SenderState = { threadId: string; history: Message[] };

type IncomingTextMessage = { from: string; id: string; body: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Pull text messages out of a Meta webhook payload; ignore statuses and receipts. */
function extractTextMessages(payload: unknown): IncomingTextMessage[] {
  const messages: IncomingTextMessage[] = [];
  if (!isRecord(payload) || !Array.isArray(payload.entry)) return messages;
  for (const entry of payload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value)) continue;
      const value = change.value;
      if (!Array.isArray(value.messages)) continue;
      for (const message of value.messages) {
        if (!isRecord(message) || typeof message.from !== "string") continue;
        const id = typeof message.id === "string" ? message.id : "";
        if (message.type !== "text") {
          messages.push({ from: message.from, id, body: null });
          continue;
        }
        const body =
          isRecord(message.text) && typeof message.text.body === "string"
            ? message.text.body
            : "";
        messages.push({ from: message.from, id, body });
      }
    }
  }
  return messages;
}

export function createWebhookApp(deps: {
  openFuse: OpenFuseClient;
  whatsApp: WhatsAppClient;
  verifyToken: string;
  appSecret?: string;
}): Hono {
  const senders = new Map<string, SenderState>();
  const seenMessageIds = new Set<string>();

  async function handleMessage(message: IncomingTextMessage): Promise<void> {
    if (message.id) {
      if (seenMessageIds.has(message.id)) return;
      seenMessageIds.add(message.id);
      if (seenMessageIds.size > 5000) {
        const oldest = seenMessageIds.values().next().value;
        if (oldest) seenMessageIds.delete(oldest);
      }
    }
    if (message.body === null || !message.body.trim()) {
      await deps.whatsApp.sendText(
        message.from,
        "I can only handle text messages for now. Send your question as text.",
      );
      return;
    }
    const state = senders.get(message.from) ?? { threadId: randomUUID(), history: [] };
    senders.set(message.from, state);
    try {
      const outcome = await deps.openFuse.run(state.threadId, state.history, message.body);
      const userMessage: Message = { id: randomUUID(), role: "user", content: message.body };
      const assistantMessage: Message | null = outcome.text
        ? { id: randomUUID(), role: "assistant", content: outcome.text }
        : null;
      state.history = [
        ...state.history,
        userMessage,
        ...(assistantMessage ? [assistantMessage] : []),
      ].slice(-20);
      for (const imageId of outcome.imageIds) {
        try {
          const bytes = await deps.openFuse.fetchImage(imageId);
          const mediaId = await deps.whatsApp.uploadImage(bytes);
          await deps.whatsApp.sendImage(message.from, mediaId);
        } catch (error) {
          console.error(`[bridge] image ${imageId} could not be sent:`, error);
        }
      }
      await deps.whatsApp.sendText(message.from, outcome.text.trim() || "Done.");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[bridge] run failed for ${message.from}:`, detail);
      await deps.whatsApp
        .sendText(message.from, `Sorry, that failed: ${detail}`.slice(0, 4000))
        .catch(() => {});
    }
  }

  const app = new Hono();
  app.get("/", (c) => c.json({ ok: true, service: "openfuse-whatsapp-bridge" }));
  app.get("/webhook", (c) => {
    const mode = c.req.query("hub.mode");
    const token = c.req.query("hub.verify_token");
    const challenge = c.req.query("hub.challenge");
    if (mode === "subscribe" && token && token === deps.verifyToken && challenge)
      return c.text(challenge);
    return c.text("Forbidden", 403);
  });
  app.post("/webhook", async (c) => {
    const raw = Buffer.from(await c.req.arrayBuffer());
    if (!verifyWhatsAppSignature(raw, c.req.header("x-hub-signature-256"), deps.appSecret))
      return c.json({ error: "Bad signature" }, 403);
    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      return c.json({ error: "Bad JSON" }, 400);
    }
    // Answer Meta immediately; do the agent work after responding so Meta never retries.
    const work = (async () => {
      for (const message of extractTextMessages(payload)) {
        try {
          await handleMessage(message);
        } catch (error) {
          console.error("[bridge] message handling failed:", error);
        }
      }
    })();
    void work.catch((error) => console.error("[bridge]", error));
    return c.json({ ok: true });
  });
  return app;
}
