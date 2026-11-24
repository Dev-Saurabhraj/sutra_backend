import type { EventBus } from "../../events/event-bus.js";
import type { AlertRepository } from "../alerts/alert.repository.js";
import type { StockService } from "./stock.service.js";

/** Observer: after materials are consumed, raise a Hindi + English alert for anything now CRITICAL. */
export function registerLowStockWatcher(bus: EventBus, stock: StockService, alerts: AlertRepository): void {
  bus.on("stock.materialsConsumed", async ({ producerId, materialIds }) => {
    const health = await stock.health(producerId);
    for (const m of health) {
      if (!materialIds.includes(m.id) || m.status !== "CRITICAL") continue;
      const title = `${m.name} is running low`;
      if (await alerts.hasUnread(producerId, "LOW_STOCK", title)) continue;
      const days = m.daysLeft === null ? "" : Math.max(0, Math.round(m.daysLeft));
      await alerts.create({
        producerId,
        kind: "LOW_STOCK",
        title,
        titleHi: `${m.nameHi} कम हो रहा है`,
        body: `Only ${m.stock} ${m.unit} left, about ${days} days. ${m.supplier?.name ?? "Supplier"} takes ${m.leadTimeDays} days.`,
        bodyHi: `सिर्फ़ ${m.stock} ${m.unit} बचा है, लगभग ${days} दिन चलेगा। सप्लायर को ${m.leadTimeDays} दिन लगते हैं।`,
        route: "/stock",
      });
    }
  });
}
