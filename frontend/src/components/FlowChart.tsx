interface Step {
  label: string;
  active?: boolean;
}

interface Props {
  steps: Step[];
  currentStep?: number;
}

export default function FlowChart({ steps, currentStep = -1 }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap' }}>
      {steps.map((step, i) => (
        <div key={step.label} style={{ display: 'flex', alignItems: 'center' }}>
          <div
            style={{
              padding: '8px 16px',
              borderRadius: 4,
              fontSize: 13,
              fontWeight: i === currentStep ? 600 : 400,
              background: i <= currentStep ? '#e6f4ff' : '#fafafa',
              color: i <= currentStep ? '#1677ff' : '#8c8c8c',
              border: `1px solid ${i <= currentStep ? '#1677ff' : '#d9d9d9'}`,
              whiteSpace: 'nowrap',
            }}
          >
            {step.label}
          </div>
          {i < steps.length - 1 && (
            <div style={{ color: '#bfbfbf', fontSize: 14, padding: '0 4px' }}>→</div>
          )}
        </div>
      ))}
    </div>
  );
}
