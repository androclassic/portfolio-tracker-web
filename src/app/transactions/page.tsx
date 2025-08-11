'use client';
import useSWR, { useSWRConfig } from 'swr';
import { useMemo, useState } from 'react';
import { usePortfolio } from '../PortfolioProvider';

const fetcher = (url: string) => fetch(url).then(r=>r.json());

type Tx = { id:number; asset:string; type:'Buy'|'Sell'; priceUsd?:number|null; quantity:number; datetime:string; costUsd?:number|null; proceedsUsd?:number|null; notes?:string|null };

export default function TransactionsPage(){
  const { selectedId } = usePortfolio();
  const swrKey = selectedId === 'all' ? '/api/transactions' : (selectedId? `/api/transactions?portfolioId=${selectedId}` : null);
  const { data: txs } = useSWR<Tx[]>(swrKey, fetcher);
  const { mutate } = useSWRConfig();
  const [assetFilter, setAssetFilter] = useState<string>('All');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc');
  const [isOpen, setIsOpen] = useState(false);
  const [newTx, setNewTx] = useState<{ asset: string; type: 'Buy'|'Sell'|string; quantity: number; priceUsd: string; datetime: string; notes?: string }>({ asset:'', type:'Buy', quantity:0, priceUsd:'', datetime:'', notes:'' });
  const [editing, setEditing] = useState<Tx|null>(null);

  const ASSET_COLORS: Record<string,string> = useMemo(() => ({
    BTC: '#f7931a', ETH: '#3c3c3d', ADA: '#0033ad', XRP: '#000000', DOT: '#e6007a', LINK: '#2a5ada', SOL: '#00ffa3', AVAX: '#e84142', SUI: '#6fbcf0', USDT: '#26a17b'
  }), []);
  const logoUrl = (sym: string) => `https://cryptoicons.org/api/icon/${sym.toLowerCase()}/32`;

  const assets = useMemo(()=>{
    const s = new Set<string>();
    (txs||[]).forEach(t=>s.add(t.asset.toUpperCase()));
    return ['All', ...Array.from(s).sort()];
  }, [txs]);

  const filtered = useMemo(()=>{
    const list = (txs||[]).filter(t=> assetFilter==='All' ? true : t.asset.toUpperCase()===assetFilter);
    return list.sort((a,b)=> sortDir==='asc' ? new Date(a.datetime).getTime()-new Date(b.datetime).getTime() : new Date(b.datetime).getTime()-new Date(a.datetime).getTime());
  }, [txs, assetFilter, sortDir]);

  async function addTx(e: React.FormEvent){
    e.preventDefault();
    const body = {
      asset: newTx.asset.toUpperCase(),
      type: (newTx.type === 'Sell' ? 'Sell' : 'Buy') as 'Buy'|'Sell',
      priceUsd: newTx.priceUsd ? Number(newTx.priceUsd) : null,
      quantity: Number(newTx.quantity),
      datetime: newTx.datetime,
      notes: newTx.notes ? newTx.notes : null,
      portfolioId: selectedId ?? 1,
    };
    const res = await fetch('/api/transactions', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) });
    if (res.ok){ setIsOpen(false); setNewTx({ asset:'', type:'Buy', quantity:0, priceUsd:'', datetime:'', notes:'' }); if (swrKey) mutate(swrKey); }
  }

  async function removeTx(id: number){
    if (!confirm('Delete this transaction?')) return;
    await fetch(`/api/transactions?id=${id}`, { method:'DELETE' });
    if (swrKey) mutate(swrKey);
  }

  function startEdit(t: Tx){ setEditing(t); }

  async function saveEdit(e: React.FormEvent){
    e.preventDefault();
    if (!editing) return;
    const body: Partial<Tx> = {
      id: editing.id,
      asset: editing.asset.toUpperCase(),
      type: editing.type,
      priceUsd: editing.priceUsd ?? null,
      quantity: editing.quantity,
      datetime: editing.datetime,
      notes: editing.notes ?? null,
    } as any;
    await fetch('/api/transactions', { method:'PUT', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) });
    setEditing(null);
    if (swrKey) mutate(swrKey);
  }

  const nf = new Intl.NumberFormat(undefined,{ maximumFractionDigits: 8 });
  const df = new Intl.DateTimeFormat(undefined,{ dateStyle:'medium', timeStyle:'short' });

  return (
    <main>
      <h1>Transactions</h1>
      <div className="toolbar">
        <div className="filters">
          <label>Asset
            <select value={assetFilter} onChange={e=>setAssetFilter(e.target.value)}>{assets.map(a=> <option key={a} value={a}>{a}</option>)}</select>
          </label>
          <label>Sort by date
            <select value={sortDir} onChange={e=>setSortDir((e.target.value as 'asc'|'desc'))}>
              <option value="desc">Newest first</option>
              <option value="asc">Oldest first</option>
            </select>
          </label>
        </div>
        <button className="btn btn-primary" onClick={()=>setIsOpen(true)}>Add transaction</button>
        {selectedId && (
          <div style={{ display:'inline-flex', gap:8, marginLeft: 8 }}>
            <form action={`/api/transactions/export?portfolioId=${selectedId}`} method="GET">
              <button type="submit" className="btn btn-secondary">Export CSV</button>
            </form>
            <label className="btn btn-secondary" style={{ cursor:'pointer' }}>
              Import CSV
              <input type="file" accept=".csv" style={{ display:'none' }} onChange={async (e)=>{
                const file = e.target.files?.[0]; if (!file) return;
                const fd = new FormData(); fd.append('file', file);
                await fetch(`/api/transactions/import?portfolioId=${selectedId}`, { method:'POST', body: fd });
                if (swrKey) mutate(swrKey);
              }} />
            </label>
          </div>
        )}
      </div>

      <section className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th><th>Asset</th><th>Type</th><th>Quantity</th><th>Price USD</th><th>Cost USD</th><th>Proceeds USD</th><th>Notes</th><th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(t=> (
              <tr key={t.id}>
                <td>{df.format(new Date(t.datetime))}</td>
                <td>
                  <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
                    <img src={logoUrl(t.asset)} width={18} height={18} alt="" style={{ borderRadius: 4, background: '#00000010' }} onError={(e)=>{ (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                    <span style={{ display:'inline-block', padding:'2px 8px', borderRadius: 12, background: `${(ASSET_COLORS[t.asset.toUpperCase()]||'#555')}22`, color: ASSET_COLORS[t.asset.toUpperCase()]||'#bbb', fontWeight:600 }}>{t.asset.toUpperCase()}</span>
                  </span>
                </td>
                <td>{t.type}</td>
                <td>{nf.format(t.quantity)}</td>
                <td>{t.priceUsd!=null? nf.format(t.priceUsd): ''}</td>
                <td>{t.costUsd!=null? nf.format(t.costUsd): ''}</td>
                <td>{t.proceedsUsd!=null? nf.format(t.proceedsUsd): ''}</td>
                <td>{t.notes||''}</td>
                <td style={{ whiteSpace:'nowrap' }}>
                  <button className="btn btn-secondary" onClick={()=>startEdit(t)}>Edit</button>
                  <button className="btn btn-secondary" onClick={()=>removeTx(t.id)} style={{ marginLeft: 6 }}>Delete</button>
                </td>
              </tr>
            ))}
            {filtered.length===0 && (<tr><td colSpan={8}>No transactions</td></tr>)}
          </tbody>
        </table>
      </section>

      {isOpen && (
        <div className="modal-backdrop" onClick={(e)=>{ if (e.target === e.currentTarget) setIsOpen(false); }}>
          <div className="modal" role="dialog" aria-modal="true">
            <header>
              <h3>Add transaction</h3>
              <button className="btn btn-secondary" onClick={()=>setIsOpen(false)}>Close</button>
            </header>
            <form onSubmit={addTx}>
              <input placeholder="Asset (e.g., BTC)" value={newTx.asset} onChange={e=>setNewTx(v=>({ ...v, asset:e.target.value }))} required />
              <select value={newTx.type} onChange={e=>setNewTx(v=>({ ...v, type:e.target.value }))}>
                <option>Buy</option>
                <option>Sell</option>
              </select>
              <input type="number" step="any" placeholder="Quantity" value={newTx.quantity} onChange={e=>setNewTx(v=>({ ...v, quantity:Number(e.target.value) }))} required />
              <input type="number" step="any" placeholder="Price USD (optional)" value={newTx.priceUsd} onChange={e=>setNewTx(v=>({ ...v, priceUsd:e.target.value }))} />
              <input type="datetime-local" value={newTx.datetime} onChange={e=>setNewTx(v=>({ ...v, datetime:e.target.value }))} required />
              <input placeholder="Notes (optional)" value={newTx.notes} onChange={e=>setNewTx(v=>({ ...v, notes:e.target.value }))} />
              <div className="actions">
                <button type="button" className="btn btn-secondary" onClick={()=>setIsOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editing && (
        <div className="modal-backdrop" onClick={(e)=>{ if (e.target === e.currentTarget) setEditing(null); }}>
          <div className="modal" role="dialog" aria-modal="true">
            <header>
              <h3>Edit transaction</h3>
              <button className="btn btn-secondary" onClick={()=>setEditing(null)}>Close</button>
            </header>
            <form onSubmit={saveEdit}>
              <input placeholder="Asset" value={editing.asset} onChange={e=>setEditing(v=> v? { ...v, asset:e.target.value } : v)} required />
              <select value={editing.type} onChange={e=>setEditing(v=> v? { ...v, type:e.target.value as 'Buy'|'Sell' } : v)}>
                <option>Buy</option>
                <option>Sell</option>
              </select>
              <input type="number" step="any" placeholder="Quantity" value={editing.quantity} onChange={e=>setEditing(v=> v? { ...v, quantity:Number(e.target.value) } : v)} required />
              <input type="number" step="any" placeholder="Price USD (optional)" value={editing.priceUsd ?? ''} onChange={e=>setEditing(v=> v? { ...v, priceUsd:e.target.value === ''? null : Number(e.target.value) } : v)} />
              <input type="datetime-local" value={new Date(editing.datetime).toISOString().slice(0,16)} onChange={e=>setEditing(v=> v? { ...v, datetime:e.target.value } : v)} required />
              <input placeholder="Notes (optional)" value={editing.notes ?? ''} onChange={e=>setEditing(v=> v? { ...v, notes:e.target.value } : v)} />
              <div className="actions">
                <button type="button" className="btn btn-secondary" onClick={()=>setEditing(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
