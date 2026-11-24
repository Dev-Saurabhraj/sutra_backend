import type { AlertRepository } from "./alert.repository.js";

export class AlertService {
  constructor(private readonly alerts: AlertRepository) {}

  list(producerId: string, unreadOnly: boolean, take = 30) {
    return this.alerts.list(producerId, { unreadOnly, take });
  }

  markRead(producerId: string, id: string) {
    return this.alerts.markRead(producerId, id);
  }

  markAllRead(producerId: string) {
    return this.alerts.markRead(producerId);
  }
}
