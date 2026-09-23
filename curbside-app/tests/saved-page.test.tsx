import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SavedPage from "@/app/saved/page";

const useAuthMock = vi.fn();
const fetchSavedMock = vi.fn();

vi.mock("@/components/AuthProvider", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    fetchSaved: (...args: unknown[]) => fetchSavedMock(...args),
    unsave: vi.fn(),
  };
});

function baseAuth(overrides: Partial<ReturnType<typeof useAuthMock>> = {}) {
  return {
    status: "signed-in",
    error: null,
    refresh: vi.fn(),
    signOut: vi.fn(),
    signOutError: null,
    user: { id: 1, email: "buyer@example.com" },
    setUser: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  window.history.replaceState({}, "", "/saved");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SavedPage auth-error vs. signed-out", () => {
  /**
   * Regression coverage: both branches used to collapse onto
   * `status !== "signed-in"`, so an API outage (status "error") rendered the
   * sign-in form with no indication the auth check itself had failed.
   */
  it("shows a retry banner, not the sign-in form, when the auth check itself failed", () => {
    useAuthMock.mockReturnValue(
      baseAuth({ status: "error", error: "Could not reach Curbside.", user: null }),
    );

    render(<SavedPage />);

    expect(screen.getByText(/couldn.?t reach curbside/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
  });

  it("shows the sign-in form when genuinely signed out", () => {
    useAuthMock.mockReturnValue(baseAuth({ status: "signed-out", user: null }));

    render(<SavedPage />);

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });
});

describe("SavedPage stale response guard", () => {
  /**
   * Regression coverage: `load()` had no way to tell a response apart from a
   * previous, superseded request. A slow `fetchSaved()` that resolves after
   * the session has moved on (here: signed out mid-flight) must not
   * repopulate `items`.
   */
  it("ignores a fetchSaved response that resolves after signing out", async () => {
    let resolveFetch: (items: unknown[]) => void = () => {};
    fetchSavedMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    useAuthMock.mockReturnValue(baseAuth({ status: "signed-in" }));

    const { rerender } = render(<SavedPage />);
    expect(fetchSavedMock).toHaveBeenCalledTimes(1);

    // Sign out while the request is still in flight.
    useAuthMock.mockReturnValue(baseAuth({ status: "signed-out", user: null }));
    rerender(<SavedPage />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();

    // The stale request now resolves. It must not resurrect the signed-in
    // list view or throw — nothing observable should change.
    resolveFetch([
      {
        id: 1,
        capture_id: 1,
        vehicle: "2017 Corolla SE",
        evaluated_at: new Date().toISOString(),
        listing_url: null,
        snapshot_only: false,
        evaluation: {
          headline: "",
          vehicle: "2017 Corolla SE",
          deal_score: { score: 70, beta: true },
          pricing: {
            ask_cents: 1000000,
            asking_interval_low_cents: null,
            asking_interval_high_cents: null,
          },
          vehicle_details: { mileage: 50000, title_status: "clean" },
          negotiation: { days_listed: 10 },
        },
      },
    ]);

    await waitFor(() => expect(fetchSavedMock).toHaveBeenCalledTimes(1));
    // Still on the sign-in form — the stale response was discarded.
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });
});
