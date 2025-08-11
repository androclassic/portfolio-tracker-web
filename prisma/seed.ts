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

function normalizeType(v: string): 'Buy' | 'Sell' {
  const s = (v || '').toLowerCase();
  return s === 'sell' ? 'Sell' : 'Buy';
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
    const type = normalizeType(String(r.type || 'Buy'));
    const priceUsd = parseFloatSafe(r.price_usd);
    const qtyParsed = parseFloatSafe(r.quantity) || 0;
    const quantity = Math.abs(qtyParsed);
    const dt = parseDateFlexible(String(r.datetime || ''));
    const feesUsd = parseFloatSafe(r.fees_usd);
    const costUsd = parseFloatSafe(r.cost_usd);
    const proceedsUsd = parseFloatSafe(r.proceeds_usd);
    const notes = r.notes ? String(r.notes) : null;
    if (dt && asset && quantity >= 0) {
      acc.push({ asset, type, priceUsd: priceUsd ?? undefined, quantity, datetime: dt, feesUsd: feesUsd ?? undefined, costUsd: costUsd ?? undefined, proceedsUsd: proceedsUsd ?? undefined, notes: notes ?? undefined });
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
