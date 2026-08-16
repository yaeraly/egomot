/**
 * Prerequisite import: create Client records for phone numbers referenced in
 * historical-sales.tsv. Does NOT run as part of the sales import itself.
 *
 * Usage:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/import-historical-sale-clients.ts [--dry-run]
 */
import { ClientType, PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const DATA_PATH = path.join(__dirname, 'data', 'historical-sales.tsv');
const RETAIL_WALK_IN_LABEL = 'Розничный';

function normalizePhoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

function parseCustomers(content: string): Map<string, string> {
  const customers = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('ДАТА')) continue;
    const parts = line.split('\t');
    if (parts.length < 5) continue;
    const customer = parts[4].trim();
    if (!customer || customer === RETAIL_WALK_IN_LABEL) continue;
    const digits = normalizePhoneDigits(customer);
    if (digits.length < 9) continue;
    if (!customers.has(digits)) {
      customers.set(digits, customer);
    }
  }
  return customers;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (!fs.existsSync(DATA_PATH)) {
    throw new Error(`Data file not found: ${DATA_PATH}`);
  }

  const customers = parseCustomers(fs.readFileSync(DATA_PATH, 'utf8'));
  console.log(`Unique phone customers in TSV: ${customers.size}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'IMPORT'}`);

  const existing = await prisma.client.findMany({
    select: { id: true, phone: true, name: true },
  });
  const byDigits = new Map(existing.map((c) => [normalizePhoneDigits(c.phone), c]));

  let created = 0;
  let skipped = 0;

  for (const [digits, displayPhone] of customers) {
    if (byDigits.has(digits)) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      console.log(`Would create client: ${displayPhone}`);
      created += 1;
      continue;
    }

    const client = await prisma.client.create({
      data: {
        name: displayPhone,
        phone: displayPhone,
        clientType: ClientType.RETAIL,
        isActive: true,
      },
    });
    byDigits.set(digits, client);
    created += 1;
    console.log(`Created client: ${displayPhone}`);
  }

  console.log('\nSummary:');
  console.log(`  created: ${created}`);
  console.log(`  already existed: ${skipped}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
