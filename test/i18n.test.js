import test from "node:test";
import assert from "node:assert/strict";

import { normalizeLanguage, resolveLanguage } from "../src/i18n.js";

test("normalizes supported language aliases", () => {
  assert.equal(normalizeLanguage("zh"), "zh-CN");
  assert.equal(normalizeLanguage("zh_Hans_CN"), "zh-CN");
  assert.equal(normalizeLanguage("en-US"), "en");
  assert.equal(normalizeLanguage("fr"), null);
});

test("resolves explicit, environment and system languages in order", () => {
  assert.equal(resolveLanguage("en", { environment: { PORTDOC_LANG: "zh-CN" }, systemLocale: "zh-CN" }), "en");
  assert.equal(resolveLanguage("auto", { environment: { PORTDOC_LANG: "zh" }, systemLocale: "en-US" }), "zh-CN");
  assert.equal(resolveLanguage(undefined, { environment: {}, systemLocale: "zh-Hans-CN" }), "zh-CN");
  assert.equal(resolveLanguage(undefined, { environment: {}, systemLocale: "de-DE" }), "en");
});
