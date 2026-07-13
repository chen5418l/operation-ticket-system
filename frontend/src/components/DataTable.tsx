import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  title: string;
  dataIndex?: keyof T;
  width?: number;
  render?: (record: T, index: number) => ReactNode;
}

interface Props<T> {
  columns: Column<T>[];
  data: T[];
  rowKey?: (record: T, index: number) => string;
}

const styles: Record<string, React.CSSProperties> = {
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  },
  th: {
    textAlign: 'left',
    padding: '10px 12px',
    background: '#fafafa',
    borderBottom: '1px solid #e8e8e8',
    fontWeight: 600,
    color: '#595959',
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '10px 12px',
    borderBottom: '1px solid #f0f0f0',
    color: '#262626',
  },
  tr: {
    cursor: 'default',
  },
};

export default function DataTable<T extends Record<string, any>>({ columns, data, rowKey }: Props<T>) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={styles.table}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} style={{ ...styles.th, width: col.width }}>
                {col.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((record, i) => (
            <tr
              key={rowKey ? rowKey(record, i) : i}
              style={{
                ...styles.tr,
                background: i % 2 === 0 ? '#fff' : '#fafafa',
              }}
            >
              {columns.map((col) => (
                <td key={col.key} style={styles.td}>
                  {col.render
                    ? col.render(record, i)
                    : col.dataIndex
                      ? (record as any)[col.dataIndex]
                      : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
