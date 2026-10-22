export default function StagedAudioPill({ src, onRemove }: { src: string; onRemove?: () => void }) {
  return <span className="staged-audio-pill"><audio controls src={src} />{onRemove && <button aria-label="Remove staged recording" onClick={onRemove} type="button">×</button>}</span>;
}
