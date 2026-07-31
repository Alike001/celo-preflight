import { useEffect } from 'react'

export function useNewInspectionShortcut(onNewInspection: () => void) {
  useEffect(() => {
    function keyboardShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (event.key.toLowerCase() === 'n' && !target?.matches('input, textarea, select')) {
        event.preventDefault()
        onNewInspection()
      }
    }
    window.addEventListener('keydown', keyboardShortcut)
    return () => window.removeEventListener('keydown', keyboardShortcut)
  })
}
