import React from "react";
import { render, screen } from "@testing-library/react";
import { ROUTES } from "./constants/routes";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const APP_MODULE_PATH = require.resolve("./App");

function renderAppAtRoute(route, nodeEnv = "test") {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = nodeEnv;

  delete require.cache[APP_MODULE_PATH];

  const actualUseState = React.useState.bind(React);
  const useStateSpy = jest.spyOn(React, "useState").mockImplementation((initialValue) => {
    const resolvedInitialValue = typeof initialValue === "function" ? initialValue() : initialValue;
    if (resolvedInitialValue === ROUTES.HOME) {
      return [route, jest.fn()];
    }
    return actualUseState(initialValue);
  });

  const App = require("./App").default;
  const result = render(<App />);
  useStateSpy.mockRestore();

  process.env.NODE_ENV = previousNodeEnv;
  delete require.cache[APP_MODULE_PATH];
  return { ...result, screen };
}

async function renderAppWithDevHashRoute(nodeEnv = "test") {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = nodeEnv;

  delete require.cache[APP_MODULE_PATH];
  window.history.replaceState({}, "", "/#job-learning-diagnostics");

  const App = require("./App").default;
  const result = render(<App />);

  process.env.NODE_ENV = previousNodeEnv;
  delete require.cache[APP_MODULE_PATH];
  return { ...result, screen };
}

describe("App job learning diagnostics route gating", () => {
  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    window.history.replaceState({}, "", "/");
    delete require.cache[APP_MODULE_PATH];
    jest.clearAllMocks();
  });

  test("normal navigation does not expose diagnostics in the app shell", () => {
    const { screen } = renderAppAtRoute(ROUTES.HOME, "test");

    expect(screen.queryByText(/job learning diagnostics/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /job learning diagnostics/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/open menu/i)).toBeInTheDocument();
  });

  test("dev/local access renders diagnostics only through the hidden route key", () => {
    const { screen } = renderAppAtRoute(ROUTES.JOB_LEARNING_DIAGNOSTICS, "test");

    expect(screen.getByRole("heading", { name: /job learning diagnostics/i })).toBeInTheDocument();
    expect(screen.getByText(/read-only registry health and promotion audit/i)).toBeInTheDocument();
  });

  test("production access does not render diagnostics even when the hidden route key is forced", () => {
    const { screen } = renderAppAtRoute(ROUTES.JOB_LEARNING_DIAGNOSTICS, "production");

    expect(screen.queryByRole("heading", { name: /job learning diagnostics/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/read-only registry health and promotion audit/i)).not.toBeInTheDocument();
  });

  test("local manual access renders diagnostics through the hidden hash route", async () => {
    const { screen } = await renderAppWithDevHashRoute("test");

    expect(await screen.findByRole("heading", { name: /job learning diagnostics/i })).toBeInTheDocument();
    expect(screen.getByText(/read-only registry health and promotion audit/i)).toBeInTheDocument();
  });

  test("production blocks the hidden hash route", async () => {
    const { screen } = await renderAppWithDevHashRoute("production");

    expect(screen.queryByRole("heading", { name: /job learning diagnostics/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/read-only registry health and promotion audit/i)).not.toBeInTheDocument();
  });
});
