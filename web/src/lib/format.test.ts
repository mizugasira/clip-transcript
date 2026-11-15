import { describe, expect, it } from "vitest";
import { formatSrtTime, formatTimestamp, formatTwitchTime, toPlainText, toSrt, toTimestampedText } from "./format";

const segs = [
  { start: 0.4, end: 2.5, text: "こんにちは" },
  { start: 12.34, end: 15.0, text: "今日はよろしく" },
];

describe("format", () => {
  it("formatTimestamp", () => {
    expect(formatTimestamp(0)).toBe("00:00");
    expect(formatTimestamp(12.9)).toBe("00:12");
    expect(formatTimestamp(65)).toBe("01:05");
    expect(formatTimestamp(3725)).toBe("1:02:05");
  });

  it("formatSrtTime", () => {
    expect(formatSrtTime(0)).toBe("00:00:00,000");
    expect(formatSrtTime(12.345)).toBe("00:00:12,345");
    expect(formatSrtTime(3725.5)).toBe("01:02:05,500");
  });

  it("formatTwitchTime", () => {
    expect(formatTwitchTime(3725.9)).toBe("1h2m5s");
    expect(formatTwitchTime(0)).toBe("0h0m0s");
  });

  it("text exports", () => {
    expect(toPlainText(segs)).toBe("こんにちは\n今日はよろしく");
    expect(toTimestampedText(segs)).toBe("00:00 こんにちは\n00:12 今日はよろしく");
  });

  it("srt", () => {
    expect(toSrt(segs)).toBe(
      "1\n00:00:00,400 --> 00:00:02,500\nこんにちは\n\n2\n00:00:12,340 --> 00:00:15,000\n今日はよろしく\n",
    );
  });

  it("srt fixes zero-length segment", () => {
    expect(toSrt([{ start: 3, end: 3, text: "x" }])).toContain("00:00:03,000 --> 00:00:03,500");
  });
});
