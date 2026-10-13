import { describe, expect, it } from "vitest";
import { buildDoubaoRequestBody, buildDoubaoTtsPrompt, buildPlainTextSsml, buildWordPronunciation, detectBritishRhoticConflict, doubaoTtsPromptCandidates, expandDoubaoEnglishAbbreviations, isValidCmu, legacyDoubaoTtsPrompt, normalizeCustomSsml, normalizeDoubaoPrompt, normalizeIpa, normalizeWord, parseDoubaoAudioChunks } from "./doubao-tts.js";

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
  it("将句型中的 sb. 和 sth. 展开，避免豆包成功结束却返回空音频", () => {
    const word = "It is feasible for sb. to do sth.";
    const spoken = "It is feasible for somebody to do something";
    expect(buildPlainTextSsml(word)).toBe(`<speak>\n  ${spoken}\n</speak>`);
    const body = buildDoubaoRequestBody(word, `<speak>\n  ${word}\n</speak>`, "按音标朗读");
    expect(body.req_params).toMatchObject({ text: spoken, ssml: `<speak>\n  ${spoken}\n</speak>` });
    expect(JSON.parse(body.req_params.additions).context_texts).toEqual(["按音标朗读"]);
  });
  it("兼容无句点、大写和所有格缩写，保留普通单词及域名", () => {
    expect(expandDoubaoEnglishAbbreviations("SB. gives sth to sb.'s friend; (STH.)!")).toBe("somebody gives something to somebody's friend; (something)!");
    const text = "absb. sthx sb.com sth.org x-sb foo_sb";
    expect(expandDoubaoEnglishAbbreviations(text)).toBe(text);
  });
  it("展开已保存 XML 的文本时保留 SSML 标签、属性和实体", () => {
    const ssml = '<speak><phoneme alphabet="cmu" ph="S AH1 M">sb.</phoneme> &amp; <sub alias="sth.">sth.</sub></speak>';
    expect(buildDoubaoRequestBody("sb. & sth.", ssml, "提示词").req_params.ssml).toBe('<speak><phoneme alphabet="cmu" ph="S AH1 M">somebody</phoneme> &amp; <sub alias="sth.">something</sub></speak>');
    expect(buildDoubaoRequestBody("sth.", '<speak><sub alias="sb. > sth.">sth.</sub></speak>', "提示词").req_params.ssml).toBe('<speak><sub alias="sb. > sth.">something</sub></speak>');
    expect(() => buildDoubaoRequestBody("sb.", `<speak>${"a".repeat(131)} sb.</speak>`, "提示词")).toThrow("缩写展开后");
  });
  it("校验超级用户提交的完整 XML", () => {
    const ssml = `<speak>\n  <phoneme alphabet="cmu" ph="T AY1 T AH0 N">tighten</phoneme>\n</speak>`;
    expect(normalizeCustomSsml(`  ${ssml}  `)).toBe(ssml);
    expect(() => normalizeCustomSsml("<phoneme>tighten</phoneme>")).toThrow("<speak>");
    expect(() => normalizeCustomSsml("<!DOCTYPE speak><speak>tighten</speak>")).toThrow("不支持");
  });
  it("默认 SSML 仅放单词，音标只放入提示词", () => {
    const prompt = buildDoubaoTtsPrompt("/ˈtaɪtn/");
    const ssml = buildPlainTextSsml("tighten");
    const body = buildDoubaoRequestBody("tighten", ssml, prompt);
    expect(ssml).toBe("<speak>\n  tighten\n</speak>");
    expect(prompt).toBe("请使用标准、自然、非卷舌的英式英语词典发音，只朗读给定的单词一次。单独朗读词条时，不要读出词尾可选的连接音或侵入音 /r/，按照音标“/ˈtaɪtn/”朗读，语气中性，发音清晰，不要解释。");
    expect(JSON.parse(body.req_params.additions)).toMatchObject({ explicit_language: "en", context_texts: [prompt] });
  });
  it("新默认提示词查找不到时继续查找旧缓存，自定义提示词不会串用旧缓存", () => {
    expect(doubaoTtsPromptCandidates("/ˈtaɪtn/")).toEqual([buildDoubaoTtsPrompt("/ˈtaɪtn/"), legacyDoubaoTtsPrompt]);
    expect(doubaoTtsPromptCandidates("/ˈtaɪtn/", "  自定义提示词  ")).toEqual(["自定义提示词"]);
  });
  it("支持校验并发送超级用户自定义模型提示词", () => {
    const prompt = normalizeDoubaoPrompt("  请放慢语速并保持英式发音。  ");
    const body = buildDoubaoRequestBody("tighten", "<speak>tighten</speak>", prompt);
    expect(prompt).toBe("请放慢语速并保持英式发音。");
    expect(JSON.parse(body.req_params.additions)).toMatchObject({ context_texts: [prompt] });
    expect(() => normalizeDoubaoPrompt(" ")).toThrow("不能为空");
  });
  it("验证 CMU 格式并拼接豆包音频分块", () => { expect(isValidCmu("T AY1 T AH0 N")).toBe(true); expect(isValidCmu("bad cmu")).toBe(false); const data = Buffer.from("audio").toString("base64"); expect(parseDoubaoAudioChunks(`{\"code\":0,\"data\":\"${data}\"}\n{\"code\":20000000,\"message\":\"OK\"}`)).toEqual(Buffer.from("audio")); });
});
