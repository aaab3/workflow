import { describe, it, expect } from "vitest";
import { textInputModule } from "../src/modules/io/text-input.js";

describe("textInputModule", () => {
  it("should output config content", async () => {
    const result = await textInputModule.execute(
      {},
      { content: "Hello, workflow!" },
      {} as never
    );
    expect(result.text).toBe("Hello, workflow!");
    expect(result.length).toBe(16);
  });

  it("should prefer input port over config", async () => {
    const result = await textInputModule.execute(
      { content: "from input" },
      { content: "from config" },
      {} as never
    );
    expect(result.text).toBe("from input");
  });

  it("should default to empty string", async () => {
    const result = await textInputModule.execute({}, {}, {} as never);
    expect(result.text).toBe("");
    expect(result.length).toBe(0);
  });
});
