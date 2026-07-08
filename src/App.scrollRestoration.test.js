import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import { STORAGE_KEYS } from "./constants/storageKeys";

const COMPLETE_COMPANY_PROFILE = {
  companyName: "Acme Field Services",
  phone: "5551234567",
  addressLine1: "123 Main St",
  city: "Springfield",
  state: "IL",
  zip: "62704",
};

function seedCompanyProfile() {
  localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify(COMPLETE_COMPANY_PROFILE));
}

beforeEach(() => {
  localStorage.clear();
  seedCompanyProfile();

  try {
    Object.defineProperty(document.documentElement, "scrollTo", {
      configurable: true,
      value: undefined,
    });
  } catch {}

  try {
    Object.defineProperty(document.body, "scrollTo", {
      configurable: true,
      value: undefined,
    });
  } catch {}

  try {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "auto";
    } else {
      Object.defineProperty(window.history, "scrollRestoration", {
        configurable: true,
        writable: true,
        value: "auto",
      });
    }
  } catch {}
});

test("resets scroll position on mount and when navigating to a new page", async () => {
  const scrollToSpy = jest.spyOn(window, "scrollTo").mockImplementation(() => {});

  render(<App />);

  await waitFor(() => {
    expect(scrollToSpy).toHaveBeenCalled();
  });
  expect(window.history.scrollRestoration).toBe("manual");

  scrollToSpy.mockClear();

  fireEvent.click(screen.getByLabelText("Open Menu"));
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));

  await waitFor(() => {
    expect(scrollToSpy).toHaveBeenCalled();
  });

  scrollToSpy.mockRestore();
});
