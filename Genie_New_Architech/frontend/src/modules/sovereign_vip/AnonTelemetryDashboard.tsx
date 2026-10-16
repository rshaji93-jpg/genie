export default function AnonTelemetryDashboard({ activeNodes, prompts }: { activeNodes: number; prompts: number }) {
  return <section aria-label="Identity-blind telemetry" className="anon-telemetry"><h2>Anonymous usage</h2><p>{activeNodes} pseudonymous nodes · {prompts} prompts</p></section>;
}
