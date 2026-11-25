import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import {
  generateImageWithGemini,
  ImageGenerationError,
} from "../apps/server/src/image-generation.ts";

const IMAGE_B64 = Buffer.from("fake-png-bytes").toString("base64");

function geminiResponse() {
  return {
    candidates: [
      {
        content: {
          parts: [
            { text: "Here is your image:" },
            { inlineData: { mimeType: "image/png", data: IMAGE_B64 } },
          ],
        },
      },
    ],
  };
}

function mockFetch(t: TestContext, response: Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return response;
  });
  return calls;
}

test("generateImageWithGemini posts TEXT+IMAGE modalities and returns the inline image", async (t) => {
  const calls = mockFetch(t, Response.json(geminiResponse()));
  const result = await generateImageWithGemini({
    prompt: "a red sports car at sunset",
    aspectRatio: "16:9",
    apiKey: "test-key",
  });
  assert.equal(result.base64, IMAGE_B64);
  assert.equal(result.mimeType, "image/png");
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent",
  );
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers["x-goog-api-key"], "test-key");
  const body = JSON.parse(String(calls[0].init?.body)) as {
    contents: { parts: { text: string }[] }[];
    generationConfig: { responseModalities: string[]; imageConfig: { aspectRatio: string } };
  };
  assert.equal(body.contents[0].parts[0].text, "a red sports car at sunset");
  assert.deepEqual(body.generationConfig.responseModalities, ["TEXT", "IMAGE"]);
  assert.equal(body.generationConfig.imageConfig.aspectRatio, "16:9");
});

test("generateImageWithGemini reports a 429 once and does not retry", async (t) => {
  const calls = mockFetch(
    t,
    new Response(JSON.stringify({ error: { message: "Quota exceeded" } }), { status: 429 }),
  );
  await assert.rejects(
    () =>
      generateImageWithGemini({ prompt: "a cat", aspectRatio: "1:1", apiKey: "test-key" }),
    (error: unknown) =>
      error instanceof ImageGenerationError &&
      error.status === 429 &&
      /rate-limited/i.test(error.message),
  );
  assert.equal(calls.length, 1);
});

test("generateImageWithGemini fails clearly without an API key", async (t) => {
  const calls = mockFetch(t, Response.json(geminiResponse()));
  const previous = process.env.GOOGLE_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  try {
    await assert.rejects(
      () => generateImageWithGemini({ prompt: "a cat", aspectRatio: "1:1" }),
      /GOOGLE_API_KEY is missing/,
    );
  } finally {
    if (previous !== undefined) process.env.GOOGLE_API_KEY = previous;
  }
  assert.equal(calls.length, 0);
});

test("generateImageWithGemini fails clearly when no image comes back", async (t) => {
  mockFetch(t, Response.json({ candidates: [{ content: { parts: [{ text: "no image" }] } }] }));
  await assert.rejects(
    () => generateImageWithGemini({ prompt: "a cat", aspectRatio: "1:1", apiKey: "test-key" }),
    /did not return an image/,
  );
});
