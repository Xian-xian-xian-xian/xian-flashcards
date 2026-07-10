import { describe, expect, it } from "vitest";
import { ipaToCmuPhonemes, parseDoubaoAudioChunks, pronunciationSsml } from "./doubao-tts.js";

describe("豆包单词发音", () => {
  it("将英式 IPA 转为带重音的 CMU 音标并包裹 SSML", () => {
    expect(ipaToCmuPhonemes("kəmˈplaɪ")).toBe("K AH0 M P L AY1");
    expect(ipaToCmuPhonemes("'kəmplaɪ")).toBe("K AH1 M P L AY0");
    expect(pronunciationSsml("comply", "kəmˈplaɪ")).toBe('<speak><phoneme alphabet="cmu" ph="K AH0 M P L AY1">comply</phoneme></speak>');
  });

  it("保留英式非卷舌发音，不从美式拼写补入 r", () => {
    expect(ipaToCmuPhonemes("pəˈfɔːmə")).toBe("P AH0 F AO1 M AH0");
    expect(pronunciationSsml("performer", "pəˈfɔːmə")).toBe('<speak><phoneme alphabet="cmu" ph="P AH0 F AO1 M AH0">performer</phoneme></speak>');
  });

  it("无 IPA 时直接以 SSML 朗读并转义单词", () => {
    expect(pronunciationSsml("rock & roll")).toBe("<speak>rock &amp; roll</speak>");
  });

  it("拼接豆包分块 Base64 音频并传递上游失败", () => {
    const first = Buffer.from("first").toString("base64");
    const second = Buffer.from("second").toString("base64");
    expect(parseDoubaoAudioChunks(`{"code":0,"data":"${first}"}\n{"code":0,"data":"${second}"}\n{"code":20000000,"message":"OK"}`)).toEqual(Buffer.from("firstsecond"));
    expect(() => parseDoubaoAudioChunks('{"code":3001,"message":"invalid request"}')).toThrow("invalid request");
  });
});
