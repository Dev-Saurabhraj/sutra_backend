import { Prisma, PrismaClient } from "@prisma/client";

/** Either the root client or a transaction client. Repositories accept both. */
export type DbClient = PrismaClient | Prisma.TransactionClient;

export function createPrisma(url: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url } } });
}

/** Prisma returns Decimal for money/quantity columns; the domain works with numbers (see RULES A4). */
export const num = (d: Prisma.Decimal | number | null | undefined): number => (d == null ? 0 : Number(d));
