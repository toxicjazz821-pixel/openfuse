import { Image as ImageIcon } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Text, View } from "react-native";
import { z } from "zod";
import { Card, colors, ErrorNotice, s } from "./ui";
import { useWorkspace } from "./workspace";

const resultSchema = z.object({
  status: z.string().optional(),
  imageId: z.string().optional(),
  prompt: z.string().optional(),
  aspectRatio: z.enum(["1:1", "16:9", "9:16"]).optional(),
  error: z.string().optional(),
});
function parse(result: unknown) {
  if (typeof result !== "string") return undefined;
  try {
    const parsed = resultSchema.safeParse(JSON.parse(result));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

const aspectRatios: Record<string, number> = { "1:1": 1, "16:9": 16 / 9, "9:16": 9 / 16 };

/** Chat card for the agent's generateImage tool: the saved image, via a short-lived signed URL. */
export function ImageToolCard({ result, loading }: { result: unknown; loading: boolean }) {
  const { api } = useWorkspace();
  const value = parse(result);
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  useEffect(() => {
    if (!value?.imageId) return;
    let alive = true;
    setUrl("");
    setUrlError("");
    void api
      .request<{ url: string }>(`/api/images/${value.imageId}/url`)
      .then((response) => {
        if (alive) setUrl(response.url);
      })
      .catch((error: unknown) => {
        if (alive) setUrlError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      alive = false;
    };
  }, [api, value?.imageId]);
  const ratio = aspectRatios[value?.aspectRatio ?? "1:1"] ?? 1;
  const failure = value?.error
    ? value.error
    : !loading && !value?.imageId
      ? "The image did not come back readable."
      : "";
  return (
    <Card
      style={{ padding: 14, gap: 10, backgroundColor: "#EEEEF0", maxWidth: 440, width: "100%" }}
    >
      <View style={[s.row, { gap: 10 }]}>
        {loading ? (
          <ActivityIndicator size="small" color={colors.blueDark} />
        ) : (
          <ImageIcon size={18} color={colors.blueDark} />
        )}
        <Text style={[s.text, { flex: 1 }]}>
          {failure
            ? "Image failed"
            : loading
              ? "Generating the image…"
              : value?.imageId
                ? "Image ready"
                : "Waiting for the image…"}
        </Text>
      </View>
      <ErrorNotice error={failure || urlError} />
      {!!url && (
        <Image
          accessibilityLabel="Generated image"
          source={{ uri: url }}
          style={{ width: "100%", aspectRatio: ratio, borderRadius: 12, backgroundColor: "#FFF" }}
          resizeMode="contain"
        />
      )}
      {!!value?.prompt && (
        <Text style={s.small} numberOfLines={2}>
          {value.prompt}
        </Text>
      )}
    </Card>
  );
}
