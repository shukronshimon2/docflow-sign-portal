import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import ClientSignPortal from './ClientSignPortal'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/sign" element={<ClientSignPortal />} />
        <Route path="*" element={<Navigate to="/sign" replace />} />
      </Routes>
    </HashRouter>
  )
}
