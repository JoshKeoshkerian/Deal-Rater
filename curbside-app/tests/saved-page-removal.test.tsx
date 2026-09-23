import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SavedPage from "@/app/saved/page";

const useAuthMock = vi.fn();
const fetchSavedMock = vi.fn();
const unsaveMock = vi.fn();

vi.mock("@/components/AuthProvider", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    fetchSaved: (...args: unknown[]) => fetchSavedMock(...args),
    unsave: (...args: unknown[]) => unsaveMock(...args),
  };
});

function item(id: number, vehicle: string, evaluatedAt: string) {
  return {
    id,
    capture_id: id,
    vehicle,
    evaluated_at: evaluatedAt,
    listing_url: null,
    snapshot_only: false,
    evaluation: {
      headline: "",
      vehicle,
      deal_score: { score: 70, beta: true },
      pricing: {
        ask_cents: 1000000,
        asking_interval_low_cents: null,
        asking_interval_high_cents: null,
      },
      vehicle_details: { mileage: 50000, title_status: "clean" },
      negotiation: { days_listed: 10 },
    },
  };
}

beforeEach(() => {
  window.history.replaceState({}, "", "/saved");
  useAuthMock.mockReturnValue({
    status: "signed-in",
    error: null,
    refresh: vi.fn(),
    signOut: vi.fn(),
    signOutError: null,
    user: { id: 1, email: "buyer@example.com" },
    setUser: vi.fn(),
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * Regression coverage: `removing` used to be a single `number | null` slot.
 * Removing a second item while the first removal was still in flight
 * overwrote that slot, silently re-enabling the first card's "Remove" button
 * even though its request hadn't resolved yet.
 */
it("tracks two concurrent removals independently", async () => {
  fetchSavedMock.mockResolvedValue([
    item(1, "2017 Corolla SE", "2026-01-02T00:00:00.000Z"),
    item(2, "2019 Civic LX", "2026-01-01T00:00:00.000Z"),
  ]);

  let resolveFirst: () => void = () => {};
  let resolveSecond: () => void = () => {};
  unsaveMock
    .mockReturnValueOnce(new Promise<void>((resolve) => (resolveFirst = resolve)))
    .mockReturnValueOnce(new Promise<void>((resolve) => (resolveSecond = resolve)));

  render(<SavedPage />);

  await screen.findByText("2017 Corolla SE");
  const corollaCard = screen.getByText("2017 Corolla SE").closest("li")!;
  const civicCard = screen.getByText("2019 Civic LX").closest("li")!;

  fireEvent.click(within(corollaCard).getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(within(corollaCard).getByText("Removing…")).toBeInTheDocument());
  expect(within(civicCard).getByText("Remove")).toBeInTheDocument();

  fireEvent.click(within(civicCard).getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(within(civicCard).getByText("Removing…")).toBeInTheDocument());

  // Resolving the Corolla removal must not touch the Civic card's busy state.
  resolveFirst();
  await waitFor(() => expect(screen.queryByText("2017 Corolla SE")).not.toBeInTheDocument());
  expect(within(civicCard).getByText("Removing…")).toBeInTheDocument();

  resolveSecond();
  await waitFor(() => expect(screen.queryByText("2019 Civic LX")).not.toBeInTheDocument());
});
