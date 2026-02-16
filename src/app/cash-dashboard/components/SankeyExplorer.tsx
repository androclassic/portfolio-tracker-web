'use client';
import React, { useCallback, useMemo, useState } from 'react';
import { getAssetColor } from '@/lib/assets';
import { PlotlyChart as Plot } from '@/components/charts/plotly/PlotlyChart';
import CryptoIcon from '../../components/CryptoIcon';
import { createSankeyExplorerData, type BuyLotTraceWithFundingSells } from '../lib/sankey-helpers';
import type { TaxableEvent } from '@/lib/tax/romania-v2';
import type { Transaction as Tx } from '@/lib/types';

export function SankeyExplorer({ event, transactions, onTransactionClick }: { event: TaxableEvent; transactions?: Tx[]; onTransactionClick?: (txId: number) => void }) {
  const directSales = event.saleTrace || [];
  const rootSaleIds = useMemo(() => directSales.map((s) => s.saleTransactionId), [directSales]);
  const rootBuyIds = useMemo(() => [] as number[], []);

  const [visibleSaleIds, setVisibleSaleIds] = useState<number[]>(rootSaleIds);
  const [visibleBuyIds, setVisibleBuyIds] = useState<number[]>(rootBuyIds);
  const [withdrawalExpanded, setWithdrawalExpanded] = useState<boolean>(false);
  const [treeVisibleSaleIds, setTreeVisibleSaleIds] = useState<number[]>([]);
  const [treeVisibleBuyIds, setTreeVisibleBuyIds] = useState<number[]>([]);
  const [showDepositTxs, setShowDepositTxs] = useState<boolean>(false);
  const [showLabels, setShowLabels] = useState<boolean>(false);
  const [nodeThickness, setNodeThickness] = useState<number>(10);
  const [nodePad, setNodePad] = useState<number>(10);

  const deepSales = (event.saleTraceDeep && event.saleTraceDeep.length ? event.saleTraceDeep : directSales) || [];
  const deepSaleById = useMemo(() => {
    const m = new Map<number, (typeof deepSales)[number]>();
    for (const s of deepSales) m.set(s.saleTransactionId, s);
    return m;
  }, [deepSales]);
  const buyFundingSellIds = useMemo(() => {
    const map = new Map<number, Set<number>>();
    for (const s of deepSales) {
      for (const bl of s.buyLots) {
        const fs = (bl as BuyLotTraceWithFundingSells).fundingSells || [];
        if (!fs.length) continue;
        const set = map.get(bl.buyTransactionId) || new Set<number>();
        for (const f of fs) set.add(f.saleTransactionId);
        map.set(bl.buyTransactionId, set);
      }
    }
    return map;
  }, [deepSales]);

  const data = useMemo(() => {
    return createSankeyExplorerData(event, {
      visibleSaleIds: new Set<number>(visibleSaleIds),
      visibleBuyIds: new Set<number>(visibleBuyIds),
      showDepositTxs,
      showLabels,
      nodeThickness,
      nodePad,
    }, transactions);
  }, [event, visibleSaleIds, visibleBuyIds, showDepositTxs, showLabels, nodeThickness, nodePad, transactions]);

  const onNodeClick = useCallback((ev: unknown) => {
    const e = ev as { points?: Array<{ pointNumber?: number; pointIndex?: number }> } | null;
    const p = e?.points?.[0];
    const idx = typeof p?.pointNumber === 'number'
      ? p.pointNumber
      : (typeof p?.pointIndex === 'number' ? p.pointIndex : null);
    if (idx === null) return;
    const key = data.nodeKeys[idx];
    if (!key) return;

    if (key.startsWith('collapsed:')) {
      const buyId = Number(key.slice('collapsed:'.length));
      if (!Number.isFinite(buyId)) return;
      const fs = buyFundingSellIds.get(buyId);
      if (!fs || !fs.size) return;
      const newSales = new Set<number>(visibleSaleIds);
      for (const id of fs.values()) newSales.add(id);
      setVisibleSaleIds(Array.from(newSales.values()));
      const newBuys = new Set<number>(visibleBuyIds);
      newBuys.add(buyId);
      setVisibleBuyIds(Array.from(newBuys.values()));
      return;
    }

    if (key.startsWith('collapsedLots:')) {
      const saleId = Number(key.slice('collapsedLots:'.length));
      if (!Number.isFinite(saleId)) return;
      const sale = deepSaleById.get(saleId);
      if (!sale) return;
      const newBuys = new Set<number>(visibleBuyIds);
      for (const bl of sale.buyLots) newBuys.add(bl.buyTransactionId);
      setVisibleBuyIds(Array.from(newBuys.values()));
      return;
    }

    if (key.startsWith('sell:')) {
      const saleId = Number(key.slice('sell:'.length));
      const sale = deepSaleById.get(saleId);
      if (!sale) return;
      const newBuys = new Set<number>(visibleBuyIds);
      for (const bl of sale.buyLots) newBuys.add(bl.buyTransactionId);
      setVisibleBuyIds(Array.from(newBuys.values()));
      return;
    }

    if (key.startsWith('buy:')) {
      const buyId = Number(key.slice('buy:'.length));
      const fs = buyFundingSellIds.get(buyId);
      if (!fs || !fs.size) return;
      const newSales = new Set<number>(visibleSaleIds);
      for (const id of fs.values()) newSales.add(id);
      setVisibleSaleIds(Array.from(newSales.values()));
      return;
    }
  }, [data.nodeKeys, deepSaleById, buyFundingSellIds, visibleBuyIds, visibleSaleIds]);

  const onReset = useCallback(() => {
    setVisibleSaleIds(rootSaleIds);
    setVisibleBuyIds(rootBuyIds);
  }, [rootSaleIds, rootBuyIds]);

  const onExpandAll = useCallback(() => {
    const allSales = new Set<number>(visibleSaleIds);
    const allBuys = new Set<number>(visibleBuyIds);
    for (const s of deepSales) {
      allSales.add(s.saleTransactionId);
      for (const bl of s.buyLots) allBuys.add(bl.buyTransactionId);
    }
    setVisibleSaleIds(Array.from(allSales.values()));
    setVisibleBuyIds(Array.from(allBuys.values()));
    setShowDepositTxs(false);
  }, [deepSales, visibleSaleIds, visibleBuyIds]);

  // Build hierarchical transaction tree
  const transactionTree = useMemo(() => {
    const tree: Array<{
      id: string;
      type: 'withdrawal' | 'sell' | 'buy' | 'deposit';
      transactionId?: number;
      asset: string;
      amount: number;
      quantity?: number;
      costBasis?: number;
      datetime: string;
      children: Array<typeof tree[number]>;
      expanded: boolean;
      hasChildren?: boolean;
    }> = [];

    const withdrawalTx = transactions?.find(t => t.id === event.transactionId);
    if (withdrawalTx) {
      const withdrawalAmount = event.fiatAmountUsd || (withdrawalTx.toQuantity || 0);
      const hasChildren = deepSales.length > 0;
      tree.push({
        id: `withdrawal-${withdrawalTx.id}`,
        type: 'withdrawal',
        transactionId: withdrawalTx.id,
        asset: withdrawalTx.toAsset.toUpperCase(),
        amount: withdrawalAmount,
        quantity: withdrawalTx.toQuantity || 0,
        datetime: withdrawalTx.datetime,
        children: [],
        expanded: withdrawalExpanded,
        hasChildren: hasChildren,
      });
    }

    for (const sale of deepSales) {
      const saleTx = transactions?.find(t => t.id === sale.saleTransactionId);
      if (saleTx) {
        const hasBuyLots = sale.buyLots && sale.buyLots.length > 0;

        let saleQuantity = 0;
        if (saleTx.fromAsset && saleTx.fromAsset.toUpperCase() === sale.asset.toUpperCase()) {
          saleQuantity = saleTx.fromQuantity || 0;
        } else if (saleTx.toAsset && saleTx.toAsset.toUpperCase() === sale.asset.toUpperCase()) {
          saleQuantity = saleTx.toQuantity || 0;
        } else {
          const price = saleTx.fromPriceUsd || saleTx.toPriceUsd || 0;
          if (price > 0 && sale.proceedsUsd > 0) {
            saleQuantity = sale.proceedsUsd / price;
          }
        }

        const saleNode: typeof tree[number] = {
          id: `sell-${sale.saleTransactionId}`,
          type: 'sell' as const,
          transactionId: sale.saleTransactionId,
          asset: sale.asset.toUpperCase(),
          amount: sale.proceedsUsd || 0,
          quantity: saleQuantity,
          costBasis: sale.costBasisUsd || 0,
          datetime: saleTx.datetime,
          children: [],
          expanded: treeVisibleSaleIds.includes(sale.saleTransactionId),
          hasChildren: hasBuyLots,
        };

        if (treeVisibleSaleIds.includes(sale.saleTransactionId) && hasBuyLots) {
          for (const buyLot of sale.buyLots) {
            const buyTx = transactions?.find(t => t.id === buyLot.buyTransactionId);
            if (buyTx) {
              const fundingSells = (buyLot as BuyLotTraceWithFundingSells).fundingSells || [];
              const hasFundingSells = fundingSells.length > 0;

              const buyNode = {
                id: `buy-${buyLot.buyTransactionId}`,
                type: 'buy' as const,
                transactionId: buyLot.buyTransactionId,
                asset: buyLot.asset.toUpperCase(),
                amount: (buyLot.cashSpentUsd || buyLot.costBasisUsd || 0),
                quantity: buyLot.quantity || 0,
                costBasis: buyLot.costBasisUsd || 0,
                datetime: buyLot.buyDatetime,
                children: [] as typeof tree[number][],
                expanded: treeVisibleBuyIds.includes(buyLot.buyTransactionId),
                hasChildren: hasFundingSells,
              };

              if (treeVisibleBuyIds.includes(buyLot.buyTransactionId) && hasFundingSells) {
                for (const fundingSell of fundingSells) {
                  const fundingTx = transactions?.find(t => t.id === fundingSell.saleTransactionId);
                  let fundingQuantity = 0;
                  if (fundingTx) {
                    if (fundingTx.fromAsset && fundingTx.fromAsset.toUpperCase() === fundingSell.asset.toUpperCase()) {
                      fundingQuantity = fundingTx.fromQuantity || 0;
                    } else if (fundingTx.toAsset && fundingTx.toAsset.toUpperCase() === fundingSell.asset.toUpperCase()) {
                      fundingQuantity = fundingTx.toQuantity || 0;
                    } else {
                      const price = fundingTx.fromPriceUsd || fundingTx.toPriceUsd || 0;
                      if (price > 0 && fundingSell.amountUsd > 0) {
                        fundingQuantity = fundingSell.amountUsd / price;
                      }
                    }
                  }
                  buyNode.children.push({
                    id: `funding-sell-${fundingSell.saleTransactionId}`,
                    type: 'sell',
                    transactionId: fundingSell.saleTransactionId,
                    asset: fundingSell.asset.toUpperCase(),
                    amount: fundingSell.amountUsd || 0,
                    quantity: fundingQuantity,
                    costBasis: fundingSell.costBasisUsd || 0,
                    datetime: fundingSell.saleDatetime,
                    children: [],
                    expanded: false,
                    hasChildren: false,
                  });
                }
                buyNode.children.sort((a, b) => (b.costBasis || b.amount || 0) - (a.costBasis || a.amount || 0));
              }

              saleNode.children.push(buyNode);
            }
          }
          if (saleNode.children.length > 0) {
            saleNode.children.sort((a, b) => (b.costBasis || b.amount || 0) - (a.costBasis || a.amount || 0));
          }
        }

        if (tree[0] && withdrawalExpanded) {
          tree[0].children.push(saleNode);
        }
      }
    }

    if (tree[0] && tree[0].children.length > 0) {
      tree[0].children.sort((a, b) => (b.costBasis || b.amount || 0) - (a.costBasis || a.amount || 0));
    }

    return tree;
  }, [event, transactions, deepSales, treeVisibleSaleIds, treeVisibleBuyIds, withdrawalExpanded]);

  const toggleNode = useCallback((nodeId: string) => {
    if (nodeId.startsWith('withdrawal-')) {
      setWithdrawalExpanded(!withdrawalExpanded);
    } else if (nodeId.startsWith('sell-')) {
      const saleId = Number(nodeId.slice('sell-'.length));
      if (treeVisibleSaleIds.includes(saleId)) {
        setTreeVisibleSaleIds(treeVisibleSaleIds.filter(id => id !== saleId));
      } else {
        setTreeVisibleSaleIds([...treeVisibleSaleIds, saleId]);
      }
    } else if (nodeId.startsWith('buy-')) {
      const buyId = Number(nodeId.slice('buy-'.length));
      if (treeVisibleBuyIds.includes(buyId)) {
        setTreeVisibleBuyIds(treeVisibleBuyIds.filter(id => id !== buyId));
      } else {
        setTreeVisibleBuyIds([...treeVisibleBuyIds, buyId]);
      }
    }
  }, [treeVisibleSaleIds, treeVisibleBuyIds, withdrawalExpanded]);

  const [selectedTransactionId, setSelectedTransactionId] = useState<number | null>(null);

  const renderTransactionDetails = useCallback((tx: Tx | undefined) => {
    if (!tx) return null;

    const nf = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
    const df = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    return (
      <div style={{
        padding: '16px',
        backgroundColor: 'var(--card)',
        borderRadius: '8px',
        border: '1px solid var(--border)',
        marginTop: '12px'
      }}>
        <h5 style={{ margin: '0 0 12px 0', fontSize: '1rem', fontWeight: 600 }}>Transaction Details</h5>
        <div style={{ display: 'grid', gap: '12px', fontSize: '0.9rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--muted)' }}>Date:</span>
            <span>{df.format(new Date(tx.datetime))}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--muted)' }}>Type:</span>
            <span className={`transaction-type-badge ${tx.type.toLowerCase()}`}>
              {tx.type === 'Deposit' ? '💰' : tx.type === 'Withdrawal' ? '💸' : '🔄'} {tx.type}
            </span>
          </div>
          {tx.fromAsset && (
            <div style={{
              padding: '12px',
              backgroundColor: 'var(--surface)',
              borderRadius: '6px',
              border: '1px solid var(--border)'
            }}>
              <div style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '8px' }}>From:</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <CryptoIcon symbol={tx.fromAsset} size={20} alt={`${tx.fromAsset} logo`} />
                <span style={{
                  display: 'inline-block',
                  padding: '4px 10px',
                  borderRadius: 12,
                  background: `${getAssetColor(tx.fromAsset)}22`,
                  color: getAssetColor(tx.fromAsset),
                  fontWeight: 600
                }}>
                  {tx.fromAsset.toUpperCase()}
                </span>
              </div>
              {tx.fromQuantity && (
                <div style={{ fontSize: '0.9em', color: 'var(--muted)', marginTop: '4px' }}>
                  {nf.format(tx.fromQuantity)} {tx.fromPriceUsd ? `@ $${nf.format(tx.fromPriceUsd)}` : ''}
                </div>
              )}
            </div>
          )}
          <div style={{
            padding: '12px',
            backgroundColor: 'var(--surface)',
            borderRadius: '6px',
            border: '1px solid var(--border)'
          }}>
            <div style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '8px' }}>To:</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <CryptoIcon symbol={tx.toAsset} size={20} alt={`${tx.toAsset} logo`} />
              <span style={{
                display: 'inline-block',
                padding: '4px 10px',
                borderRadius: 12,
                background: `${getAssetColor(tx.toAsset)}22`,
                color: getAssetColor(tx.toAsset),
                fontWeight: 600
              }}>
                {tx.toAsset.toUpperCase()}
              </span>
            </div>
            <div style={{ fontSize: '0.9em', color: 'var(--muted)', marginTop: '4px' }}>
              {nf.format(tx.toQuantity)} {tx.toPriceUsd ? `@ $${nf.format(tx.toPriceUsd)}` : ''}
            </div>
          </div>
          {tx.feesUsd && tx.feesUsd > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--muted)' }}>Fees:</span>
              <span>${nf.format(tx.feesUsd)}</span>
            </div>
          )}
          {tx.notes && (
            <div>
              <div style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '4px' }}>Notes:</div>
              <div style={{ color: 'var(--text)', fontSize: '0.9rem' }}>{tx.notes}</div>
            </div>
          )}
        </div>
      </div>
    );
  }, []);

  const renderTreeNode = useCallback((node: typeof transactionTree[number] & { hasChildren?: boolean }, level: number = 0) => {
    const indent = level * 24;
    const isExpanded = node.expanded;
    const hasChildren = node.children.length > 0 || node.hasChildren === true;
    const tx = node.transactionId ? transactions?.find(t => t.id === node.transactionId) : undefined;
    const showDetails = selectedTransactionId === node.transactionId;

    const typeColors = {
      withdrawal: '#ef4444',
      sell: '#f59e0b',
      buy: '#10b981',
      deposit: '#3b82f6',
    };

    const typeIcons = {
      withdrawal: '💸',
      sell: '📤',
      buy: '📥',
      deposit: '💰',
    };

    return (
      <div key={node.id}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 12px',
            marginLeft: `${indent}px`,
            backgroundColor: level % 2 === 0 ? 'var(--surface)' : 'var(--card)',
            borderLeft: `3px solid ${typeColors[node.type]}`,
            borderRadius: '6px',
            marginBottom: '4px',
            cursor: hasChildren ? 'pointer' : 'default',
            transition: 'all 0.2s',
          }}
          onClick={(e) => {
            if (hasChildren) {
              e.stopPropagation();
              toggleNode(node.id);
            }
          }}
          onMouseEnter={(e) => {
            if (hasChildren) {
              e.currentTarget.style.backgroundColor = 'rgba(125, 125, 125, 0.1)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = level % 2 === 0 ? 'var(--surface)' : 'var(--card)';
          }}
        >
          {hasChildren && (
            <span
              style={{ fontSize: '0.8rem', minWidth: '16px', cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation();
                toggleNode(node.id);
              }}
            >
              {isExpanded ? '▼' : '▶'}
            </span>
          )}
          {!hasChildren && <span style={{ minWidth: '16px' }} />}
          <span style={{ fontSize: '1.1rem' }}>{typeIcons[node.type]}</span>
          <span style={{ fontWeight: 600, color: typeColors[node.type] }}>
            {node.type.toUpperCase()}
          </span>
          <span style={{ color: getAssetColor(node.asset), fontWeight: 600 }}>
            {node.asset}
          </span>
          {node.quantity !== undefined && node.quantity > 0 && (
            <span style={{ color: 'var(--text-secondary)', marginLeft: '0.5rem', fontSize: '0.85rem' }}>
              {node.quantity.toFixed(4)} units
            </span>
          )}
          <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: '0.9rem' }}>
            ${node.amount.toFixed(2)}
          </span>
          {node.costBasis !== undefined && node.costBasis > 0 && (
            <>
              {node.quantity !== undefined && node.quantity > 0 && (
                <span style={{ color: 'var(--muted)', fontSize: '0.8rem', minWidth: '90px', textAlign: 'right' }}>
                  ${(node.costBasis / node.quantity).toFixed(2)}/unit
                </span>
              )}
              <span style={{ color: 'var(--muted)', fontSize: '0.85rem', minWidth: '90px', textAlign: 'right' }}>
                Cost: ${node.costBasis.toFixed(2)}
              </span>
            </>
          )}
          <span style={{ color: 'var(--muted)', fontSize: '0.8rem', minWidth: '100px', textAlign: 'right' }}>
            {new Date(node.datetime).toLocaleDateString()}
          </span>
          {node.transactionId && (
            <button
              className="btn btn-secondary btn-sm"
              style={{
                padding: '4px 8px',
                fontSize: '0.75rem',
                marginLeft: '8px'
              }}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedTransactionId(showDetails ? null : node.transactionId || null);
              }}
              title="View transaction details"
            >
              {showDetails ? '▼' : '▶'} Details
            </button>
          )}
        </div>
        {showDetails && tx && (
          <div style={{ marginLeft: `${indent + 24}px`, marginBottom: '8px' }}>
            {renderTransactionDetails(tx)}
          </div>
        )}
        {isExpanded && hasChildren && (
          <div style={{ marginLeft: `${indent + 24}px` }}>
            {node.children.map(child => renderTreeNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  }, [toggleNode, transactions, selectedTransactionId, renderTransactionDetails]);

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem', padding: '12px', backgroundColor: 'var(--card)', borderRadius: '8px', border: '1px solid var(--border)' }}>
        <button onClick={onReset} className="btn btn-secondary btn-sm">🔄 Reset</button>
        <button onClick={onExpandAll} className="btn btn-secondary btn-sm">⬇️ Expand All</button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={showDepositTxs} onChange={(e) => setShowDepositTxs(e.target.checked)} />
            Show deposits
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />
            Show labels
          </label>
        </div>
      </div>

      {/* Sankey Diagram */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h4 style={{ margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)' }}>
          Flow Diagram
        </h4>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.75rem', fontSize: '0.85rem', color: 'var(--muted)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            Node thickness
            <input
              type="range"
              min={6}
              max={22}
              value={nodeThickness}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNodeThickness(Number(e.target.value))}
              style={{ width: '100px' }}
            />
            <span style={{ minWidth: 24, textAlign: 'right' }}>{nodeThickness}</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            Node padding
            <input
              type="range"
              min={4}
              max={22}
              value={nodePad}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNodePad(Number(e.target.value))}
              style={{ width: '100px' }}
            />
            <span style={{ minWidth: 24, textAlign: 'right' }}>{nodePad}</span>
          </label>
          <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
            Click nodes in the diagram to explore transactions hierarchically.
          </span>
        </div>
        <Plot
          data={data.data}
          layout={data.layout}
          style={{ width: '100%', minHeight: '400px' }}
          onClick={onNodeClick}
        />
      </div>

      {/* Hierarchical Tree View */}
      <div style={{
        marginTop: '1.5rem',
        padding: '16px',
        backgroundColor: 'var(--card)',
        borderRadius: '8px',
        border: '1px solid var(--border)',
        maxHeight: '600px',
        overflowY: 'auto'
      }}>
        <h4 style={{ margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)' }}>
          Transaction Hierarchy
        </h4>
        <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '12px' }}>
          Click on transactions with children (▶) to expand and explore the flow. Click &quot;Details&quot; to view full transaction information. Colors: 💸 Withdrawal (red), 📤 Sell (orange), 📥 Buy (green), 💰 Deposit (blue)
        </div>
        {transactionTree.map(node => renderTreeNode(node))}
      </div>
    </div>
  );
}
