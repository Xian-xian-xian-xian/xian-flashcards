import fs from "node:fs";
import path from "node:path";
import { dictionary as cmuDictionary } from "cmu-pronouncing-dictionary";

export const doubaoTtsEndpoint = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
export const doubaoTtsResourceId = "seed-tts-2.0";
export const doubaoTtsVoice = "zh_female_yingyujiaoxue_uranus_bigtts";
export const doubaoTtsPrompt = "请使用标准、自然、非卷舌的英式英语词典发音，只朗读给定的单词一次。单独朗读词条时，不要读出词尾可选的连接音或侵入音 /r/，语气中性，发音清晰，不要解释。";

export type PronunciationSource = "override" | "cmudict-unique" | "cmudict-ipa-match" | "cmudict-default" | "british-non-rhotic-fallback" | "plain-text-fallback";
export type PronunciationResult = { word: string; originalIpa: string | null; normalizedIpa: string | null; cmu: string | null; selectedCmu: string | null; ssml: string; source: PronunciationSource; confidence: number; rhoticConflict: boolean; finalSsmlMode: "cmu" | "plain-text" };

const overrides = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "server/pronunciation-overrides.json"), "utf8")) as Record<string, string>;
const validCmuToken = /^(AA|AE|AH|AO|AW|AY|B|CH|D|DH|EH|ER|EY|F|G|HH|IH|IY|JH|K|L|M|N|NG|OW|OY|P|R|S|SH|T|TH|UH|UW|V|W|Y|Z|ZH)([012])?$/;
const cmuToIpa: Record<string, string> = { AA: "ɑː", AE: "æ", AH: "ə", AO: "ɔː", AW: "aʊ", AY: "aɪ", B: "b", CH: "tʃ", D: "d", DH: "ð", EH: "e", ER: "ə", EY: "eɪ", F: "f", G: "g", HH: "h", IH: "ɪ", IY: "iː", JH: "dʒ", K: "k", L: "l", M: "m", N: "n", NG: "ŋ", OW: "əʊ", OY: "ɔɪ", P: "p", R: "r", S: "s", SH: "ʃ", T: "t", TH: "θ", UH: "ʊ", UW: "uː", V: "v", W: "w", Y: "j", Z: "z", ZH: "ʒ" };

