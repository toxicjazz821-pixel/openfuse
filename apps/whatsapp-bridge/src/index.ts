import { serve } from "@hono/node-server";
import { OpenFuseClient } from "./agent.ts";
import { createWebhookApp } from "./webhook.ts";
import { WhatsAppClient } from "./whatsapp.ts";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

const port = Number(process.env.PORT ?? 3000);
const apiUrl = (process.env.OPENFUSE_API_URL ?? "https://openfuse-api-qcj7.onrender.com").replace(
  /\/$/,
  "",
);
const openFuse = new OpenFuseClient(apiUrl, requiredEnv("OPENFUSE_ACCESS_KEY"));
const whatsApp = new WhatsAppClient(
  requiredEnv("WHATSAPP_PHONE_NUMBER_ID"),
  requiredEnv("WHATSAPP_ACCESS_TOKEN"),
);
const verifyToken = requiredEnv("WHATSAPP_VERIFY_TOKEN");
const appSecret = process.env.WHATSAPP_APP_SECRET?.trim() || undefined;
if (!appSecret)
  console.warn("[bridge] WHATSAPP_APP_SECRET is not set; webhook signatures will not be verified");

const app = createWebhookApp({ openFuse, whatsApp, verifyToken, appSecret });
serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? "0.0.0.0" }, () => {
  console.log(`[bridge] WhatsApp bridge listening on :${port}; OpenFUSE API ${apiUrl}`);
});
