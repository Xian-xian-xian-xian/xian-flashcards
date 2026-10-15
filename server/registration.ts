import { createHash, timingSafeEqual } from "node:crypto";

export function registrationEnabled(configuredCode: string | undefined) {
  return Boolean(configuredCode?.trim());
}

export function validRegistrationInvite(submittedCode: unknown, configuredCode: string | undefined) {
  if (!registrationEnabled(configuredCode) || typeof submittedCode !== "string") return false;
  const submitted = submittedCode.trim();
  if (!submitted || submitted.length > 256) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(submitted), digest(configuredCode!.trim()));
}
