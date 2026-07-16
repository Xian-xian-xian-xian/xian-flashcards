import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cardImagePath, cardImageTypeFromFilename, detectCardImageType, maxCardImageBytes, storeCardImage } from "./card-images";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.promises.rm(directory, { recursive: true, force: true })));
});

describe("card image storage", () => {
  it("detects supported formats from their file signatures", () => {
    expect(detectCardImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.extension).toBe("png");
    expect(detectCardImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.extension).toBe("jpg");
    expect(detectCardImageType(Buffer.from("RIFF0000WEBP", "ascii"))?.extension).toBe("webp");
    expect(detectCardImageType(Buffer.from("GIF89a", "ascii"))?.extension).toBe("gif");
    expect(detectCardImageType(Buffer.from("<svg></svg>"))).toBeNull();
  });

  it("accepts only generated filenames inside the owning user directory", () => {
    const filename = "123e4567-e89b-42d3-a456-426614174000.png";
    expect(cardImagePath("/tmp/card-images", 7, filename)).toBe(path.join("/tmp/card-images", "7", filename));
    expect(cardImagePath("/tmp/card-images", 7, "../secret.png")).toBeNull();
    expect(cardImagePath("/tmp/card-images", 0, filename)).toBeNull();
    expect(cardImageTypeFromFilename(filename)?.mimeType).toBe("image/png");
    expect(cardImageTypeFromFilename("not-an-image.svg")).toBeNull();
  });

  it("stores a validated image with a generated name", async () => {
    const rootDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "flashcard-images-"));
    temporaryDirectories.push(rootDir);
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    const stored = await storeCardImage(rootDir, 12, buffer);
    expect(stored.extension).toBe("jpg");
    expect(await fs.promises.readFile(path.join(rootDir, "12", stored.filename))).toEqual(buffer);
  });

  it("rejects unsupported and oversized content", async () => {
    const rootDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "flashcard-images-"));
    temporaryDirectories.push(rootDir);
    await expect(storeCardImage(rootDir, 1, Buffer.from("not an image"))).rejects.toThrow("仅支持");
    const oversized = Buffer.alloc(maxCardImageBytes + 1);
    oversized.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await expect(storeCardImage(rootDir, 1, oversized)).rejects.toThrow("10 MB");
  });
});
