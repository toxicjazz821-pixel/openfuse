import { randomUUID } from "node:crypto";
import { HttpAgent } from "@ag-ui/client";
import { EventType, type BaseEvent, type Message } from "@ag-ui/core";

export type AgentOutcome = { text: string; imageIds: string[] };

function isUnauthorized(error: unknown): boolean {
  return error instanceof Error && /401/.test(error.message);
}

/**
 * Talks to the OpenFUSE API over AG-UI: POST /api/session exchanges the
 * access key for a 24h session token, then POST /api/copilotkit/agent/default/run
 * streams the run as server-sent events. One thread per WhatsApp sender; the
 * runtime creates the thread on first use (getOrCreateThread).
 */
export class OpenFuseClient {
  private token?: string;
  constructor(
    private readonly apiUrl: string,
    private readonly accessKey: string,
  ) {}

  private async sessionToken(): Promise<string> {
    if (this.token) return this.token;
    const response = await fetch(`${this.apiUrl}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessKey: this.accessKey }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `OpenFUSE sign-in failed (${response.status}): ${detail || response.statusText}`,
      );
    }
    const payload = (await response.json()) as { token?: string };
    if (!payload.token) throw new Error("OpenFUSE sign-in returned no token");
    this.token = payload.token;
    return this.token;
  }

  /** Run one user turn. Retries once with a fresh session token on a 401. */
  async run(
    threadId: string,
    history: Message[],
    text: string,
    timeoutMs = 180_000,
  ): Promise<AgentOutcome> {
    const messages: Message[] = [...history, { id: randomUUID(), role: "user", content: text }];
    try {
      return await this.runOnce(threadId, messages, timeoutMs);
    } catch (error) {
      if (!isUnauthorized(error)) throw error;
      this.token = undefined;
      return this.runOnce(threadId, messages, timeoutMs);
    }
  }

  private runOnce(
    threadId: string,
    messages: Message[],
    timeoutMs: number,
  ): Promise<AgentOutcome> {
    return new Promise((resolve, reject) => {
      void (async () => {
        let token: string;
        try {
          token = await this.sessionToken();
        } catch (error) {
          reject(error);
          return;
        }
        const agent = new HttpAgent({
          url: `${this.apiUrl}/api/copilotkit/agent/default/run`,
          headers: { Authorization: `Bearer ${token}` },
        });
        const textParts: string[] = [];
        const imageIds: string[] = [];
        let done = false;
        const timer = setTimeout(() => {
          agent.abortRun();
          finish(() => reject(new Error("The agent took too long to reply")));
        }, timeoutMs);
        const finish = (fn: () => void) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          fn();
        };
        agent
          .run({
            threadId,
            runId: randomUUID(),
            state: {},
            messages,
            tools: [],
            context: [],
            forwardedProps: {},
          })
          .subscribe({
            next: (event: BaseEvent) => {
              if (event.type === EventType.TEXT_MESSAGE_CONTENT) {
                const delta = (event as { delta?: string }).delta;
                if (delta) textParts.push(delta);
              } else if (event.type === EventType.TOOL_CALL_RESULT) {
                // generateImage reports its saved image ID as JSON text; the
                // image bytes themselves never ride the event (see
                // tanstack-agent.ts), so fetch them afterwards by ID.
                const content = (event as { content?: unknown }).content;
                if (typeof content === "string") {
                  try {
                    const parsed = JSON.parse(content) as { imageId?: unknown };
                    if (typeof parsed.imageId === "string") imageIds.push(parsed.imageId);
                  } catch {
                    // Not JSON; nothing to extract.
                  }
                }
              } else if (event.type === EventType.RUN_ERROR) {
                finish(() =>
                  reject(
                    new Error(
                      (event as { message?: string }).message ?? "Agent run failed",
                    ),
                  ),
                );
              } else if (event.type === EventType.RUN_FINISHED) {
                finish(() => resolve({ text: textParts.join(""), imageIds }));
              }
            },
            error: (error: unknown) =>
              finish(() => reject(error instanceof Error ? error : new Error(String(error)))),
            complete: () => finish(() => resolve({ text: textParts.join(""), imageIds })),
          });
      })();
    });
  }

  async fetchImage(imageId: string): Promise<Uint8Array<ArrayBuffer>> {
    const token = await this.sessionToken();
    const response = await fetch(`${this.apiUrl}/api/images/${imageId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok)
      throw new Error(`Could not fetch the generated image (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  }
}
