export default function CodePreview({ code }: { code: string }) {
  return (
    <iframe
      title="Live preview"
      srcDoc={code}
      sandbox="allow-scripts allow-forms"
      style={{ height: 560, width: "100%", border: 0, borderRadius: 12, background: "#FFF" }}
    />
  );
}
