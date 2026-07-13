interface Props {
  status: string;
}

const statusColors: Record<string, { bg: string; color: string; border: string }> = {
  // 原有
  '已同步': { bg: '#e8f5e9', color: '#1f8a4c', border: '#a5d6a7' },
  '待更新': { bg: '#fff8e1', color: '#b8860b', border: '#ffe082' },
  '异常': { bg: '#ffebee', color: '#eb5757', border: '#ffcdd2' },
  '通过': { bg: '#e8f5e9', color: '#1f8a4c', border: '#a5d6a7' },
  '警告': { bg: '#fff8e1', color: '#b8860b', border: '#ffe082' },
  '阻断': { bg: '#ffebee', color: '#eb5757', border: '#ffcdd2' },
  '草稿': { bg: '#f3f6f9', color: '#667085', border: '#c8d6e5' },
  '已校核': { bg: '#e3f0ff', color: '#2f80ed', border: '#90caf9' },
  '已审核': { bg: '#e8f5e9', color: '#1f8a4c', border: '#a5d6a7' },
  '已归档': { bg: '#f3e5f5', color: '#7b1fa2', border: '#ce93d8' },
  '高': { bg: '#ffebee', color: '#eb5757', border: '#ffcdd2' },
  '中': { bg: '#fff8e1', color: '#b8860b', border: '#ffe082' },
  '低': { bg: '#e8f5e9', color: '#1f8a4c', border: '#a5d6a7' },
  '一致': { bg: '#e8f5e9', color: '#1f8a4c', border: '#a5d6a7' },
  '冲突': { bg: '#ffebee', color: '#eb5757', border: '#ffcdd2' },
  '未配置': { bg: '#f3f6f9', color: '#94a3b8', border: '#c8d6e5' },
  '推荐': { bg: '#e8f5e9', color: '#1f8a4c', border: '#81c784' },
  '已人工确认': { bg: '#e3f0ff', color: '#2f80ed', border: '#90caf9' },
  // 新增
  '已导入': { bg: '#e8f5e9', color: '#1f8a4c', border: '#a5d6a7' },
  '已校验': { bg: '#e8f5e9', color: '#1f8a4c', border: '#a5d6a7' },
  '实时同步': { bg: '#e3f0ff', color: '#2f80ed', border: '#90caf9' },
  '实时': { bg: '#e3f0ff', color: '#2f80ed', border: '#90caf9' },
  '待维护': { bg: '#fff8e1', color: '#b8860b', border: '#ffe082' },
  '重载': { bg: '#ffebee', color: '#eb5757', border: '#ffcdd2' },
  '高危': { bg: '#ffebee', color: '#eb5757', border: '#ffcdd2' },
  '正常': { bg: '#e8f5e9', color: '#1f8a4c', border: '#a5d6a7' },
  '已维护': { bg: '#e8f5e9', color: '#1f8a4c', border: '#a5d6a7' },
  '版本有效': { bg: '#e8f5e9', color: '#1f8a4c', border: '#a5d6a7' },
};

export default function StatusBadge({ status }: Props) {
  const style = statusColors[status] || { bg: '#f3f6f9', color: '#667085', border: '#c8d6e5' };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 4,
        fontSize: 12,
        fontWeight: 500,
        background: style.bg,
        color: style.color,
        border: `1px solid ${style.border}`,
        whiteSpace: 'nowrap',
      }}
    >
      {status}
    </span>
  );
}
