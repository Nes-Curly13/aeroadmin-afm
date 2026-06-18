import { describe, expect, it } from "vitest";

import { parseOptionalIntParam } from "@/lib/request";

describe("request parsing", () => {
  it("accepts missing or empty values", () => {
    expect(parseOptionalIntParam(null, "parcel_id")).toEqual({ value: undefined });
    expect(parseOptionalIntParam("", "parcel_id")).toEqual({ value: undefined });
  });

  it("parses positive integers", () => {
    expect(parseOptionalIntParam("42", "parcel_id")).toEqual({ value: 42 });
  });

  it("rejects invalid numeric filters", () => {
    expect(parseOptionalIntParam("12a", "parcel_id")).toEqual({
      error: "parcel_id must be a positive integer."
    });
    expect(parseOptionalIntParam("-1", "parcel_id")).toEqual({
      error: "parcel_id must be a positive integer."
    });
  });
});
