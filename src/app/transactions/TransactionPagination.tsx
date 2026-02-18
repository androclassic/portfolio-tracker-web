'use client';

const PAGE_SIZES = [10, 25, 50, 100];

interface Props {
  page: number;
  totalPages: number;
  totalFiltered: number;
  pageSize: number;
  onPage: (n: number) => void;
  onPageSize: (n: number) => void;
}

export default function TransactionPagination({ page, totalPages, totalFiltered, pageSize, onPage, onPageSize }: Props) {
  const from = totalFiltered === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalFiltered);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      flexWrap: 'wrap', gap: '0.75rem', padding: '1rem 0 0',
    }}>
      <span style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
        {totalFiltered === 0 ? 'No results' : `Showing ${from}\u2013${to} of ${totalFiltered}`}
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <label style={{ fontSize: '0.875rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          Per page
          <select
            value={pageSize}
            onChange={e => onPageSize(Number(e.target.value))}
            style={{ padding: '4px 8px', fontSize: '0.875rem' }}
          >
            {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <button className="btn btn-secondary btn-sm" onClick={() => onPage(page - 1)} disabled={page <= 1}>
          Prev
        </button>
        <span style={{ fontSize: '0.875rem', color: 'var(--muted)', minWidth: '3ch', textAlign: 'center' }}>
          {page} / {totalPages}
        </span>
        <button className="btn btn-secondary btn-sm" onClick={() => onPage(page + 1)} disabled={page >= totalPages}>
          Next
        </button>
      </div>
    </div>
  );
}
