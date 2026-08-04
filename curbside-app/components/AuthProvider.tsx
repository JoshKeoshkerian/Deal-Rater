"use client";

/**
 * Sign-in state, resolved once per page load and shared by everything that
 * needs it.
 *
 * WHY A CONTEXT RATHER THAN A FETCH PER PAGE. The session is an httpOnly cookie
 * (`lib/api.ts` explains why), so the only way to know who is signed in is to
 * ask the server. Before the merge that question had exactly one asker, the
 * saved page. Now the header asks it on every route, and so do /account and
 * /saved — three `GET /v1/users/me` calls for one page view if each fetched for
 * itself. One provider, one call, one answer.
 *
 * The landing page is included on purpose. A marketing page that says "Sign in"
 * to somebody who already is reads as a site that forgot them.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { fetchMe, NotAuthenticatedError, signOut as apiSignOut } from "@/lib/api";
import type { User } from "@/lib/types";

/**
 * `unknown` is the state before the first answer arrives, and it is deliberately
 * NOT collapsed into "signed out". Rendering a sign-in prompt for the ~200ms
 * before the server replies makes a signed-in user watch themselves get logged
 * out and back in on every navigation.
 */
export type AuthStatus = "unknown" | "signed-in" | "signed-out" | "error";

interface AuthValue {
  user: User | null;
  status: AuthStatus;
  /** Non-null only when `status === "error"` — the API was unreachable. */
  error: string | null;
  /** Re-ask the server. Called after a successful sign-in. */
  refresh: () => Promise<void>;
  /** Revoke the session, then drop local state whether or not that succeeded. */
  signOut: () => Promise<void>;
  /** Adopt a user the sign-in form just verified, without a second round trip. */
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("unknown");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const me = await fetchMe();
      if (me) {
        setUserState(me);
        setStatus("signed-in");
        setError(null);
        return;
      }
      setUserState(null);
      setStatus("signed-out");
      setError(null);
    } catch (caught) {
      if (caught instanceof NotAuthenticatedError) {
        setUserState(null);
        setStatus("signed-out");
        setError(null);
        return;
      }
      // The API being down is not the same as being signed out, and the header
      // must not claim otherwise. Distinguishing them is why `error` exists.
      setUserState(null);
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "Could not reach the server.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await apiSignOut().catch(() => undefined);
    setUserState(null);
    setStatus("signed-out");
    setError(null);
  }, []);

  const setUser = useCallback((next: User) => {
    setUserState(next);
    setStatus("signed-in");
    setError(null);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ user, status, error, refresh, signOut, setUser }),
    [user, status, error, refresh, signOut, setUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>.");
  return value;
}
