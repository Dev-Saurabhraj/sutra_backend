import { AppError } from "../../core/errors.js";
import type { Repositories } from "../../data/unit-of-work.js";
import type { GstRepository } from "../gst/gst.repository.js";
import { fyStart } from "../gst/gst-period.js";
import type { Clock } from "../../shared/time.js";
import { matchSchemes, type MakerFacts } from "./scheme-rules.js";

/** C6: government schemes a maker may qualify for, from facts Sutra already knows. */
export class SchemeService {
  constructor(
    private readonly repos: Repositories,
    private readonly gst: GstRepository,
    private readonly clock: Clock,
  ) {}

  async facts(producerId: string): Promise<MakerFacts> {
    const p = await this.repos.producers.findProfile(producerId);
    if (!p) throw AppError.notFound("Producer");
    const [fyTurnover, marks] = await Promise.all([this.gst.turnoverSince(producerId, fyStart(this.clock.now())), this.repos.producers.marks(producerId)]);
    return {
      industryKey: p.industry.key, businessKind: p.businessKind, gstScheme: p.gstScheme, udyam: !!p.udyamNumber,
      fyTurnover, inCluster: !!p.cluster, marks, machines: p.machines,
    };
  }

  async forProducer(producerId: string) {
    const schemes = matchSchemes(await this.facts(producerId));
    return { likely: schemes.filter((s) => s.fit === "LIKELY").length, schemes };
  }
}
