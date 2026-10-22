export default function ModelThinkingSelector(props: {
  model: string;
  thinking: string;
  showIndividual: boolean;
  onModelChange: (value: string) => void;
  onThinkingChange: (value: string) => void;
}) {
  const selected = props.model === "individual" ? "individual:pro" : `${props.model}:${props.thinking}`;
  return (
    <select
      aria-label="Choose AI model and reasoning depth"
      className="model-select"
      onChange={(event) => {
        const [model, thinking] = event.target.value.split(":");
        props.onModelChange(model);
        props.onThinkingChange(thinking);
      }}
      value={selected}
    >
      <option value="genie-pro:light">Genie Pro · Light</option>
      <option value="genie-pro:pro">Genie Pro · Pro</option>
      <option value="genie-pro:deep">Genie Pro · Deep</option>
      <option value="genie-master:light">Genie Master · Light</option>
      <option value="genie-master:pro">Genie Master · Pro</option>
      <option value="genie-master:deep">Genie Master · Deep</option>
      {props.showIndividual && <option value="individual:pro">Individual Chat</option>}
    </select>
  );
}
