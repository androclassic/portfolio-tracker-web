'use client';

import { useEffect, useState } from 'react';
import { usePortfolio } from './PortfolioProvider';

export default function PortfolioSelector() {
  const { portfolios, selectedId, setSelectedId, refresh } = usePortfolio();
  const [isOpen, setIsOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [renameMap, setRenameMap] = useState<Record<number, string>>({});

  useEffect(()=>{ setRenameMap(Object.fromEntries(portfolios.map(p=> [p.id, p.name]))); }, [portfolios]);

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

  return (
    <div style={{ marginLeft: 'auto' }}>
      <label style={{ color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>Portfolio
        <select value={selectedId ?? ''} onChange={e=> setSelectedId(e.target.value === 'all' ? 'all' : Number(e.target.value)) }>
          <option value="all">All</option>
          {portfolios.map(p=> (<option key={p.id} value={p.id}>{p.name}</option>))}
        </select>
      </label>
      <button className="btn btn-secondary" style={{ marginLeft: 8 }} onClick={()=>setIsOpen(true)}>Manage</button>

      {isOpen && (
        <div className="modal-backdrop" onClick={(e)=>{ if (e.target === e.currentTarget) setIsOpen(false); }}>
          <div className="modal" role="dialog" aria-modal="true">
            <header>
              <h3>Manage portfolios</h3>
              <button className="btn btn-secondary" onClick={()=>setIsOpen(false)}>Close</button>
            </header>
            <section style={{ display:'grid', gap:10 }}>
              {portfolios.map(p=> (
                <div key={p.id} style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <input value={renameMap[p.id]||''} onChange={e=>setRenameMap(m=>({ ...m, [p.id]: e.target.value }))} />
                  <button className="btn btn-secondary" onClick={()=>rename(p.id)}>Rename</button>
                  <button className="btn btn-secondary" onClick={()=>remove(p.id)}>Delete</button>
                </div>
              ))}
              <form onSubmit={createPortfolio} style={{ display:'flex', gap:8 }}>
                <input placeholder="New portfolio name" value={newName} onChange={e=>setNewName(e.target.value)} />
                <button className="btn btn-primary" type="submit">Add</button>
              </form>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}


