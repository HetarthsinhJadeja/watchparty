export type SessionAuthClient<TSession> = {
  getSession(): Promise<{ data: { session: TSession | null }; error: unknown }>;
  signInAnonymously(): Promise<{ data: { session: TSession | null }; error: unknown }>;
};

const pendingSessions = new WeakMap<object, Promise<unknown>>();

/** Reuse a persisted session, otherwise create one anonymous Supabase session per client at a time. */
export function ensureUserSession<TSession>(auth: SessionAuthClient<TSession>): Promise<TSession> {
  const key = auth as object;
  const existingRequest = pendingSessions.get(key);
  if (existingRequest) return existingRequest as Promise<TSession>;

  const request = Promise.resolve().then(async () => {
    const current = await auth.getSession();
    if (current.error) throw current.error;
    if (current.data.session) return current.data.session;

    const created = await auth.signInAnonymously();
    if (created.error) throw created.error;
    if (!created.data.session) throw new Error("Supabase returned no anonymous session.");
    return created.data.session;
  });

  pendingSessions.set(key, request);
  const clearRequest = () => {
    if (pendingSessions.get(key) === request) pendingSessions.delete(key);
  };
  void request.then(clearRequest, clearRequest);
  return request;
}

export function createRoomIdentityArguments(userId: string) {
  return { p_created_by_user_id: userId, p_created_by_guest_id: null } as const;
}

export function joinRoomIdentityArguments(userId: string) {
  return { p_user_id: userId, p_guest_id: null } as const;
}
