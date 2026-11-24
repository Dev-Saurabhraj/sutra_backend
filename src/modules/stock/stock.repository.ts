import type { EntrySource, MovementKind } from "@prisma/client";
import { num, type DbClient } from "../../core/db.js";
import type { MaterialUsageInput } from "../../engine/reorder.js";

export type ProductStock = {
  id: string;
  slug: string;
  name: string;
  nameHi: string;
  category: string;
  stock: number;
  price: number;
  hsn: string;
  gstRate: number;
  unitsPerMachinePerWeek: number;
  palette: string;
  imageUrl: string | null;
};

export type RecipeLine = { materialId: string; qtyPerUnit: number };

export type MovementInput = {
  producerId: string;
  kind: MovementKind;
  qty: number;
  source: EntrySource;
  materialId?: string;
  productId?: string;
  note?: string;
};

export class StockRepository {
  constructor(private readonly db: DbClient) {}

  /** Materials with consumption since `since`, ready for the reorder engine. */
  async materialsWithUsage(producerId: string, since: Date): Promise<MaterialUsageInput[]> {
    const rows = await this.db.material.findMany({
      where: { producerId },
      include: { supplier: true, movements: { where: { kind: "CONSUME", createdAt: { gte: since } }, select: { qty: true } } },
      orderBy: { name: "asc" },
    });
    return rows.map((m) => ({
      id: m.id, name: m.name, nameHi: m.nameHi, unit: m.unit, stock: num(m.stock), costPerUnit: num(m.costPerUnit),
      consumedInWindow: m.movements.reduce((a, x) => a + Math.abs(num(x.qty)), 0),
      supplier: m.supplier ? { id: m.supplier.id, name: m.supplier.name, phone: m.supplier.phone, leadTimeDays: m.supplier.leadTimeDays } : null,
    }));
  }

  async products(producerId: string): Promise<ProductStock[]> {
    const rows = await this.db.product.findMany({ where: { producerId }, orderBy: { createdAt: "asc" } });
    return rows.map(toProductStock);
  }

  async product(producerId: string, productId: string): Promise<(ProductStock & { recipe: RecipeLine[] }) | null> {
    const p = await this.db.product.findFirst({ where: { id: productId, producerId }, include: { recipe: true } });
    if (!p) return null;
    return { ...toProductStock(p), recipe: p.recipe.map((r) => ({ materialId: r.materialId, qtyPerUnit: num(r.qtyPerUnit) })) };
  }

  async materialBrief(producerId: string) {
    const rows = await this.db.material.findMany({ where: { producerId }, select: { id: true, name: true, nameHi: true, unit: true, stock: true } });
    return rows.map((m) => ({ id: m.id, name: m.name, nameHi: m.nameHi, unit: m.unit, stock: num(m.stock) }));
  }

  async materialWithSupplier(producerId: string, materialId: string) {
    const m = await this.db.material.findFirst({ where: { id: materialId, producerId }, include: { supplier: true } });
    if (!m) return null;
    return { id: m.id, name: m.name, nameHi: m.nameHi, unit: m.unit, stock: num(m.stock), supplier: m.supplier };
  }

  /** Change stock and write the matching movement. Call inside a unit of work (RULES A4). */
  async moveMaterial(input: MovementInput & { materialId: string }): Promise<number> {
    const m = await this.db.material.update({ where: { id: input.materialId }, data: { stock: { increment: input.qty } } });
    await this.db.stockMovement.create({ data: input });
    return num(m.stock);
  }

  async moveProduct(input: MovementInput & { productId: string }, stockDelta: number): Promise<number> {
    const p = await this.db.product.update({ where: { id: input.productId }, data: { stock: { increment: Math.round(stockDelta) } } });
    await this.db.stockMovement.create({ data: input });
    return p.stock;
  }

  async createSupplierOrder(data: { producerId: string; supplierId: string; materialId: string; qty: number; message: string }) {
    return this.db.supplierOrder.create({ data });
  }
}

function toProductStock(p: {
  id: string; slug: string; name: string; nameHi: string; category: string; stock: number; price: unknown; hsn: string;
  gstRate: unknown; unitsPerMachinePerWeek: number; palette: string; imageUrl: string | null;
}): ProductStock {
  return {
    id: p.id, slug: p.slug, name: p.name, nameHi: p.nameHi, category: p.category, stock: p.stock,
    price: Number(p.price), hsn: p.hsn, gstRate: Number(p.gstRate), unitsPerMachinePerWeek: p.unitsPerMachinePerWeek,
    palette: p.palette, imageUrl: p.imageUrl,
  };
}
