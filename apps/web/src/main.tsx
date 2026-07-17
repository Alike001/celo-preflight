import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { App } from './App.js'
import { wagmiConfig } from './wagmi.js'
import './styles/tokens.css'
import './styles/shell.css'
import './styles/components.css'
import './styles/proposal-import.css'
import './styles/landing.css'
import './styles/run.css'
import './styles/evidence.css'
import './styles/inspector.css'
import './styles/docs.css'
import './styles/responsive.css'

const queryClient = new QueryClient()
const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
)
