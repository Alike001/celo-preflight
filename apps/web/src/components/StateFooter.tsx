import type { PreparedReport } from '@preflight/shared'

export function StateFooter({ report }: { report?: PreparedReport | undefined }) {
  return (
    <footer className="state-footer">
      <span>
        {report ? `Snapshot block ${report.facts.snapshot.blockNumber}` : 'No chain state read yet'}
      </span>
      <span className="mono">
        {report?.facts.snapshot.stateNote ?? 'Evidence state will be disclosed here.'}
      </span>
    </footer>
  )
}
