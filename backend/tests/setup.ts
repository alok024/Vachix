/**
 * Jest global setup — runs before any test file imports application code.
 *
 * Loads tests/.env.test via dotenv so env.ts (which calls process.exit(1)
 * via Zod on missing required vars) initialises cleanly in the test process.
 * All values are fake-but-schema-valid — nothing here makes a real network call.
 *
 * Why dotenv instead of Object.assign(process.env, {...})?
 *   — A single .env.test file is the canonical truth for test credentials.
 *     Both this setup file and any CI --env-file flag can point at the same
 *     source rather than duplicating the list in two places.
 */

import dotenv from 'dotenv';
import path   from 'path';

dotenv.config({ path: path.join(__dirname, '.env.test') });
