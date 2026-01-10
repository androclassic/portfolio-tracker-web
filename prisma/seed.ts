import { PrismaClient, Prisma } from '@prisma/client';
import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { parse as parseDate, isValid } from 'date-fns';

const prisma = new PrismaClient();

function parseFloatSafe(v: string | undefined): number | null {
  if (!v) return null;
  const s = String(v).trim().replace(/[+$,]/g,'');
  if (s === '' || s.toLowerCase() === 'nan' || s.toLowerCase() === 'none') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeType(v: string): 'Deposit' | 'Withdrawal' | 'Swap' {
  const s = (v || '').toLowerCase();
  if (s === 'deposit') return 'Deposit';
  if (s === 'withdrawal' || s === 'withdraw') return 'Withdrawal';
  // Legacy: Buy/Sell become Swap
  return 'Swap';
}

function parseDateFlexible(input: string): Date | null {
  const raw = (input || '').replace(/"/g,'').trim();
  if (!raw) return null;
  const formats = [
    "dd MMM yyyy, h:mma",
    "dd MMM yyyy, h:mm a",
    "dd LLL yyyy, h:mma",
    "dd LLL yyyy, h:mm a",
    "dd MMM yyyy, H:mm",
  ];
  for (const f of formats) {
    const d = parseDate(raw, f, new Date());
    if (isValid(d)) return d;
  }
  const iso = new Date(raw);
  return isValid(iso) ? iso : null;
}

async function main() {
  const csvPath = '/Users/andrei/Documents/PortfolioTrackerApp/portfolio_converted.csv';
  if (!fs.existsSync(csvPath)) {
    console.error('CSV not found at', csvPath);
    process.exit(1);
  }
  const raw = fs.readFileSync(csvPath,'utf8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true });

  await prisma.transaction.deleteMany({});

  const data: Prisma.TransactionCreateManyInput[] = rows.reduce<Prisma.TransactionCreateManyInput[]>((acc, r: any) => {
    const asset = String(r.asset || '').trim().toUpperCase();
    const rawType = String(r.type || 'Buy').toLowerCase();
    const type = normalizeType(rawType);
    const priceUsd = parseFloatSafe(r.price_usd);
    const qtyParsed = parseFloatSafe(r.quantity) || 0;
    const quantity = Math.abs(qtyParsed);
    const dt = parseDateFlexible(String(r.datetime || ''));
    const feesUsd = parseFloatSafe(r.fees_usd);
    const costUsd = parseFloatSafe(r.cost_usd);
    const proceedsUsd = parseFloatSafe(r.proceeds_usd);
    const notes = r.notes ? String(r.notes) : null;
    
    if (!dt || !asset || quantity < 0) return acc;
    
    // Convert old Buy/Sell format to new Swap format
    if (rawType === 'buy' || rawType === 'sell') {
      // Legacy Buy: USDC -> Asset
      if (rawType === 'buy') {
        const fromQuantity = costUsd || (priceUsd ? quantity * priceUsd : quantity);
        if (!fromQuantity || fromQuantity <= 0) return acc; // Skip if we can't calculate a valid quantity
        acc.push({
          type: 'Swap',
          fromAsset: 'USDC',
          fromQuantity: fromQuantity,
          fromPriceUsd: 1.0,
          toAsset: asset,
          toQuantity: quantity,
          toPriceUsd: priceUsd ?? undefined,
          datetime: dt,
          feesUsd: feesUsd ?? undefined,
          notes: notes ?? undefined,
          portfolioId: 1,
        });
      } else {
        // Legacy Sell: Asset -> USDC
        const toQuantity = proceedsUsd || (priceUsd ? quantity * priceUsd : quantity);
        if (!toQuantity || toQuantity <= 0) return acc; // Skip if we can't calculate a valid quantity
        acc.push({
          type: 'Swap',
          fromAsset: asset,
          fromQuantity: quantity,
          fromPriceUsd: priceUsd ?? undefined,
          toAsset: 'USDC',
          toQuantity: toQuantity,
          toPriceUsd: 1.0,
          datetime: dt,
          feesUsd: feesUsd ?? undefined,
          notes: notes ?? undefined,
          portfolioId: 1,
        });
      }
    } else if (type === 'Deposit') {
      // Deposit: Fiat -> Stablecoin (assuming USDC for now)
      acc.push({
        type: 'Deposit',
        fromAsset: asset, // Fiat currency
        fromQuantity: quantity,
        fromPriceUsd: priceUsd ?? undefined,
        toAsset: 'USDC',
        toQuantity: costUsd || (priceUsd ? quantity * priceUsd : quantity),
        toPriceUsd: 1.0,
        datetime: dt,
        feesUsd: feesUsd ?? undefined,
        notes: notes ?? undefined,
        portfolioId: 1,
      });
    } else if (type === 'Withdrawal') {
      // Withdrawal: Stablecoin -> Fiat
      acc.push({
        type: 'Withdrawal',
        fromAsset: 'USDC',
        fromQuantity: quantity,
        fromPriceUsd: 1.0,
        toAsset: asset, // Fiat currency
        toQuantity: proceedsUsd || (priceUsd ? quantity * priceUsd : quantity),
        toPriceUsd: priceUsd ?? undefined,
        datetime: dt,
        feesUsd: feesUsd ?? undefined,
        notes: notes ?? undefined,
        portfolioId: 1,
      });
    }
    
    return acc;
  }, []);

  const chunkSize = 500;
  for (let i=0;i<data.length;i+=chunkSize) {
    const chunk = data.slice(i,i+chunkSize);
    await prisma.transaction.createMany({ data: chunk });
  }
  console.log('Seeded', data.length, 'transactions');
}

main().catch(e=>{console.error(e);process.exit(1);}).finally(()=>prisma.$disconnect());
