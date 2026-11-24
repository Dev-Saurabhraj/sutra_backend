import type { PrismaClient } from "@prisma/client";
import type { DbClient } from "../core/db.js";
import { AuthRepository } from "../modules/auth/auth.repository.js";
import { ProducerRepository } from "../modules/producers/producer.repository.js";
import { StockRepository } from "../modules/stock/stock.repository.js";
import { KhataRepository } from "../modules/khata/khata.repository.js";
import { AlertRepository } from "../modules/alerts/alert.repository.js";
import { InvoiceRepository } from "../modules/invoices/invoice.repository.js";
import { OrderRepository } from "../modules/orders/order.repository.js";
import { VoiceRepository } from "../modules/voice/voice.repository.js";
import { CounterRepository } from "./counter.repository.js";
import { PartnerRepository } from "../modules/inventory/partner.repository.js";
import { LabourRepository } from "../modules/labour/labour.repository.js";
import { BillRepository } from "../modules/bills/bill.repository.js";
import { CapacityRepository } from "../modules/capacity/capacity.repository.js";
import { MarketRepository } from "../modules/market/market.repository.js";

/** Every repository, bound to one database client (the root client or a transaction). */
export type Repositories = {
  auth: AuthRepository;
  producers: ProducerRepository;
  stock: StockRepository;
  khata: KhataRepository;
  alerts: AlertRepository;
  invoices: InvoiceRepository;
  orders: OrderRepository;
  voice: VoiceRepository;
  counters: CounterRepository;
  partners: PartnerRepository;
  labour: LabourRepository;
  bills: BillRepository;
  capacity: CapacityRepository;
  market: MarketRepository;
};

export function createRepositories(db: DbClient): Repositories {
  return {
    auth: new AuthRepository(db),
    producers: new ProducerRepository(db),
    stock: new StockRepository(db),
    khata: new KhataRepository(db),
    alerts: new AlertRepository(db),
    invoices: new InvoiceRepository(db),
    orders: new OrderRepository(db),
    voice: new VoiceRepository(db),
    counters: new CounterRepository(db),
    partners: new PartnerRepository(db),
    labour: new LabourRepository(db),
    bills: new BillRepository(db),
    capacity: new CapacityRepository(db),
    market: new MarketRepository(db),
  };
}

/** Runs a block of writes atomically: all repositories inside share one transaction. */
export interface UnitOfWork {
  run<T>(work: (repos: Repositories) => Promise<T>): Promise<T>;
}

export class PrismaUnitOfWork implements UnitOfWork {
  constructor(private readonly prisma: PrismaClient) {}

  run<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => work(createRepositories(tx)), { timeout: 15_000 });
  }
}
