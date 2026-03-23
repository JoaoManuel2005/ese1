import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import MockBetterSqlite3, { resetMockBetterSqlite3 } from "./test/mockBetterSqlite3";

vi.mock("better-sqlite3", () => ({
  __esModule: true,
  default: MockBetterSqlite3,
}));

afterEach(() => {
  resetMockBetterSqlite3();
  if (typeof window !== "undefined") {
    window.localStorage.clear();
    window.sessionStorage.clear();
  }
});
