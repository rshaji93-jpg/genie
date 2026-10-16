const dialects = [
  ["ta-IN", "தமிழ்"], ["ml-IN", "മലയാളം"], ["te-IN", "తెలుగు"], ["kn-IN", "ಕನ್ನಡ"],
  ["hi-IN", "हिन्दी"], ["bn-IN", "বাংলা"], ["mr-IN", "मराठी"], ["gu-IN", "ગુજરાતી"],
  ["pa-IN", "ਪੰਜਾਬੀ"], ["or-IN", "ଓଡ଼ିଆ"], ["as-IN", "অসমীয়া"], ["ur-IN", "اردو"],
  ["en-IN", "English (India)"], ["Tanglish", "Tanglish"],
] as const;

export default function DialectSelector(props: { value: string; onChange: (value: string) => void }) {
  return (
    <select aria-label="Choose spoken dialect" className="thinking-select" onChange={(event) => props.onChange(event.target.value)} value={props.value}>
      {dialects.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
  );
}
