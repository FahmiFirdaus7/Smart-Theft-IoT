import { useEffect, useState } from 'react'

export type PageId = 'dashboard' | 'debug'

const PAGES: { id: PageId; label: string; hash: string }[] = [
  { id: 'dashboard', label: 'Dashboard', hash: '#/' },
  { id: 'debug', label: 'Debug', hash: '#/debug' },
]

function readPage(): PageId {
  return window.location.hash.startsWith('#/debug') ? 'debug' : 'dashboard'
}

/** Halaman aktif, dibaca dari URL hash (#/ atau #/debug). */
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
