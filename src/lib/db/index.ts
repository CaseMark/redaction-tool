import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL!;

// For Neon and other cloud providers, SSL is required
const queryClient = postgres(connectionString, {
  ssl: 'require',
});

export const db = drizzle(queryClient, { schema });

// Export schema for convenience
export * from './schema';
