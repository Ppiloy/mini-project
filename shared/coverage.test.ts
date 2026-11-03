import { describe, expect, it } from "vitest";
import { COUNTRY_CHOICES, INCOME_CHOICES, RD_DTA_REGISTER_URL } from "./coverage.js";

describe("shared FTC income coverage", () => {
  it("offers a distinct choice for every Section 40 category", () => {
    expect(INCOME_CHOICES.map(({ key, section }) => [key, section])).toEqual([
      ["40_1", "40(1)"],
      ["40_2", "40(2)"],
      ["40_3", "40(3)"],
      ["40_4_interest", "40(4)"],
      ["40_4_dividend", "40(4)"],
      ["40_5", "40(5)"],
      ["40_6", "40(6)"],
      ["40_7", "40(7)"],
      ["40_8", "40(8)"],
    ]);
    expect(INCOME_CHOICES.every(({ label, incomeType }) => label.length > 0 && incomeType.length > 0)).toBe(true);
    expect(INCOME_CHOICES.find(({ key }) => key === "40_4_interest")?.subtype).toBe("investment");
    expect(INCOME_CHOICES.find(({ key }) => key === "40_5")?.label).toContain("เช่าซื้อและขายผ่อน");
    expect(INCOME_CHOICES.find(({ key }) => key === "40_7")?.label).toContain("สัมภาระสำคัญ");
  });

  it("lists exactly the 61 current comprehensive RD DTA partners", () => {
    expect(COUNTRY_CHOICES.map(({ code }) => code).sort()).toEqual([
      "AM", "AU", "AT", "BH", "BD", "BY", "BE", "BG", "KH", "CA", "CL", "CN", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "HK",
      "HU", "IN", "ID", "IE", "IL", "IT", "JP", "KR", "KW", "LA", "LU", "MY", "MU", "MM", "NP", "NL", "NZ", "NO", "OM", "PK",
      "PH", "PL", "RO", "RU", "SC", "SG", "SI", "ZA", "ES", "LK", "SE", "CH", "TW", "TJ", "TR", "UA", "AE", "GB", "US", "UZ", "VN",
    ].sort());
    expect(COUNTRY_CHOICES.every(({ reviewed, treatyUrl }) => reviewed && treatyUrl?.startsWith("https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/") === true)).toBe(true);
    expect(COUNTRY_CHOICES.filter(({ code }) => ["US", "SG", "CN", "VN", "KH"].includes(code)).map(({ code, label, storedName }) => [code, label, storedName])).toEqual([
      ["KH", "กัมพูชา", "Cambodia"],
      ["CN", "จีน", "China"],
      ["SG", "สิงคโปร์", "Singapore"],
      ["US", "สหรัฐอเมริกา", "United States"],
      ["VN", "เวียดนาม", "Vietnam"],
    ]);
  });

  it("links each partner to its verified RD treaty PDF and exposes the current register", () => {
    const treatyUrls = Object.fromEntries(COUNTRY_CHOICES.map(({ code, treatyUrl }) => [code, treatyUrl]));
    expect(RD_DTA_REGISTER_URL).toBe("https://www.rd.go.th/english/766.html");
    expect(treatyUrls).toMatchObject({
      KH: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/cambodia_en_dta.pdf",
      CN: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/china_en_dta.pdf",
      SG: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/singapore_en_dta_v2.pdf",
      US: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/usa_en_dta.pdf",
      VN: "https://www.rd.go.th/fileadmin/user_upload/porpor/double-tax-agreements/vietnam_en_dta.pdf",
    });
  });
});
