import { describe, expect, it } from "vitest";
import { buildWordPronunciation, isValidCmu, normalizeIpa, normalizeWord, parseDoubaoAudioChunks } from "./doubao-tts.js";

describe("单词发音构建", () => {
  it("规范化 IPA 与单词格式", () => { expect(normalizeIpa(" [pə'fɔ:mə(r)] ")).toBe("pəˈfɔːmə(r)"); expect(normalizeWord(" Performer ")).toBe("performer"); });
  it("优先使用精确 IPA 覆盖表", () => { expect(buildWordPronunciation("performer", "/pə'fɔ:mə(r)/")).toMatchObject({ cmu: "P ER0 F AO1 R M ER0", source: "override" }); });
  it("使用 CMUdict 的唯一候选和 IPA 匹配多读音", () => { expect(buildWordPronunciation("tighten", "/'taɪtn/").cmu).toBe("T AY1 T AH0 N"); expect(buildWordPronunciation("record", "/rɪ'kɔːd/").cmu).toBe("R IH0 K AO1 R D"); });
  it("对词典外或非法输入降级为纯文本 SSML", () => { expect(buildWordPronunciation("madeupword", "/x/")).toMatchObject({ source: "plain-text-fallback", cmu: null }); expect(buildWordPronunciation("rock & roll").ssml).toBe("<speak>rock &amp; roll</speak>"); });
  it("验证 CMU 格式并拼接豆包音频分块", () => { expect(isValidCmu("T AY1 T AH0 N")).toBe(true); expect(isValidCmu("bad cmu")).toBe(false); const data = Buffer.from("audio").toString("base64"); expect(parseDoubaoAudioChunks(`{\"code\":0,\"data\":\"${data}\"}\n{\"code\":20000000,\"message\":\"OK\"}`)).toEqual(Buffer.from("audio")); });
});
