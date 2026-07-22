import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { OperatorQueue } from './components/OperatorQueue'

const isOperator = window.location.pathname.startsWith('/operator')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isOperator ? <OperatorQueue /> : <App />}
  </StrictMode>,
)
