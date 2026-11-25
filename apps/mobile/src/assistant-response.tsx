import { useCallback, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View, type TextStyle } from "react-native";
import Markdown, { type MarkdownStyles, type RenderRules } from "react-native-markdown-renderer";
import { assistantMarkdown, isSafeAssistantUrl } from "./assistant-markdown";
import CodePreview from "./code-preview";
import { colors, ErrorNotice, Sheet } from "./ui";

const textStyle = { color: colors.text, fontSize: 16, lineHeight: 24 };
const style: Partial<MarkdownStyles> = {
  text: textStyle,
  paragraph: { marginTop: 0, marginBottom: 6 },
  list: { marginBottom: 6 },
  headingContainer: { marginTop: 8, marginBottom: 4 },
  heading1: { fontSize: 21, lineHeight: 27 },
  heading2: { fontSize: 19, lineHeight: 25 },
  heading3: { fontSize: 17, lineHeight: 23 },
  link: { color: colors.blueDark, textDecorationLine: "underline" },
  codeInline: { backgroundColor: "#E2E4E7", color: colors.text },
  codeBlock: { backgroundColor: "#E2E4E7", color: colors.text },
};

type ClipboardApi = { writeText: (text: string) => Promise<void> };
function getClipboard(): ClipboardApi | undefined {
  const nav = (globalThis as unknown as { navigator?: { clipboard?: { writeText?: unknown } } })
    .navigator;
  const clipboard = nav?.clipboard;
  const writeText = clipboard?.writeText;
  if (typeof writeText !== "function" || !clipboard) return undefined;
  return { writeText: (writeText as (text: string) => Promise<void>).bind(clipboard) };
}

function isHtmlCode(code: string, lang: string): boolean {
  if (lang.trim().toLowerCase() === "html") return true;
  return /^\s*<!doctype html/i.test(code) || /^\s*<html[\s>]/i.test(code);
}

function CodeBlockView({
  code,
  lang,
  codeStyle,
}: {
  code: string;
  lang: string;
  codeStyle: TextStyle;
}) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const [previewOpen, setPreviewOpen] = useState(false);
  const clipboard = getClipboard();
  const html = isHtmlCode(code, lang);
  const onCopy = () => {
    if (!clipboard) return;
    void clipboard
      .writeText(code)
      .then(() => {
        setCopied("copied");
        setTimeout(() => setCopied("idle"), 1500);
      })
      .catch(() => {
        setCopied("failed");
        setTimeout(() => setCopied("idle"), 1500);
      });
  };
  return (
    <View style={s.codeContainer}>
      <View style={s.codeHeader}>
        <Text style={s.codeLang}>{lang || "code"}</Text>
        <View style={s.codeActions}>
          {html ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setPreviewOpen(true)}
              style={({ pressed }) => [s.codeButton, pressed && { opacity: 0.6 }]}
            >
              <Text style={s.codeButtonText}>Preview</Text>
            </Pressable>
          ) : null}
          {clipboard ? (
            <Pressable
              accessibilityRole="button"
              onPress={onCopy}
              style={({ pressed }) => [s.codeButton, pressed && { opacity: 0.6 }]}
            >
              <Text style={s.codeButtonText}>
                {copied === "copied" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <Text selectable style={[codeStyle, s.codeText]}>
        {code}
      </Text>
      {previewOpen ? (
        <Sheet title="Live preview" subtitle="HTML preview" onClose={() => setPreviewOpen(false)} wide>
          <CodePreview code={code} />
        </Sheet>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  codeContainer: {
    backgroundColor: "#E2E4E7",
    borderRadius: 10,
    marginVertical: 4,
    overflow: "hidden",
  },
  codeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#D3D6D9",
  },
  codeLang: { fontSize: 12, lineHeight: 16, color: colors.muted, fontWeight: "600" },
  codeActions: { flexDirection: "row", gap: 8 },
  codeButton: {
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#D3D6D9",
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  codeButtonText: { fontSize: 13, lineHeight: 18, color: colors.text, fontWeight: "600" },
  codeText: { padding: 12 },
});

const renderCodeBlock: RenderRules["fence"] = (node, _children, _parent, styles) => (
  <CodeBlockView
    key={node.key}
    code={node.content.replace(/\n$/, "")}
    lang={node.sourceInfo ?? ""}
    codeStyle={styles.codeBlock as TextStyle}
  />
);
const rules: RenderRules = {
  textgroup: (node, children) => (
    <Text key={node.key} selectable style={textStyle}>
      {children}
    </Text>
  ),
  image: (node) => (
    <Text key={node.key} selectable style={{ color: colors.muted }}>
      {node.attributes.alt ? `[Image: ${node.attributes.alt}]` : "[Image]"}
    </Text>
  ),
  code_block: renderCodeBlock,
  fence: renderCodeBlock,
};

export function AssistantResponse({ content }: { content: string }) {
  const [linkError, setLinkError] = useState("");
  const onLinkPress = useCallback((url: string) => {
    if (!isSafeAssistantUrl(url)) return false;
    setLinkError("");
    void Linking.openURL(url).catch((error) =>
      setLinkError(error instanceof Error ? error.message : String(error)),
    );
    return false;
  }, []);
  return (
    <>
      <Markdown
        markdownit={assistantMarkdown}
        style={style}
        rules={rules}
        onLinkPress={onLinkPress}
      >
        {content}
      </Markdown>
      <ErrorNotice error={linkError} />
    </>
  );
}
