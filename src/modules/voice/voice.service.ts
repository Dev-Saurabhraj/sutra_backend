import type { Prisma } from "@prisma/client";
import { AppError } from "../../core/errors.js";
import type { Repositories, UnitOfWork } from "../../data/unit-of-work.js";
import type { EventBus } from "../../events/event-bus.js";
import { VoiceActionSchema, type VoiceAction, type VoiceParser } from "../../ai/voice-parser.js";
import type { Clock } from "../../shared/time.js";
import type { InvoiceService } from "../invoices/invoice.service.js";
import type { ProducerProfile } from "../producers/producer.repository.js";
import type { ActionResult, ActionView, VoiceCatalog } from "./handlers/types.js";
import type { VoiceActionRegistry } from "./voice.registry.js";

export type VoicePreview = {
  entryId: string;
  transcript: string;
  replyHi: string;
  parser: string;
  canSave: boolean;
  actions: (VoiceAction & ActionView)[];
};

/**
 * Voice entry in two steps (RULES B2 — AI drafts, people decide):
 * 1. preview: understand the note, store it, show what will be written.
 * 2. confirm: write exactly what was previewed, once, in one transaction.
 */
export class VoiceService {
  constructor(
    private readonly repos: Repositories,
    private readonly uow: UnitOfWork,
    private readonly parser: VoiceParser,
    private readonly registry: VoiceActionRegistry,
    private readonly invoices: InvoiceService,
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {}

  async preview(producerId: string, transcript: string): Promise<VoicePreview> {
    const producer = await this.producer(producerId);
    const catalog = await this.catalog(this.repos, producerId);
    const parsed = await this.parser.parse(transcript, {
      products: [...catalog.products.values()],
      materials: [...catalog.materials.values()],
    });
    const actions = (parsed?.actions ?? []).filter((a) => this.registry.get(a.kind)?.isValid(a, catalog));
    if (!parsed || actions.length === 0) {
      throw new AppError(422, "NOT_UNDERSTOOD", "Didn't catch that. Try: “aaj 6 saree bani, 4 Jaipur bheji”", {
        hi: "समझ नहीं आया। ऐसे बोलें: “आज 6 साड़ी बनी, 4 जयपुर भेजी”",
      });
    }

    const views = await Promise.all(
      actions.map(async (a) => ({ ...a, ...(await this.registry.get(a.kind)!.describe(a, { repos: this.repos, producer, catalog })) })),
    );
    const entry = await this.repos.voice.create({
      producerId, transcript, parser: parsed.parser, parsed: { actions, replyHi: parsed.replyHi } as Prisma.InputJsonValue,
    });
    return {
      entryId: entry.id, transcript, replyHi: parsed.replyHi, parser: parsed.parser,
      canSave: views.every((v) => !v.blocked), actions: views,
    };
  }

  async confirm(producerId: string, entryId: string): Promise<{ results: ActionResult[] }> {
    const producer = await this.producer(producerId);
    const consumed = new Set<string>();

    const results = await this.uow.run(async (repos) => {
      const entry = await repos.voice.find(producerId, entryId);
      if (!entry) throw AppError.notFound("Voice entry");
      const now = this.clock.now();
      if (!(await repos.voice.claim(producerId, entryId, now))) {
        throw AppError.conflict("ALREADY_SAVED", "This entry was already saved");
      }
      const actions = readStoredActions(entry.parsed);
      const catalog = await this.catalog(repos, producerId);
      const out: ActionResult[] = [];
      for (const action of actions) {
        const handler = this.registry.get(action.kind);
        if (!handler || !handler.isValid(action, catalog)) continue;
        const result = await handler.execute(action, { repos, producer, catalog, transcript: entry.transcript, now, invoices: this.invoices });
        result.consumedMaterialIds?.forEach((id) => consumed.add(id));
        out.push(result);
      }
      return out;
    });

    if (consumed.size) await this.bus.publish("stock.materialsConsumed", { producerId, materialIds: [...consumed] });
    return { results };
  }

  private async producer(producerId: string): Promise<ProducerProfile> {
    const p = await this.repos.producers.findProfile(producerId);
    if (!p) throw AppError.notFound("Producer");
    return p;
  }

  private async catalog(repos: Repositories, producerId: string): Promise<VoiceCatalog> {
    const [products, materials] = await Promise.all([repos.stock.products(producerId), repos.stock.materialBrief(producerId)]);
    return {
      products: new Map(products.map((p) => [p.id, { id: p.id, name: p.name, nameHi: p.nameHi, stock: p.stock }])),
      materials: new Map(materials.map((m) => [m.id, m])),
    };
  }
}

/** The stored draft is our own JSON, but re-validate it: never trust a blob blindly. */
function readStoredActions(parsed: Prisma.JsonValue): VoiceAction[] {
  const actions = (parsed as { actions?: unknown } | null)?.actions;
  if (!Array.isArray(actions)) return [];
  return actions.flatMap((a) => {
    const r = VoiceActionSchema.safeParse(a);
    return r.success ? [r.data] : [];
  });
}
