import { useEffect, useState } from 'react'

export type PageId = 'dashboard' | 'zones' | 'debug'

const PAGES: { id: PageId; label: string; hash: string }[] = [
  { id: 'dashboard', label: 'Dashboard', hash: '#/' },
  { id: 'zones', label: 'Zona', hash: '#/zones' },
  { id: 'debug', label: 'Debug', hash: '#/debug' },
]

function readPage(): PageId {
  const h = window.location.hash
  if (h.startsWith('#/zones')) return 'zones'
  if (h.startsWith('#/debug')) return 'debug'
  return 'dashboard'
}

/** Halaman aktif, dibaca dari URL hash (#/, #/zones, #/debug). */
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
    </nav>
  )
}
