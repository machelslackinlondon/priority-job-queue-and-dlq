import { JobValidationError } from "../../src/domain/errors.js";
import { validateNewJob } from "../../src/domain/validation.js";

describe("validateNewJob", () => {
  test("accepts a registered JSON-shaped job request", () => {
    expect(validateNewJob({
      type: "send-email",
      priority: "high",
      payload: { to: "a@b.test" }
    }, 1024)).toEqual({
      type: "send-email",
      priority: "high",
      payload: { to: "a@b.test" }
    });
  });

  test("rejects a priority outside the bounded priority set", () => {
    expect(() => validateNewJob({
      type: "send-email",
      priority: "urgent",
      payload: {}
    }, 1024)).toThrow(JobValidationError);
  });

  test("measures payload limits in UTF-8 bytes", () => {
    expect(() => validateNewJob({
      type: "index-content",
      priority: "normal",
      payload: { text: "é".repeat(10) }
    }, 20)).toThrow(/payload/i);
  });

  test("rejects unsupported top-level fields", () => {
    expect(() => validateNewJob({
      type: "send-email",
      priority: "normal",
      payload: {},
      execute: "rm -rf"
    }, 1024)).toThrow(/field/i);
  });
});
