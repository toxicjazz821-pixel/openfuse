import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { Config } from "./config.ts";
import { AppError } from "./errors.ts";

const IMAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function assertImageId(id: string): void {
  if (!IMAGE_ID.test(id)) throw new AppError("Image not found", 404);
}

function imagePath(config: Config, owner: string, id: string): string {
  assertImageId(id);
  const directory = resolve(config.dataDir, "images", owner);
  const path = resolve(directory, `${id}.png`);
  if (!path.startsWith(`${directory}${sep}`)) throw new AppError("Image not found", 404);
  return path;
}

/** Store generated PNG bytes under the owner's data dir; returns the image ID. */
export async function saveGeneratedImage(
  config: Config,
  owner: string,
  bytes: Uint8Array,
): Promise<string> {
  if (bytes.length > MAX_IMAGE_BYTES) throw new AppError("Generated image is too large", 413);
  const id = randomUUID();
  const directory = resolve(config.dataDir, "images", owner);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, `${id}.png`), bytes, { mode: 0o600, flag: "wx" });
  return id;
}

export async function readGeneratedImage(
  config: Config,
  owner: string,
  id: string,
): Promise<Uint8Array> {
  try {
    return await readFile(imagePath(config, owner, id));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Image not found", 404);
  }
}
