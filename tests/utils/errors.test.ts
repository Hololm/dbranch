import { describe, it, expect } from "vitest";
import { DbranchError } from "../../src/utils/errors.js";

describe("DbranchError", () => {
  it("has the correct name", () => {
    const err = new DbranchError("something went wrong");
    expect(err.name).toBe("DbranchError");
  });

  it("stores userMessage", () => {
    const err = new DbranchError("Please run dbranch init first.");
    expect(err.userMessage).toBe("Please run dbranch init first.");
    expect(err.message).toBe("Please run dbranch init first.");
  });

  it("supports cause option", () => {
    const cause = new Error("original");
    const err = new DbranchError("wrapper message", { cause });
    expect(err.cause).toBe(cause);
  });

  it("is an instance of Error", () => {
    const err = new DbranchError("test");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DbranchError);
  });
});
