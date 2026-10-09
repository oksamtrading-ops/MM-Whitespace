import { test } from "node:test";
import assert from "node:assert/strict";
import { HOME_LABEL, homeFor } from "./home.ts";

test("each reader is sent to the one place that will let them in", () => {
  assert.equal(homeFor(null), "/signin");
  assert.equal(homeFor({ role: "viewer", mustChangePassword: false }), "/dashboard");
  assert.equal(homeFor({ role: "analyst", mustChangePassword: false }), "/review");
  assert.equal(homeFor({ role: "admin", mustChangePassword: false }), "/review");
});

test("a temporary password outranks every role", () => {
  for (const role of ["viewer", "analyst", "admin"] as const) {
    assert.equal(homeFor({ role, mustChangePassword: true }), "/password");
  }
});

test("every destination has words, and the words name it", () => {
  for (const user of [null,
    { role: "viewer" as const, mustChangePassword: false },
    { role: "analyst" as const, mustChangePassword: false },
    { role: "admin" as const, mustChangePassword: true }]) {
    assert.ok(HOME_LABEL[homeFor(user)], `no label for ${homeFor(user)}`);
  }
  assert.match(HOME_LABEL["/dashboard"], /dashboard/);
  assert.match(HOME_LABEL["/review"], /review/);
});
