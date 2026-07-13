/**
 * 流程进度条 — 显示在业务页面顶部
 * 7 个节点：故障输入→边界判定→转供决策→操作序列→模板成票→安全校验→导出归档
 */
import { getWorkflowState, getCurrentStepIndex } from '../store/workflowStore';

const steps = [
  { key: 'fault', label: '故障输入' },
  { key: 'boundary', label: '边界判定' },
  { key: 'transfer', label: '转供决策' },
  { key: 'sequence', label: '操作序列' },
  { key: 'ticket', label: '模板成票' },
  { key: 'safety', label: '安全校验' },
  { key: 'archive', label: '导出归档' },
];

const stepIndexMap: Record<string, number> = {
  'fault': 0,
  'boundary': 1,
  'transfer': 2,
  'sequence': 3,
  'ticket': 4,
  'safety': 5,
  'archive': 6,
};

interface Props {
  currentStep: 'fault' | 'boundary' | 'transfer' | 'sequence' | 'ticket' | 'safety' | 'archive';
}

export default function WorkflowProgress({ currentStep }: Props) {
  const state = getWorkflowState();
  const completedUpTo = getCurrentStepIndex(state);
  const currentIdx = stepIndexMap[currentStep];

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 0,
      marginBottom: 20,
      padding: '14px 16px',
      background: '#fff',
      border: '1px solid #e8e8e8',
      borderRadius: 6,
      overflow: 'hidden',
      flexWrap: 'wrap',
    }}>
      {steps.map((step, i) => {
        const isCompleted = i < completedUpTo;
        const isCurrent = i === currentIdx;
        const color = isCompleted ? '#52c41a' : isCurrent ? '#1677ff' : '#d9d9d9';

        return (
          <div key={step.key} style={{ display: 'flex', alignItems: 'center', flex: i < 6 ? 1 : undefined, minWidth: 0 }}>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              flex: 1,
              minWidth: 80,
            }}>
              <div style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: color,
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 4,
                border: `2px solid ${color}`,
              }}>
                {isCompleted ? '✓' : i + 1}
              </div>
              <span style={{
                fontSize: 11,
                color: isCurrent ? '#1677ff' : isCompleted ? '#52c41a' : '#bfbfbf',
                fontWeight: isCurrent ? 600 : 400,
                whiteSpace: 'nowrap',
              }}>
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{
                flex: '0 0 24px',
                height: 2,
                background: isCompleted ? '#52c41a' : '#e8e8e8',
                marginBottom: 16,
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
