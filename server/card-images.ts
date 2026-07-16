import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const maxCardImageBytes = 10 * 1024 * 1024;

export type CardImageType = {
  extension: "png" | "jpg" | "webp" | "gif";
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
};

const cardImageFilenamePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp|gif)$/;

function startsWith(buffer: Buffer, bytes: number[]) {
  return bytes.every((byte, index) => buffer[index] === byte);
}

export function detectCardImageType(buffer: Buffer): CardImageType | null {
  if (buffer.length >= 8 && startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { extension: "png", mimeType: "image/png" };
  }
  if (buffer.length >= 3 && startsWith(buffer, [0xff, 0xd8, 0xff])) {
    return { extension: "jpg", mimeType: "image/jpeg" };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return { extension: "webp", mimeType: "image/webp" };
  }
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) {
    return { extension: "gif", mimeType: "image/gif" };
  }
  return null;
}

export function cardImageTypeFromFilename(filename: string): CardImageType | null {
  const extension = cardImageFilenamePattern.exec(filename)?.[1];
  if (extension === "png") return { extension, mimeType: "image/png" };
  if (extension === "jpg") return { extension, mimeType: "image/jpeg" };
  if (extension === "webp") return { extension, mimeType: "image/webp" };
  if (extension === "gif") return { extension, mimeType: "image/gif" };
  return null;
}

export function cardImagePath(rootDir: string, userId: number, filename: string) {
  if (!Number.isSafeInteger(userId) || userId <= 0 || !cardImageFilenamePattern.test(filename)) return null;
  return path.join(rootDir, String(userId), filename);
}

export async function storeCardImage(rootDir: string, userId: number, buffer: Buffer) {
  if (buffer.length > maxCardImageBytes) throw new Error("图片不能超过 10 MB");
  const type = detectCardImageType(buffer);
  if (!type) throw new Error("仅支持 PNG、JPEG、WebP 或 GIF 图片");
  const userDir = path.join(rootDir, String(userId));
  const filename = `${crypto.randomUUID()}.${type.extension}`;
  const finalPath = cardImagePath(rootDir, userId, filename);
  if (!finalPath) throw new Error("无法生成图片文件名");
  const temporaryPath = path.join(userDir, `.${filename}.tmp`);
  await fs.promises.mkdir(userDir, { recursive: true });
  try {
    await fs.promises.writeFile(temporaryPath, buffer, { flag: "wx" });
    await fs.promises.rename(temporaryPath, finalPath);
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return { filename, ...type };
}
