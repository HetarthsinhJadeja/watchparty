import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createRoomIdentityArguments,
  ensureUserSession,
  joinRoomIdentityArguments,
} from "../lib/guest-session.ts";

test("reuses an existing Supabase session without creating another user", async () => {
  const session = { user: { id: "existing-user" } };
  let signInCalls = 0;
  const auth = {
    async getSession() { return { data: { session }, error: null }; },
    async signInAnonymously() {
      signInCalls += 1;
      return { data: { session: null }, error: null };
    },
  };

  assert.equal(await ensureUserSession(auth), session);
  assert.equal(signInCalls, 0);
});

test("shares one anonymous sign-in request across concurrent callers", async () => {
  const session = { user: { id: "anonymous-user" } };
  let signInCalls = 0;
  const auth = {
    async getSession() { return { data: { session: null }, error: null }; },
    async signInAnonymously() {
      signInCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { data: { session }, error: null };
    },
  };

  const first = ensureUserSession(auth);
  const second = ensureUserSession(auth);
  assert.strictEqual(first, second);
  assert.equal(await first, session);
  assert.equal(signInCalls, 1);
});

test("allows a later retry after anonymous sign-in fails", async () => {
  let signInCalls = 0;
  const auth = {
    async getSession() { return { data: { session: null }, error: null }; },
    async signInAnonymously() {
      signInCalls += 1;
      return signInCalls === 1
        ? { data: { session: null }, error: new Error("temporarily unavailable") }
        : { data: { session: { user: { id: "retry-user" } } }, error: null };
    },
  };

  await assert.rejects(ensureUserSession(auth), /temporarily unavailable/);
  assert.deepEqual(await ensureUserSession(auth), { user: { id: "retry-user" } });
  assert.equal(signInCalls, 2);
});

test("binds room RPC identity arguments to the Supabase user ID", () => {
  assert.deepEqual(createRoomIdentityArguments("trusted-uid"), {
    p_created_by_user_id: "trusted-uid",
    p_created_by_guest_id: null,
  });
  assert.deepEqual(joinRoomIdentityArguments("trusted-uid"), {
    p_user_id: "trusted-uid",
    p_guest_id: null,
  });
});
