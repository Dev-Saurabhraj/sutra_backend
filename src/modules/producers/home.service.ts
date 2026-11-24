import { AppError } from "../../core/errors.js";
import type { Repositories } from "../../data/unit-of-work.js";
import { inr } from "../../shared/money.js";
import { addDays, type Clock } from "../../shared/time.js";
import type { StockService } from "../stock/stock.service.js";

/** The "Aaj" (today) screen: what needs attention and four numbers, plus a sentence to read aloud. */
export class HomeService {
  constructor(
    private readonly repos: Repositories,
    private readonly stock: StockService,
    private readonly clock: Clock,
  ) {}

  async today(producerId: string) {
    const now = this.clock.now();
    const producer = await this.repos.producers.findProfile(producerId);
    if (!producer) throw AppError.notFound("Producer");

    const [alerts, health, products, sales, khata, openOrders, newRequests] = await Promise.all([
      this.repos.alerts.list(producerId, { unreadOnly: true, take: 4 }),
      this.stock.health(producerId),
      this.repos.stock.products(producerId),
      this.repos.invoices.salesSince(producerId, addDays(now, -30)),
      this.repos.khata.openTotals(producerId),
      this.repos.orders.countByStatus(producerId, ["CONFIRMED", "IN_PRODUCTION"]),
      this.repos.orders.countByStatus(producerId, ["QUOTED"]),
    ]);

    const stockValue = health.reduce((a, m) => a + m.stockValue, 0) + products.reduce((a, p) => a + p.stock * p.price, 0);
    const lowCount = health.filter((m) => m.status !== "OK").length;
    const first = producer.name.replace(/^(Mohd\.|Md\.)\s*/, "").split(" ")[0] ?? producer.name;

    return {
      producer,
      greeting: { hi: `नमस्ते ${first} जी`, en: `Namaste, ${first}` },
      spoken: {
        hi: `नमस्ते ${first} जी। ${newRequests ? `${newRequests} नई माँग आई है। ` : ""}${lowCount ? `${lowCount} कच्चा माल कम है। ` : ""}पिछले तीस दिन की बिक्री ${inr(sales.taxable)} है।`,
        en: `Namaste ${first}. ${newRequests ? `${newRequests} new order requests. ` : ""}${lowCount ? `${lowCount} materials running low. ` : ""}Sales in the last 30 days: ${inr(sales.taxable)}.`,
      },
      alerts,
      kpis: {
        sales30d: sales.taxable,
        invoices30d: sales.count,
        stockValue,
        toReceive: khata.toReceive,
        toPay: khata.toPay,
        openOrders,
        newRequests,
      },
      materials: health.slice(0, 5),
    };
  }
}
