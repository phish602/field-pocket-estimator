import {
  getEnabledSocialProviders,
  getSocialProvider,
  isSupportedSocialProvider,
  SOCIAL_PROVIDERS_ENV,
} from "./authSocialProviders";

// Build the env explicitly so each case proves exactly what drives it.
const env = (value) => (value === undefined ? {} : { [SOCIAL_PROVIDERS_ENV]: value });
const ids = (providers) => providers.map((provider) => provider.id);

describe("authSocialProviders registry (Phase 2.2)", () => {
  describe("configuration parsing", () => {
    test.each([
      ["missing", undefined],
      ["blank", ""],
      ["whitespace only", "   "],
      ["commas only", " , , "],
    ])("%s configuration enables no providers", (_label, value) => {
      expect(getEnabledSocialProviders(env(value))).toEqual([]);
    });

    test("google only", () => {
      expect(ids(getEnabledSocialProviders(env("google")))).toEqual(["google"]);
    });

    test("apple only", () => {
      expect(ids(getEnabledSocialProviders(env("apple")))).toEqual(["apple"]);
    });

    test("google plus apple", () => {
      expect(ids(getEnabledSocialProviders(env("google,apple")))).toEqual(["google", "apple"]);
    });

    test("preserves the configured order", () => {
      expect(ids(getEnabledSocialProviders(env("apple,google")))).toEqual(["apple", "google"]);
    });

    test("trims whitespace and normalizes case", () => {
      expect(ids(getEnabledSocialProviders(env("  GOOGLE , Apple  ")))).toEqual(["google", "apple"]);
    });

    test("removes duplicates while keeping first position", () => {
      expect(ids(getEnabledSocialProviders(env("google,apple,google,GOOGLE")))).toEqual([
        "google",
        "apple",
      ]);
    });

    test("ignores unknown provider ids", () => {
      expect(ids(getEnabledSocialProviders(env("google,facebook,saml,okta,apple")))).toEqual([
        "google",
        "apple",
      ]);
    });

    test("an entirely unknown configuration enables no providers", () => {
      expect(getEnabledSocialProviders(env("facebook,twitter,azure"))).toEqual([]);
    });
  });

  describe("display metadata", () => {
    test("exposes accessible labels for the UI", () => {
      const [google, apple] = getEnabledSocialProviders(env("google,apple"));
      expect(google).toEqual(
        expect.objectContaining({
          id: "google",
          label: "Continue with Google",
          iconPath: "/auth/google-g-logo.svg",
        })
      );
      expect(apple).toEqual(expect.objectContaining({ id: "apple", label: "Continue with Apple" }));
    });

    test("never exposes secrets, tokens, or credentials", () => {
      const serialized = JSON.stringify(getEnabledSocialProviders(env("google,apple"))).toLowerCase();
      ["secret", "client_secret", "token", "key", "credential", "password"].forEach((banned) => {
        expect(serialized).not.toContain(banned);
      });
    });
  });

  describe("provider lookup", () => {
    test.each(["google", "apple", "GOOGLE", "  Apple  "])("%p is supported", (value) => {
      expect(isSupportedSocialProvider(value)).toBe(true);
      expect(getSocialProvider(value)).not.toBeNull();
    });

    test.each(["", "   ", null, undefined, "facebook", "saml", "sso"])(
      "%p is not supported",
      (value) => {
        expect(isSupportedSocialProvider(value)).toBe(false);
        expect(getSocialProvider(value)).toBeNull();
      }
    );
  });
});
