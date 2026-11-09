import { createRoot } from 'react-dom/client'
import type { DesktopApi } from '../shared/model.ts'
import { App } from './app.tsx'
import './style.css'

declare global {
  interface Window {
    beerRanking: DesktopApi
  }
}

createRoot(document.getElementById('root')!).render(<App />)