export function normalizeWord(input: string) { return input.trim().toLowerCase().replace(/[’‘]/g, "'"); }
export function normalizeIpa(input: string) {
  return input.trim().replace(/^[\[/]+/, "").replace(/[\]/]+$/, "").replace(/[’']/g, "ˈ").replace(/,/g, "ˌ").replace(/:/g, "ː").replace(/ɡ/g, "g").replace(/[.\s]/g, "");
}
export function escapeXml(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;"); }
export function buildCmuSsml(word: string, cmu: string) { return `<speak>\n  <phoneme alphabet="cmu" ph="${escapeXml(cmu)}">${escapeXml(word)}</phoneme>\n</speak>`; }
export function buildPlainTextSsml(word: string) { return `<speak>\n  ${escapeXml(word)}\n</speak>`; }
export function isValidCmu(cmu: string) { return cmu.trim().split(/\s+/).every((token) => validCmuToken.test(token)); }

function cmuCandidates(word: string) {
  const normalized = normalizeWord(word);
  return Object.entries(cmuDictionary).filter(([key]) => key === normalized || new RegExp(`^${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\(\\d+\\)$`).test(key)).map(([, value]) => value.replace(/\s+#.*$/, "")).filter(isValidCmu);
}
function cmuApproxIpa(cmu: string) {
  const tokens = cmu.split(/\s+/); let output = "";
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]; const base = token.replace(/[012]$/, ""); const stress = token.match(/[12]$/)?.[0];
    if (stress) output += stress === "1" ? "ˈ" : "ˌ";
    if (base === "R" && index > 0 && /[AEIOU]/.test(tokens[index - 1]) && index + 1 < tokens.length && !/^[AEIOU]/.test(tokens[index + 1])) continue;
    output += cmuToIpa[base] ?? "";
  }
  return output;
}
function weightedDistance(left: string, right: string) {
  const a = left.replace(/[()]/g, ""); const b = right.replace(/[()]/g, ""); const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) { let previous = row[0]; row[0] = i; for (let j = 1; j <= b.length; j += 1) { const old = row[j]; const cost = a[i - 1] === b[j - 1] ? 0 : ("ˈˌ".includes(a[i - 1]) || "ˈˌ".includes(b[j - 1]) ? 2 : "aeiouəɪʊɔɑæɜ".includes(a[i - 1]) || "aeiouəɪʊɔɑæɜ".includes(b[j - 1]) ? 1.5 : 1); row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + cost); previous = old; } }
  return row[b.length];
}
function chooseCandidate(candidates: string[], ipa: string) {
  const scored = candidates.map((cmu) => ({ cmu, score: weightedDistance(cmuApproxIpa(cmu), ipa) })).sort((a, b) => a.score - b.score);
  const best = scored[0]; const next = scored[1]; const confidence = Math.max(0.5, Math.min(1, 1 - best.score / Math.max(ipa.length, 1) + (next ? Math.min(0.15, (next.score - best.score) / 10) : 0)));
  return { cmu: best.cmu, confidence };
}
export type RhoticConflictResult = { hasConflict: boolean; ipaHasPronouncedR: boolean; cmuHasRhoticPhone: boolean };
export function detectBritishRhoticConflict(normalizedIpa: string | null | undefined, cmu: string | null | undefined): RhoticConflictResult {
  if (!normalizedIpa || !cmu) return { hasConflict: false, ipaHasPronouncedR: false, cmuHasRhoticPhone: false };
  const ipaWithoutOptionalR = normalizedIpa.replace(/\(\s*[rɹ]\s*\)/g, "");
  const ipaHasPronouncedR = /[rɹ]/.test(ipaWithoutOptionalR);
  const cmuHasRhoticPhone = cmu.trim().toUpperCase().split(/\s+/).some((token) => token === "R" || /^ER[012]?$/.test(token));
  return { hasConflict: cmuHasRhoticPhone && !ipaHasPronouncedR, ipaHasPronouncedR, cmuHasRhoticPhone };
}
export function buildWordPronunciation(wordInput: string, ipaInput?: string | null): PronunciationResult {
  const word = normalizeWord(wordInput); const originalIpa = ipaInput?.trim() || null; const normalizedIpa = originalIpa ? normalizeIpa(originalIpa) : null;
  try {
    if (!word || !/^[a-z]+(?:['-][a-z]+)*$/.test(word)) throw new Error("invalid word");
    const override = normalizedIpa ? overrides[`${word}|${normalizedIpa}`] : undefined;
    let selectedCmu: string | null = null; let source: PronunciationSource = "plain-text-fallback"; let confidence = 0;
    if (override && isValidCmu(override)) { selectedCmu = override; source = "override"; confidence = 1; }
    const candidates = cmuCandidates(word);
    if (!selectedCmu && candidates.length === 1) { selectedCmu = candidates[0]; source = "cmudict-unique"; confidence = 1; }
    if (!selectedCmu && candidates.length > 1 && normalizedIpa) { const chosen = chooseCandidate(candidates, normalizedIpa); selectedCmu = chosen.cmu; source = "cmudict-ipa-match"; confidence = chosen.confidence; }
    if (!selectedCmu && candidates.length > 1) { selectedCmu = candidates[0]; source = "cmudict-default"; confidence = 0.55; }
    const rhotic = detectBritishRhoticConflict(normalizedIpa, selectedCmu);
    if (rhotic.hasConflict) return { word, originalIpa, normalizedIpa, cmu: null, selectedCmu, ssml: buildPlainTextSsml(word), source: "british-non-rhotic-fallback", confidence, rhoticConflict: true, finalSsmlMode: "plain-text" };
    if (selectedCmu) return { word, originalIpa, normalizedIpa, cmu: selectedCmu, selectedCmu, ssml: buildCmuSsml(word, selectedCmu), source, confidence, rhoticConflict: false, finalSsmlMode: "cmu" };
  } catch { /* fall through */ }
  return { word, originalIpa, normalizedIpa, cmu: null, selectedCmu: null, ssml: buildPlainTextSsml(wordInput), source: "plain-text-fallback", confidence: 0, rhoticConflict: false, finalSsmlMode: "plain-text" };
}
export function pronunciationSsml(word: string, ipa?: string) { return buildWordPronunciation(word, ipa).ssml; }
export function parseDoubaoAudioChunks(body: string) { const chunks: Buffer[] = []; for (const line of body.split(/\r?\n/)) { if (!line.trim()) continue; let message: { code?: number; message?: string; data?: string }; try { message = JSON.parse(line); } catch { continue; } if (message.code && message.code !== 0 && message.message !== "OK") throw new Error(message.message || `豆包语音合成失败：${message.code}`); if (message.data) chunks.push(Buffer.from(message.data, "base64")); } if (!chunks.length) throw new Error("豆包语音合成未返回音频"); return Buffer.concat(chunks); }
