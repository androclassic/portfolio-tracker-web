import { createImportRoute } from '@/lib/integrations/import-route-factory';

export const POST = createImportRoute({
  exchangeName: 'Kraken',
  defaultSource: 'kraken-api',
});
