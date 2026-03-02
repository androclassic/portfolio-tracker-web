import { createImportRoute } from '@/lib/integrations/import-route-factory';

export const POST = createImportRoute({
  exchangeName: 'Crypto.com',
  defaultSource: 'crypto-com-api',
});
