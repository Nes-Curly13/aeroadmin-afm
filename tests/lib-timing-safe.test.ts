import { describe, expect, it } from "vitest";
import { timingSafeEqual } from "@/lib/timing-safe";

describe("timingSafeEqual", () => {
  it("true para strings idénticos", () => {
    expect(timingSafeEqual("abc123", "abc123")).toBe(true);
  });

  it("false para strings de distinta longitud", () => {
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("", "x")).toBe(false);
  });

  it("false para mismo largo con distinto contenido", () => {
    expect(timingSafeEqual("token-A", "token-B")).toBe(false);
    expect(timingSafeEqual("aaaaaaa", "aaaaaab")).toBe(false);
  });

  it("true para dos strings vacíos", () => {
    expect(timingSafeEqual("", "")).toBe(true);
  });
});
