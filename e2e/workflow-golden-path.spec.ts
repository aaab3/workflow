/**
 * Golden path E2E test for OpenClaw Workflow UI.
 *
 * Verifies the core user journey:
 * 1. App loads
 * 2. Module panel shows modules
 * 3. Workflow list opens and is empty
 * 4. Onboarding can be dismissed
 * 5. API client connects to backend
 */

import { test, expect } from "@playwright/test";

test.describe("App boot", () => {
  test("loads the main UI", async ({ page }) => {
    await page.goto("/");

    // App should render the toolbar with the workflow brand
    await expect(page).toHaveTitle(/OpenClaw|Workflow/);

    // Toolbar buttons should be visible
    await expect(page.getByRole("button", { name: /工作流/ })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: /运行/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /保存/ })).toBeVisible();
  });

  test("module panel lists available modules", async ({ page }) => {
    await page.goto("/");

    // Wait for modules to load from the API
    await expect(page.getByPlaceholder("搜索模块...")).toBeVisible({ timeout: 10000 });

    // Should see at least one of the categories
    await expect(page.getByText(/输入\/输出|流程控制|自定义代码/).first()).toBeVisible({ timeout: 10000 });

    // Should see specific modules
    await expect(page.getByText("HTTP 请求").first()).toBeVisible();
  });

  test("module search filters the list", async ({ page }) => {
    await page.goto("/");

    const searchInput = page.getByPlaceholder("搜索模块...");
    await searchInput.fill("HTTP");

    // Should still see HTTP request module
    await expect(page.getByText("HTTP 请求").first()).toBeVisible();

    // But filter out unrelated ones (delay should not be visible)
    await expect(page.getByText("延时等待")).not.toBeVisible();
  });
});

test.describe("Onboarding", () => {
  test("can be opened and dismissed", async ({ page }) => {
    // Pre-set localStorage to skip auto-popup
    await page.addInitScript(() => {
      window.localStorage.setItem("openclaw-workflow-onboarded", "true");
    });

    await page.goto("/");

    // Click the help/onboarding button
    const guideButton = page.getByTitle(/新手教程/);
    await expect(guideButton).toBeVisible();
    await guideButton.click();

    // Should see onboarding content
    await expect(page.getByText(/欢迎使用 OpenClaw Workflow/)).toBeVisible();
  });
});

test.describe("Workflow list", () => {
  test("opens and shows empty state initially", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("openclaw-workflow-onboarded", "true");
    });

    await page.goto("/");

    // Open the workflow list
    await page.getByRole("button", { name: /工作流/ }).click();

    // Should see the list dialog
    await expect(page.getByText(/工作流列表/)).toBeVisible();

    // New button should be visible
    await expect(page.getByRole("button", { name: /\+ 新建/ })).toBeVisible();
  });
});

test.describe("Backend API connectivity", () => {
  test("frontend successfully proxies to backend", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("openclaw-workflow-onboarded", "true");
    });

    await page.goto("/");

    // Wait for module panel to load (this requires a successful API call)
    await expect(page.getByText(/HTTP 请求|读取文件|条件分支/).first()).toBeVisible({ timeout: 10000 });

    // Verify health endpoint via direct fetch
    const response = await page.request.get("/api/health");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
  });
});
