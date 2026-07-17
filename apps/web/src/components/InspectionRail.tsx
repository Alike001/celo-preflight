import { Plus, Search } from 'lucide-react'
import type { Verdict } from '@preflight/shared'
import type { ReportSummary } from '../api.js'
import { StatusIcon } from './StatusIcon.js'

type Filter = 'ALL' | Verdict

function short(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

export function InspectionRail({
  reports,
  selectedId,
  filter,
  onFilter,
  onSelect,
  onNew,
}: {
  reports: ReportSummary[]
  selectedId?: string | undefined
  filter: Filter
  onFilter: (filter: Filter) => void
  onSelect: (id: string) => void
  onNew: () => void
}) {
  const visible = filter === 'ALL' ? reports : reports.filter((report) => report.verdict === filter)
  return (
    <aside className="rail" aria-label="Preflight history">
      <div className="pane-heading">
        <div>
          <span className="eyebrow">Workspace</span>
          <h1>Preflights</h1>
        </div>
        <button className="icon-button" type="button" onClick={onNew} title="New inspection (N)">
          <Plus aria-hidden />
        </button>
      </div>
      <button className="new-button" type="button" onClick={onNew}>
        <Plus aria-hidden size={16} /> New inspection <kbd>N</kbd>
      </button>
      <div className="filter-row">
        <Search aria-hidden size={14} />
        {(['ALL', 'CLEAR', 'CAUTION', 'BLOCK'] as const).map((item) => (
          <button
            className={filter === item ? 'filter-active' : ''}
            type="button"
            key={item}
            onClick={() => onFilter(item)}
          >
            {item === 'ALL' ? 'All' : item.toLowerCase()}
          </button>
        ))}
      </div>
      <div className="history-list">
        {visible.length === 0 ? (
          <div className="empty-rail">
            <span>No inspections yet</span>
            <small>Run one to build a local evidence history.</small>
          </div>
        ) : (
          visible.map((report) => (
            <button
              type="button"
              className={`history-row ${selectedId === report.id ? 'history-selected' : ''}`}
              key={report.id}
              onClick={() => onSelect(report.id)}
            >
              <StatusIcon status={report.verdict} />
              <span className="history-copy">
                <strong>{short(report.to)}</strong>
                <small>
                  {report.chainId === 42220 ? 'Mainnet' : 'Sepolia'} ·{' '}
                  {new Date(report.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </small>
              </span>
              <span className={`verdict-mini verdict-${report.verdict.toLowerCase()}`}>
                {report.verdict}
              </span>
            </button>
          ))
        )}
      </div>
      <footer className="rail-footer">
        <span>{reports.length} stored locally</span>
        <span className="mono">ruleset 1.0.0</span>
      </footer>
    </aside>
  )
}
