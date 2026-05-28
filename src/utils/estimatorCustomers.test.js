import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  addToCustomerRecents,
  buildSelectedCustomerProfileFromDraft,
  flattenCustomerForEstimator,
  readCustomerRecents,
} from "./estimatorCustomers";

describe("estimatorCustomers utility", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("readCustomerRecents returns [] on malformed/non-array stored JSON", () => {
    localStorage.setItem(STORAGE_KEYS.CUSTOMER_RECENTS, "{bad json");
    expect(readCustomerRecents()).toEqual([]);

    localStorage.setItem(STORAGE_KEYS.CUSTOMER_RECENTS, JSON.stringify({ id: "c1" }));
    expect(readCustomerRecents()).toEqual([]);
  });

  test("addToCustomerRecents stores newest customer first", () => {
    localStorage.setItem(STORAGE_KEYS.CUSTOMER_RECENTS, JSON.stringify(["c1", "c2"]));
    addToCustomerRecents("c3");
    expect(readCustomerRecents()).toEqual(["c3", "c1", "c2"]);
  });

  test("addToCustomerRecents dedupes existing customer ids", () => {
    localStorage.setItem(STORAGE_KEYS.CUSTOMER_RECENTS, JSON.stringify(["c1", "c2", "c3"]));
    addToCustomerRecents("c2");
    expect(readCustomerRecents()).toEqual(["c2", "c1", "c3"]);
  });

  test("addToCustomerRecents enforces max list length", () => {
    localStorage.setItem(
      STORAGE_KEYS.CUSTOMER_RECENTS,
      JSON.stringify(["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"])
    );
    addToCustomerRecents("c9");
    expect(readCustomerRecents()).toEqual(["c9", "c1", "c2", "c3", "c4", "c5", "c6", "c7"]);
  });

  test("flattenCustomerForEstimator preserves expected fields for commercial and residential", () => {
    const commercial = flattenCustomerForEstimator({
      type: "commercial",
      companyName: "Acme Welding",
      comPhone: "6025550000",
      comEmail: "ops@acme.test",
      contactName: "Dana",
      jobsite: { street: "100 Main St", city: "Phoenix", state: "AZ", zip: "85001" },
      billSameAsJob: true,
    });
    expect(commercial).toEqual({
      name: "Acme Welding",
      phone: "6025550000",
      email: "ops@acme.test",
      attn: "Dana",
      address: "100 Main St\nPhoenix, AZ 85001",
      billingAddress: "100 Main St\nPhoenix, AZ 85001",
    });

    const residential = flattenCustomerForEstimator({
      fullName: "Jane Homeowner",
      resPhone: "4805550000",
      resEmail: "jane@test.com",
      resService: { street: "22 Oak Ave", city: "Mesa", state: "AZ", zip: "85201" },
      resBillingSame: true,
    });
    expect(residential).toEqual({
      name: "Jane Homeowner",
      phone: "4805550000",
      email: "jane@test.com",
      attn: "",
      address: "22 Oak Ave\nMesa, AZ 85201",
      billingAddress: "22 Oak Ave\nMesa, AZ 85201",
    });
  });

  test("buildSelectedCustomerProfileFromDraft returns matched profile shape and draft fallback shape", () => {
    const customers = [
      {
        id: "c1",
        type: "commercial",
        companyName: "Orbit Fabrication",
        jobsite: { street: "1 Steel Rd", city: "Tempe", state: "AZ", zip: "85281" },
        billSameAsJob: true,
      },
    ];
    const matched = buildSelectedCustomerProfileFromDraft({}, "c1", customers);
    expect(matched.id).toBe("c1");
    expect(matched.name).toBe("Orbit Fabrication");
    expect(matched.address).toBe("1 Steel Rd\nTempe, AZ 85281");

    const fallback = buildSelectedCustomerProfileFromDraft(
      {
        id: "draft-1",
        name: "Manual Entry",
        attn: "Alex",
        phone: "123",
        email: "x@test.com",
        netTermsType: "net_30",
        netTermsDays: 30,
        address: "Addr",
        billingAddress: "Bill",
      },
      "",
      []
    );
    expect(fallback).toEqual({
      id: "draft-1",
      name: "Manual Entry",
      fullName: "Manual Entry",
      attn: "Alex",
      phone: "123",
      email: "x@test.com",
      netTermsType: "net_30",
      netTermsDays: "30",
      address: "Addr",
      billingAddress: "Bill",
    });
  });
});
