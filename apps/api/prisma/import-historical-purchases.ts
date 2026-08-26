/**
 * Historical purchases importer.
 *
 * Expected TSV columns:
 *   Purchase Date | Warehouse Receipt Date | Supplier | Product | Qty | Unit Price (KGS) | Total Amount (KGS)
 *
 * Usage:
 *   npm run import:historical-purchases -- --validate prisma/data/historical-purchases.tsv
 *   npm run import:historical-purchases -- prisma/data/historical-purchases.tsv
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  printPurchaseValidationReport,
  validateHistoricalPurchases,
} from '../src/purchases/historical-purchases-import.logic';

function resolveDataPath(defaultRelative: string): string {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const candidates = [
    args[0],
    defaultRelative,
    path.join('apps', 'api', defaultRelative),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const resolved = path.isAbsolute(candidate)
      ? candidate
      : path.resolve(process.cwd(), candidate);
    if (fs.existsSync(resolved)) return resolved;
  }

  return path.resolve(process.cwd(), args[0] ?? defaultRelative);
}

async function main() {
  const validateOnly = process.argv.includes('--validate');
  const dataPath = resolveDataPath(path.join('prisma', 'data', 'historical-purchases.tsv'));

  if (!fs.existsSync(dataPath)) {
    console.error(`Purchase source file not found: ${dataPath}`);
    console.error(
      'Provide the historical purchase TSV at prisma/data/historical-purchases.tsv or pass a path argument.',
    );
    process.exit(1);
  }

  const content = fs.readFileSync(dataPath, 'utf8');
  const validation = validateHistoricalPurchases(content);
  printPurchaseValidationReport(validation);

  if (validateOnly) {
    process.exit(validation.ok ? 0 : 1);
    return;
  }

  if (!validation.ok) {
    console.error('\nImport blocked: purchase source failed validation.');
    process.exit(1);
  }

  console.error(
    '\nImport blocked: historical purchase DB import is not implemented until a validated source file is supplied and reviewed.',
  );
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
