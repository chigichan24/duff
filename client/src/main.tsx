import { createRoot } from 'react-dom/client'
import { Buffer } from 'buffer'
import process from 'process'
import './index.css'
import App from './App.tsx'

(window as any).Buffer = Buffer;
(window as any).process = process;

createRoot(document.getElementById('root')!).render(
  <App />
)
