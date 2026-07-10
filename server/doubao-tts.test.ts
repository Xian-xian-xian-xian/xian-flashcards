import { describe, expect, it } from "vitest";
import { buildPlainTextSsml, buildWordPronunciation, detectBritishRhoticConflict, isValidCmu, normalizeIpa, normalizeWord, parseDoubaoAudioChunks } from "./doubao-tts.js";

describe("单词发音构建", () => {
  it("规范化 IPA 与单词格式", () => { expect(normalizeIpa(" [pə'fɔ:mə(r)] ")).toBe("pəˈfɔːmə(r)"); expect(normalizeWord(" Performer ")).toBe("performer"); });
  it("优先使用精确 IPA 覆盖表", () => { expect(buildWordPronunciation("comply", "/kəm'plaɪ/")).toMatchObject({ cmu: "K AH0 M P L AY1", source: "override" }); });
  it("使用 CMUdict 的唯一候选和 IPA 匹配多读音", () => { expect(buildWordPronunciation("tighten", "/'taɪtn/").cmu).toBe("T AY1 T AH0 N"); expect(buildWordPronunciation("record", "/rɪ'kɔːd/").cmu).toBe("R IH0 K AO1 R D"); });
  it("对词典外或非法输入降级为纯文本 SSML", () => { expect(buildWordPronunciation("madeupword", "/x/")).toMatchObject({ source: "plain-text-fallback", cmu: null }); expect(buildWordPronunciation("rock & roll").ssml).toBe("<speak>\n  rock &amp; roll\n</speak>"); });
  it("在英式 IPA 没有实际 r 而 CMU 含卷舌音素时降级", () => {
    expect(detectBritishRhoticConflict("pəˈfɔːmə(r)", "P ER0 F AO1 R M ER0")).toMatchObject({ hasConflict: true, ipaHasPronouncedR: false, cmuHasRhoticPhone: true });
    for (const [word, ipa] of [["performer", "/pəˈfɔːmə(r)/"], ["teacher", "/ˈtiːtʃə(r)/"], ["worker", "/ˈwɜːkə(r)/"], ["work", "/wɜːk/"], ["word", "/wɜːd/"], ["car", "/kɑː(r)/"], ["farmer", "/ˈfɑːmə(r)/"], ["important", "/ɪmˈpɔːtnt/"]] as const) expect(buildWordPronunciation(word, ipa)).toMatchObject({ source: "british-non-rhotic-fallback", finalSsmlMode: "plain-text", rhoticConflict: true });
  });
  it("保留 IPA 中真正发音的 r", () => {
    for (const [word, ipa] of [["red", "/red/"], ["carry", "/ˈkæri/"], ["around", "/əˈraʊnd/"], ["correct", "/kəˈrekt/"], ["Britain", "/ˈbrɪtn/"]] as const) expect(buildWordPronunciation(word, ipa).source).not.toBe("british-non-rhotic-fallback");
    expect(detectBritishRhoticConflict("əˈraʊnd", "AH0 R AW1 N D").hasConflict).toBe(false);
  });
  it("纯文本 SSML 保持 XML 转义", () => { expect(buildPlainTextSsml("rock & roll")).toBe("<speak>\n  rock &amp; roll\n</speak>"); });
  it("验证 CMU 格式并拼接豆包音频分块", () => { expect(isValidCmu("T AY1 T AH0 N")).toBe(true); expect(isValidCmu("bad cmu")).toBe(false); const data = Buffer.from("audio").toString("base64"); expect(parseDoubaoAudioChunks(`{\"code\":0,\"data\":\"${data}\"}\n{\"code\":20000000,\"message\":\"OK\"}`)).toEqual(Buffer.from("audio")); });
});
