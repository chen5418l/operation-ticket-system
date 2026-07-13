interface Props {
  label: string;
  value: string | number;
  unit?: string;
  color?: string;
  trend?: string;
  trendColor?: string;
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: '#fff',
    borderRadius: 6,
    border: '1px solid #c8d6e5',
    padding: '16px 20px',
    flex: 1,
    minWidth: 160,
    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
  },
  label: { fontSize: 12, color: '#667085', marginBottom: 8 },
  valueRow: { display: 'flex', alignItems: 'baseline', gap: 6 },
  value: { fontSize: 26, fontWeight: 700, color: '#1f2937' },
  unit: { fontSize: 13, color: '#94a3b8' },
  trend: { fontSize: 11, marginTop: 6 },
  dot: { width: 8, height: 8, borderRadius: '50%', display: 'inline-block', marginRight: 6 },
};

export default function MetricCard({ label, value, unit, color, trend, trendColor }: Props) {
  return (
    <div style={styles.card}>
      <div style={styles.label}>{label}</div>
      <div style={styles.valueRow}>
        <span style={{ ...styles.value, color: color || '#1f2937' }}>{value}</span>
        {unit && <span style={styles.unit}>{unit}</span>}
      </div>
      {trend && (
        <div style={{ ...styles.trend, color: trendColor || '#667085' }}>
          <span style={{ ...styles.dot, background: trendColor || '#667085' }} />
          {trend}
        </div>
      )}
    </div>
  );
}
