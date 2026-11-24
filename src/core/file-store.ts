import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** Where uploaded files (bill photos) are kept. Local disk now; swap for S3/GCS without touching services. */
export interface FileStore {
  /** Saves bytes under a random name and returns the stored path (relative to the store). */
  save(folder: string, bytes: Buffer, extension: string): Promise<string>;
  /** Reads a stored file back, or null if it is gone. */
  read(stored: string): Promise<Buffer | null>;
}

export class LocalFileStore implements FileStore {
  constructor(private readonly baseDir: string) {}

  async save(folder: string, bytes: Buffer, extension: string): Promise<string> {
    const safeFolder = folder.replace(/[^a-zA-Z0-9_-]/g, "");
    const name = `${Date.now().toString(36)}-${randomBytes(6).toString("hex")}.${extension.replace(/[^a-z0-9]/g, "")}`;
    const dir = path.join(this.baseDir, safeFolder);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, name), bytes);
    return `${safeFolder}/${name}`;
  }

  async read(stored: string): Promise<Buffer | null> {
    const full = path.resolve(this.baseDir, stored);
    if (!full.startsWith(path.resolve(this.baseDir) + path.sep)) return null; // no ../ escapes
    try {
      return await readFile(full);
    } catch {
      return null;
    }
  }
}
