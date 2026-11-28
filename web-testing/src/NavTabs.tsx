import { useEffect, useState } from 'react'
import { USER_DASHBOARD_URL } from './apiBase'

export type PageId = 'dashboard' | 'zones' | 'pose' | 'debug'

const PAGES: { id: PageId; label: string; hash: string }[] = [
  { id: 'dashboard', label: 'Dashboard', hash: '#/' },
  { id: 'zones', label: 'Zona', hash: '#/zones' },
  { id: 'pose', label: 'Posisi', hash: '#/pose' },
  { id: 'debug', label: 'Debug', hash: '#/debug' },
]

function readPage(): PageId {
  const h = window.location.hash
  if (h.startsWith('#/zones')) return 'zones'
  if (h.startsWith('#/pose')) return 'pose'
  if (h.startsWith('#/debug')) return 'debug'
  return 'dashboard'
}

/** Halaman aktif, dibaca dari URL hash (#/, #/zones, #/pose, #/debug). */
export function usePage(): PageId {
  const [page, setPage] = useState<PageId>(readPage)
  useEffect(() => {
    const onChange = () => setPage(readPage())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return page
}

export function NavTabs({ page }: { page: PageId }) {
  return (
    <nav className="nav-tabs" aria-label="Navigasi halaman">
      {PAGES.map((p) => (
        <a
          key={p.id}
          href={p.hash}
          className={`nav-tab ${page === p.id ? 'nav-tab--active' : ''}`}
          aria-current={page === p.id ? 'page' : undefined}
        >
          {p.label}
        </a>
      ))}
      <a
        href={USER_DASHBOARD_URL}
        className="nav-tab nav-tab--ext"
        title="Kembali ke dashboard pengguna"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V21h14V9.5" />
        </svg>
        Dashboard Pengguna
      </a>
    </nav>
  )
}
