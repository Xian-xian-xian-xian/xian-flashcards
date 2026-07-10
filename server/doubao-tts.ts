export const doubaoTtsEndpoint = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
export const doubaoTtsResourceId = "seed-tts-2.0";
export const doubaoTtsVoice = "zh_female_yingyujiaoxue_uranus_bigtts";
export const doubaoTtsPrompt = "你是一个英式英语朗读专家，你正在给在线词典的单词配音，请保证每个发音准确无误，并且严格按照英式英语发音，发音沉稳稳重";

type CmuToken = { phoneme: string; vowel?: boolean; schwa?: boolean };

const ipaToCmuMap = new Map<string, CmuToken>([
  ["tʃ", { phoneme: "CH" }], ["dʒ", { phoneme: "JH" }], ["eɪ", { phoneme: "EY", vowel: true }], ["aɪ", { phoneme: "AY", vowel: true }],
  ["ɔɪ", { phoneme: "OY", vowel: true }], ["əʊ", { phoneme: "OW", vowel: true }], ["oʊ", { phoneme: "OW", vowel: true }], ["aʊ", { phoneme: "AW", vowel: true }],
  ["ɪə", { phoneme: "IH R", vowel: true }], ["eə", { phoneme: "EH R", vowel: true }], ["ɛə", { phoneme: "EH R", vowel: true }], ["ʊə", { phoneme: "UH R", vowel: true }],
  ["ɑː", { phoneme: "AA", vowel: true }], ["ɔː", { phoneme: "AO", vowel: true }], ["ɜː", { phoneme: "ER", vowel: true }], ["iː", { phoneme: "IY", vowel: true }],
  ["uː", { phoneme: "UW", vowel: true }], ["æ", { phoneme: "AE", vowel: true }], ["ɑ", { phoneme: "AA", vowel: true }], ["ɒ", { phoneme: "AA", vowel: true }],
  ["ɔ", { phoneme: "AO", vowel: true }], ["ʌ", { phoneme: "AH", vowel: true }], ["ə", { phoneme: "AH", vowel: true, schwa: true }], ["ɚ", { phoneme: "ER", vowel: true }],
  ["ɝ", { phoneme: "ER", vowel: true }], ["ɜ", { phoneme: "ER", vowel: true }], ["ɪ", { phoneme: "IH", vowel: true }], ["i", { phoneme: "IY", vowel: true }],
  ["ʊ", { phoneme: "UH", vowel: true }], ["u", { phoneme: "UW", vowel: true }], ["ɛ", { phoneme: "EH", vowel: true }], ["e", { phoneme: "EH", vowel: true }],
  ["p", { phoneme: "P" }], ["b", { phoneme: "B" }], ["t", { phoneme: "T" }], ["d", { phoneme: "D" }], ["k", { phoneme: "K" }], ["g", { phoneme: "G" }],
  ["f", { phoneme: "F" }], ["v", { phoneme: "V" }], ["θ", { phoneme: "TH" }], ["ð", { phoneme: "DH" }], ["s", { phoneme: "S" }], ["z", { phoneme: "Z" }],
  ["ʃ", { phoneme: "SH" }], ["ʒ", { phoneme: "ZH" }], ["h", { phoneme: "HH" }], ["m", { phoneme: "M" }], ["n", { phoneme: "N" }], ["ŋ", { phoneme: "NG" }],
  ["l", { phoneme: "L" }], ["r", { phoneme: "R" }], ["j", { phoneme: "Y" }], ["w", { phoneme: "W" }]
]);

function xmlEscape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function ipaToCmuPhonemes(ipa: string) {
  const normalized = ipa.normalize("NFC").replace(/[()]/g, "").replace(/[ˑ˞]/g, "").replace(/[ɡ]/g, "g");
  const tokens: string[] = [];
  let pendingStress: "1" | "2" | null = null;
  let hasVowel = false;
  for (let index = 0; index < normalized.length;) {
    const mark = normalized[index];
    if (mark === "ˈ" || mark === "'") { pendingStress = "1"; index += 1; continue; }
    if (mark === "ˌ" || mark === ",") { pendingStress = "2"; index += 1; continue; }
    if (mark === "." || mark === " " || mark === "ː" || mark === ":") { index += 1; continue; }
    const token = ipaToCmuMap.get(normalized.slice(index, index + 3)) ?? ipaToCmuMap.get(normalized.slice(index, index + 2)) ?? ipaToCmuMap.get(mark);
    if (!token) throw new Error(`暂不支持的音标符号：${mark}`);
    const length = ipaToCmuMap.has(normalized.slice(index, index + 3)) ? 3 : ipaToCmuMap.has(normalized.slice(index, index + 2)) ? 2 : 1;
    if (token.vowel) {
      const stress = pendingStress ?? (token.schwa ? "0" : hasVowel ? "0" : "1");
      tokens.push(...token.phoneme.split(" ").map((part) => `${part}${stress}`));
      hasVowel = true;
      pendingStress = null;
    } else tokens.push(token.phoneme);
    index += length;
  }
  if (!tokens.length) throw new Error("音标不能为空");
  return tokens.join(" ");
}

export function pronunciationSsml(word: string, ipa?: string) {
  const safeWord = xmlEscape(word);
  const cmuPhonemes = ipa ? ipaToCmuPhonemes(ipa) : null;
  if (!cmuPhonemes) return `<speak>${safeWord}</speak>`;
  return `<speak><phoneme alphabet="cmu" ph="${xmlEscape(cmuPhonemes)}">${safeWord}</phoneme></speak>`;
}

export function parseDoubaoAudioChunks(body: string) {
  const chunks: Buffer[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let message: { code?: number; message?: string; data?: string };
    try { message = JSON.parse(line); } catch { continue; }
    // 豆包单向流式接口会以非零 code、message 为 OK 的帧标记正常结束。
    if (message.code && message.code !== 0 && message.message !== "OK") throw new Error(message.message || `豆包语音合成失败：${message.code}`);
    if (message.data) chunks.push(Buffer.from(message.data, "base64"));
  }
  if (!chunks.length) throw new Error("豆包语音合成未返回音频");
  return Buffer.concat(chunks);
}
