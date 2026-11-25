import { WebView } from "react-native-webview";

export default function CodePreview({ code }: { code: string }) {
  return (
    <WebView
      source={{ html: code }}
      originWhitelist={["*"]}
      style={{ height: 560, borderRadius: 12, backgroundColor: "#FFF" }}
    />
  );
}
