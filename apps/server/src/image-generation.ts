const IMAGE_MODEL = "gemini-2.5-flash-image";
const IMAGE_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent`;

export type ImageAspectRatio = "1:1" | "16:9" | "9:16";

export class ImageGenerationError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ImageGenerationError";
  }
}

type GeminiPart = { text?: string; inlineData?: { mimeType?: string; data?: string } };
type GeminiResponse = { candidates?: { content?: { parts?: GeminiPart[] } }[]; error?: { message?: string } };

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as GeminiResponse;
    return payload.error?.message ? `Google says: ${payload.error.message}` : "";
  } catch {
    return "";
  }
}

/**
 * Generate one image with the Gemini image model (Nano Banana). Uses the REST
 * generateContent endpoint with TEXT + IMAGE response modalities; the image
 * comes back as base64 inlineData. One request, no retries: a 429 means the
 * free daily quota is spent, and retrying would only burn more of it.
 */
export async function generateImageWithGemini(options: {
  prompt: string;
  aspectRatio: ImageAspectRatio;
  apiKey?: string;
  signal?: AbortSignal;
}): Promise<{ base64: string; mimeType: string }> {
  const apiKey = options.apiKey ?? process.env.GOOGLE_API_KEY;
  if (!apiKey)
    throw new ImageGenerationError(
      "Image generation is not configured: GOOGLE_API_KEY is missing on the server",
    );
  let response: Response;
  try {
    response = await fetch(IMAGE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: options.prompt }] }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: { aspectRatio: options.aspectRatio },
        },
      }),
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ImageGenerationError(
      `Image generation request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    if (response.status === 429)
      throw new ImageGenerationError(
        `Image generation is rate-limited (the free daily quota is reached). Try again later. ${detail}`.trim(),
        429,
      );
    throw new ImageGenerationError(
      `Image generation failed (HTTP ${response.status}). ${detail}`.trim(),
      response.status,
    );
  }
  const payload = (await response.json()) as GeminiResponse;
  const imagePart = payload.candidates?.[0]?.content?.parts?.find(
    (part) => part.inlineData?.data,
  );
  if (!imagePart?.inlineData?.data)
    throw new ImageGenerationError("The image model did not return an image. Try a different prompt.");
  return { base64: imagePart.inlineData.data, mimeType: imagePart.inlineData.mimeType ?? "image/png" };
}
