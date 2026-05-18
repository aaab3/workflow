/**
 * Browser module tests.
 *
 * Uses vi.fn() to mock fetch — we don't need a real server,
 * we just need to verify HTML parsing, security policy enforcement,
 * and selector behavior.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { browserModule } from "../src/modules/io/browser.js";
import { createDefaultSecurityConfig } from "../src/security.js";
import type { ExecutionContext } from "../src/types.js";

function makeContext(useSecurity = false): ExecutionContext {
  return {
    workflowId: "test",
    executionId: "exec",
    status: "running",
    startTime: Date.now(),
    nodeStates: new Map(),
    variables: {},
    logs: [],
    errors: [],
    metrics: { totalNodes: 0, completedNodes: 0, failedNodes: 0, skippedNodes: 0 },
    security: useSecurity ? createDefaultSecurityConfig() : undefined,
  };
}

function mockHtmlResponse(html: string, status = 200, contentType = "text/html; charset=utf-8") {
  const encoded = new TextEncoder().encode(html);
  return {
    status,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoded);
        controller.close();
      },
    }),
    headers: new Headers({ "content-type": contentType }),
  };
}

const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("browserModule — HTML parsing", () => {
  it("extracts title from real HTML", async () => {
    const html = `<!DOCTYPE html><html><head><title>Hello World</title></head><body><p>Content</p></body></html>`;
    globalThis.fetch = vi.fn().mockResolvedValue(mockHtmlResponse(html));

    const result = await browserModule.execute(
      { url: "https://example.com" },
      {},
      makeContext()
    );

    expect(result.title).toBe("Hello World");
    expect(result.status).toBe(200);
  });

  it("does NOT misparse <title> appearing inside a script string", async () => {
    // The OLD regex implementation would match this as the title
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Real Title</title>
          <script>const fakeTag = "<title>Wrong Title</title>";</script>
        </head>
        <body><p>x</p></body>
      </html>
    `;
    globalThis.fetch = vi.fn().mockResolvedValue(mockHtmlResponse(html));

    const result = await browserModule.execute(
      { url: "https://example.com" },
      {},
      makeContext()
    );

    expect(result.title).toBe("Real Title");
  });

  it("readable mode strips scripts/styles/nav/footer", async () => {
    const html = `
      <html>
        <head>
          <title>Test</title>
          <style>.x { color: red; }</style>
        </head>
        <body>
          <nav>NavLink1 NavLink2</nav>
          <header>HeaderText</header>
          <main>
            <p>Main content paragraph.</p>
          </main>
          <footer>FooterCopyright</footer>
          <script>alert('xss')</script>
        </body>
      </html>
    `;
    globalThis.fetch = vi.fn().mockResolvedValue(mockHtmlResponse(html));

    const result = await browserModule.execute(
      { url: "https://example.com" },
      { mode: "readable" },
      makeContext()
    );

    expect(result.content).toContain("Main content paragraph");
    expect(result.content).not.toContain("NavLink");
    expect(result.content).not.toContain("HeaderText");
    expect(result.content).not.toContain("FooterCopyright");
    expect(result.content).not.toContain("alert");
    expect(result.content).not.toContain("color: red");
  });

  it("selector mode supports complex CSS selectors", async () => {
    const html = `
      <html><body>
        <article class="post" data-id="1">
          <h2>First Post</h2>
          <p class="excerpt">First excerpt</p>
        </article>
        <article class="post" data-id="2">
          <h2>Second Post</h2>
          <p class="excerpt">Second excerpt</p>
        </article>
      </body></html>
    `;
    globalThis.fetch = vi.fn().mockResolvedValue(mockHtmlResponse(html));

    const result = await browserModule.execute(
      { url: "https://example.com" },
      { mode: "selector", selector: "article.post p.excerpt" },
      makeContext()
    );

    expect(result.content).toContain("First excerpt");
    expect(result.content).toContain("Second excerpt");
    expect(result.content).not.toContain("First Post");
  });

  it("selector mode rejects invalid selectors", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockHtmlResponse("<html></html>"));

    await expect(
      browserModule.execute(
        { url: "https://example.com" },
        { mode: "selector", selector: "[[invalid" },
        makeContext()
      )
    ).rejects.toThrow(/invalid|selector/i);
  });

  it("fetch mode returns raw HTML", async () => {
    const html = `<html><body><p>raw</p></body></html>`;
    globalThis.fetch = vi.fn().mockResolvedValue(mockHtmlResponse(html));

    const result = await browserModule.execute(
      { url: "https://example.com" },
      { mode: "fetch" },
      makeContext()
    );

    expect(result.content).toContain("<p>raw</p>");
  });
});

describe("browserModule — security", () => {
  it("blocks private IP when network policy enforces it", async () => {
    // Use a real fetch — the security check runs before fetch.
    // The DNS lookup of 127.0.0.1 will be flagged as private.
    await expect(
      browserModule.execute(
        { url: "http://127.0.0.1/secret" },
        {},
        makeContext(true) // useSecurity=true
      )
    ).rejects.toThrow(/private|blocked/i);
  });

  it("blocks file:// protocol", async () => {
    await expect(
      browserModule.execute(
        { url: "file:///etc/passwd" },
        {},
        makeContext(true)
      )
    ).rejects.toThrow(/protocol/i);
  });

  it("requires URL", async () => {
    await expect(
      browserModule.execute({}, {}, makeContext())
    ).rejects.toThrow(/url|required/i);
  });

  it("selector mode requires selector field", async () => {
    await expect(
      browserModule.execute(
        { url: "https://example.com" },
        { mode: "selector" },
        makeContext()
      )
    ).rejects.toThrow(/selector/i);
  });
});

describe("browserModule — response size", () => {
  it("truncates response body at maxResponseSize", async () => {
    // Generate ~50KB of HTML
    const longText = "x".repeat(50000);
    const html = `<html><body><p>${longText}</p></body></html>`;
    globalThis.fetch = vi.fn().mockResolvedValue(mockHtmlResponse(html));

    const result = await browserModule.execute(
      { url: "https://example.com" },
      { mode: "fetch", maxResponseSize: 5000 },
      makeContext()
    );

    // The body should have been capped well below the original size
    expect((result.content as string).length).toBeLessThanOrEqual(5000);
  });
});
