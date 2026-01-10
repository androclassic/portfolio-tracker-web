'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePortfolio } from './PortfolioProvider';

export default function PortfolioSelector() {
  const { portfolios, selectedId, setSelectedId, refresh } = usePortfolio();
  const [isOpen, setIsOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [renameMap, setRenameMap] = useState<Record<number, string>>({});
  const hasPortfolios = portfolios.length > 0;

  useEffect(()=>{ setRenameMap(Object.fromEntries(portfolios.map(p=> [p.id, p.name]))); }, [portfolios]);

  // Add escape key handler
  useEffect(() => {
    if (!isOpen) return;
    
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  async function createPortfolio(e: React.FormEvent){
    e.preventDefault();
    if (!newName.trim()) return;
    await fetch('/api/portfolios', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ name: newName.trim() }) });
    setNewName('');
    await refresh();
  }

  async function rename(id: number){
    const name = renameMap[id]?.trim();
    if (!name) return;
    await fetch('/api/portfolios', { method:'PUT', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ id, name }) });
    await refresh();
  }

  async function remove(id: number){
    if (!confirm('Delete this portfolio? All its transactions will be removed.')) return;
    await fetch(`/api/portfolios?id=${id}`, { method:'DELETE' });
    await refresh();
  }

  const modal = isOpen && createPortal(
        <div 
          className="modal-backdrop" 
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setIsOpen(false);
            }
          }}
        >
          <div 
            className="modal" 
            role="dialog" 
            aria-modal="true" 
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-header">
              <div className="card-title">
                <h3>Manage portfolios</h3>
              </div>
              <div className="card-actions">
                <button className="btn btn-secondary btn-sm" onClick={()=>setIsOpen(false)}>
                  <span style={{ marginRight: 6 }}>✕</span>
                  Close
                </button>
              </div>
            </div>
            <section style={{ display:'grid', gap:10 }}>
              {hasPortfolios ? (
                portfolios.map(p=> (
                  <div key={p.id} style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <input 
                      value={renameMap[p.id]||''} 
                      onChange={e=>setRenameMap(m=>({ ...m, [p.id]: e.target.value }))} 
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <button className="btn btn-secondary btn-sm" onClick={()=>rename(p.id)}>Rename</button>
                    <button className="btn btn-danger btn-sm" onClick={()=>remove(p.id)}>Delete</button>
                  </div>
                ))
              ) : (
                <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)' }}>
                  You don&apos;t have any portfolios yet. Create your first one to start tracking your assets.
                </p>
              )}
              <form onSubmit={createPortfolio} style={{ display:'flex', gap:8 }}>
                <input 
                  placeholder="New portfolio name" 
                  value={newName} 
                  onChange={e=>setNewName(e.target.value)}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                />
                <button className="btn btn-primary btn-sm" type="submit">Add</button>
              </form>
            </section>
          </div>
        </div>,
        document.body
      );

  if (!hasPortfolios) {
    return (
      <div className="portfolio-selector">
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            alignItems: 'flex-start',
            justifyContent: 'center',
            padding: '0.75rem 1rem',
            borderRadius: 12,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            width: '100%',
            maxWidth: 420,
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Create your first portfolio</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              Portfolios group your assets and transactions. Start by creating one to unlock the dashboards.
            </div>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setIsOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span>➕</span>
            Create portfolio
          </button>
        </div>
        {modal}
      </div>
    );
  }

  return (
    <div className="portfolio-selector">
      <div className="portfolio-dropdown-content">
        <label className="portfolio-label">
          <span className="portfolio-label-text">Select Portfolio</span>
          <select 
            className="portfolio-select"
            value={selectedId ?? ''} 
            onChange={e=> setSelectedId(e.target.value === 'all' ? 'all' : Number(e.target.value)) }
          >
            <option value="all">All Portfolios</option>
            {portfolios.map(p=> (<option key={p.id} value={p.id}>{p.name}</option>))}
          </select>
        </label>
        <button 
          className="portfolio-manage-btn" 
          onClick={()=>setIsOpen(true)}
          title="Manage portfolios"
        >
          Manage Portfolios
        </button>
      </div>

      {modal}
    </div>
  );
}


