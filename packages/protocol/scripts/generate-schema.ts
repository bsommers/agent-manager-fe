/**
 * Writes packages/protocol/contract.schema.json from the FieldSpec tables.
 *
 *   npx vite-node packages/protocol/scripts/generate-schema.ts
 *
 * Takes no arguments (any argument exits 2) and writes exactly one fixed path.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serializeJsonSchema } from '../src/jsonschema.js';

const args = process.argv.slice(2);
if (args.length > 0) {
  console.error('generate-schema: takes no arguments');
  console.error('usage: npx vite-node packages/protocol/scripts/generate-schema.ts');
  process.exit(2);
}

const target = fileURLToPath(new URL('../contract.schema.json', import.meta.url));
const text = serializeJsonSchema();
writeFileSync(target, text);
console.log(`generate-schema: wrote ${target} (${Buffer.byteLength(text, 'utf8')} bytes)`);
