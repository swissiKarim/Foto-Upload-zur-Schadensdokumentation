import React from 'react'
import DamageReportImageManager from './components/DamageReportImageManager'
import './components/DamageReportImageManager.css'
import './index.css'

function App() {
  return (
    <main style={{ minHeight: '100vh', background: '#f3f4f6', padding: '2rem 1rem' }}>
      <h1 style={{ textAlign: 'center', marginBottom: '2rem', color: '#1a1a2e' }}>
        Schadensmeldung
      </h1>
      <DamageReportImageManager />
    </main>
  )
}

export default App
