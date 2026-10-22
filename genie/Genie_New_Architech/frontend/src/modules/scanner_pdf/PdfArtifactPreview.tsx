export default function PdfArtifactPreview({ url, onDownload, onClose }: {
  url: string;
  onDownload: () => void;
  onClose: () => void;
}) {
  return (
    <aside aria-label="PDF artifact preview" className="pdf-artifact-drawer">
      <header><h2>Scanned document</h2><button aria-label="Close PDF preview" onClick={onClose}>×</button></header>
      <iframe title="Clean PDF preview" src={url} />
      <button className="room-control" onClick={onDownload}>⬇️ Export Clean PDF</button>
    </aside>
  );
}
