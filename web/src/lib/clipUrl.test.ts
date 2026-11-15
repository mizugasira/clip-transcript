import { describe, expect, it } from "vitest";
import { isValidClipId, parseClipUrl } from "./clipUrl";

describe("parseClipUrl", () => {
  const slug = "AwkwardHelplessSalamanderSwiftRage-AbC_dEf12";
  it.each([
    `https://clips.twitch.tv/${slug}`,
    `clips.twitch.tv/${slug}`,
    `https://clips.twitch.tv/${slug}?filter=clips&range=7d`,
    `https://clips.twitch.tv/embed?clip=${slug}&parent=example.com`,
    `https://www.twitch.tv/somestreamer/clip/${slug}`,
    `https://twitch.tv/somestreamer/clip/${slug}?filter=clips`,
    `https://m.twitch.tv/somestreamer/clip/${slug}`,
    `https://m.twitch.tv/clip/${slug}`,
    `  https://www.twitch.tv/somestreamer/clip/${slug}/  `,
  ])("accepts %s", (url) => {
    expect(parseClipUrl(url)).toBe(slug);
  });

  it.each([
    "",
    "not a url",
    "https://www.twitch.tv/somestreamer",
    "https://www.twitch.tv/videos/123456789",
    "https://www.youtube.com/watch?v=abc",
    "https://evil.example.com/somestreamer/clip/Foo",
    "https://clips.twitch.tv.evil.com/Foo",
    "https://clips.twitch.tv/",
    "https://clips.twitch.tv/embed",
    "javascript:alert(1)",
    "https://clips.twitch.tv/<script>",
  ])("rejects %s", (url) => {
    expect(parseClipUrl(url)).toBeNull();
  });

  it("rejects non-string", () => {
    expect(parseClipUrl(undefined)).toBeNull();
    expect(parseClipUrl(123)).toBeNull();
  });
});

describe("isValidClipId", () => {
  it("validates", () => {
    expect(isValidClipId("Abc-def_123")).toBe(true);
    expect(isValidClipId("../etc")).toBe(false);
    expect(isValidClipId("a")).toBe(false);
  });
});
