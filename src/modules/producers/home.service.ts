import { AppError } from "../../core/errors.js";
import type { Repositories } from "../../data/unit-of-work.js";
import { inr } from "../../shared/money.js";
import { addDays, type Clock } from "../../shared/time.js";
import type { InventoryService } from "../inventory/inventory.service.js";
import type { LabourService } from "../labour/labour.service.js";
import type { StockService } from "../stock/stock.service.js";

/** The "Aaj" (today) screen: what needs attention, money in/out, the flow of goods, and the team — mostly numbers, little text. */
export class HomeService {
  constructor(
    private readonly repos: Repositories,
    private readonly stock: StockService,
    private readonly labour: LabourService,
    private readonly inventory: InventoryService,
    private readonly clock: Clock,
  ) {}

  async today(producerId: string) {
    const now = this.clock.now();
    const producer = await this.repos.producers.findProfile(producerId);
    if (!producer) throw AppError.notFound("Producer");

    const [alerts, health, sales, khata, openOrders, newRequests, flow, team] = await Promise.all([
      this.repos.alerts.list(producerId, { unreadOnly: true, take: 6 }),
      this.stock.health(producerId),
      this.repos.invoices.salesSince(producerId, addDays(now, -30)),
      this.repos.khata.openTotals(producerId),
      this.repos.orders.countByStatus(producerId, ["CONFIRMED", "IN_PRODUCTION"]),
      this.repos.orders.countByStatus(producerId, ["QUOTED"]),
      this.inventory.flow(producerId),
      this.labour.summary(producerId),
    ]);

    const lowCount = health.filter((m) => m.status !== "OK").length;
    const first = producer.name.replace(/^(Mohd\.|Md\.)\s*/, "").split(" ")[0] ?? producer.name;
    const due = team.totals.wageDue;

    return {
      producer,
      greeting: { hi: `नमस्ते ${first} जी`, en: `Namaste, ${first}` },
      spoken: {
        hi: `नमस्ते ${first} जी। ${newRequests ? `${newRequests} नई माँग आई है। ` : ""}${lowCount ? `${lowCount} कच्चा माल कम है। ` : ""}${due > 0 ? `कारीगरों का ${inr(due)} देना है। ` : ""}पिछले तीस दिन की बिक्री ${inr(sales.taxable)} है।`,
        en: `Namaste ${first}. ${newRequests ? `${newRequests} new order requests. ` : ""}${lowCount ? `${lowCount} materials running low. ` : ""}${due > 0 ? `${inr(due)} wages due. ` : ""}Sales in the last 30 days: ${inr(sales.taxable)}.`,
      },
      alerts,
      kpis: {
        sales30d: sales.taxable,
        invoices30d: sales.count,
        stockValue: flow.raw.value + flow.ready.value,
        toReceive: khata.toReceive,
        toPay: khata.toPay,
        openOrders,
        newRequests,
      },
      flow: {
        kind: flow.kind,
        suppliers: flow.suppliers.count,
        rawItems: flow.raw.items,
        rawLow: flow.raw.low,
        making: flow.making.madeThisWeek,
        readyUnits: flow.ready.units,
        clients: flow.clients.count,
        soldThisWeek: flow.clients.soldThisWeek,
      },
      labour: {
        workers: team.workers.length,
        presentToday: team.totals.presentToday,
        wageDue: team.totals.wageDue,
        overdue: team.totals.overdue,
        advancePending: team.totals.advancePending,
      },
      materials: health.slice(0, 6),
    };
  }
}
