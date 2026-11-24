import type { Logger } from "../core/logger.js";

/** Domain events published after a unit of work commits. */
export type DomainEvents = {
  "stock.materialsConsumed": { producerId: string; materialIds: string[] };
};

type Handler<E extends keyof DomainEvents> = (payload: DomainEvents[E]) => Promise<void>;

/** Observer: publishers don't know who listens. Handler failures are logged, never thrown back at the user. */
export class EventBus {
  private readonly handlers = new Map<keyof DomainEvents, Handler<keyof DomainEvents>[]>();

  constructor(private readonly logger: Logger) {}

  on<E extends keyof DomainEvents>(event: E, handler: Handler<E>): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler as Handler<keyof DomainEvents>);
    this.handlers.set(event, list);
  }

  async publish<E extends keyof DomainEvents>(event: E, payload: DomainEvents[E]): Promise<void> {
    for (const handler of this.handlers.get(event) ?? []) {
      try {
        await handler(payload);
      } catch (err) {
        this.logger.error({ err, event }, "event handler failed");
      }
    }
  }
}
