import assert from "node:assert/strict";
import test from "node:test";
import { safeRedirectPath } from "../lib/auth-redirect.mts";

test("keeps a local room return destination and its query string", () => {
  assert.equal(
    safeRedirectPath("/room/abc-123?invite=friend"),
    "/room/abc-123?invite=friend",
  );
});

test("rejects absolute, protocol-relative, and backslash redirect destinations", () => {
  assert.equal(safeRedirectPath("https://example.com/steal"), "/");
  assert.equal(safeRedirectPath("//example.com/steal"), "/");
  assert.equal(safeRedirectPath("/\\example.com/steal"), "/");
});

test("uses the safe default when the destination is absent", () => {
  assert.equal(safeRedirectPath(null), "/");
});
