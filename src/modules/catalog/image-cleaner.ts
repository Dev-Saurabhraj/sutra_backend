import sharp from "sharp";

export type CleanImage = { bytes: Buffer; extension: string; mediaType: "image/jpeg" };

/** Strategy: turn a phone photo into a catalog photo. Swap for a background-removal service later. */
export interface ImageCleaner {
  clean(bytes: Buffer): Promise<CleanImage>;
}

export const CATALOG_SIZE = 1200;

/**
 * Honest clean-up only: straighten (EXIF), square crop on the interesting part, even out exposure, small size.
 * No retouching that would show the buyer something different from what arrives.
 */
export class SharpImageCleaner implements ImageCleaner {
  async clean(bytes: Buffer): Promise<CleanImage> {
    const out = await sharp(bytes, { failOn: "error" })
      .rotate()
      .resize(CATALOG_SIZE, CATALOG_SIZE, { fit: "cover", position: sharp.strategy.attention })
      .normalise({ lower: 1, upper: 99 })
      .modulate({ brightness: 1.03, saturation: 1.06 })
      .sharpen({ sigma: 0.6 })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return { bytes: out, extension: "jpg", mediaType: "image/jpeg" };
  }
}
