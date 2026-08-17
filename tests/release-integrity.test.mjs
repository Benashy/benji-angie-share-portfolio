import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const app = readFileSync("app.js", "utf8");
const index = readFileSync("index.html", "utf8");
const version = app.match(/const APP_VERSION = "([^"]+)"/)?.[1];

test("HTML cache markers match the visible app version", () => {
  assert.ok(version, "APP_VERSION is present");
  assert.match(index, new RegExp(`app\\.js\\?v=${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(index, new RegExp(`styles\\.css\\?v=${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("market refresh function and reliability migration are version controlled", () => {
  assert.ok(existsSync("supabase/functions/refresh-prices/index.ts"));
  assert.ok(existsSync("supabase/migrations/20260819010000_non_security_reliability.sql"));
});

test("browser assets use pinned third-party versions", () => {
  assert.doesNotMatch(index, /@supabase\/supabase-js@2\/dist/);
  assert.match(index, /@supabase\/supabase-js@2\.57\.4/);
});
