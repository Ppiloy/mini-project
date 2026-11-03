# Report, income-date and FX improvements

This delivery follows `FTC-Report-Date-FX-UI-Comments.md`, separately from the earlier review briefs. The user authorized direct implementation after the required GPT-6-Luna max agents were stopped by their usage limit. Tests retain the previously agreed shared calculation/validation, browser and authenticated HTTP interfaces.

## Income-date slice

The source already stores an exact earned date. Editing that date derives the source year; there is no second editable source-year field. The residence form's year groups residence facts, while the source's derived year selects those facts for the Section 41 test. The saved report retains both the date and derived year. Neither the remittance date nor residence records are rewritten when the earned date changes.

The source-year display now includes Gregorian and Buddhist Era years and explains why the year is used. Inline Thai feedback identifies earned dates after the selected claim year's end, after remittance, mismatched saved date/year combinations, and the existing pre-2024 scope. The new end-of-year message makes an existing invalid chronology explicit; the tax formula and eligible date window are unchanged. Engine v5 identifies the updated assessment output; historical snapshots remain frozen.

Reference: [RD FTC manual](https://www.rd.go.th/fileadmin/user_upload/porphor/GuideTaxFromAbroad_EN.pdf), printed pages 12–14 for earned year, dates and worksheet inputs. Tests were written red-first through the public calculation and browser interfaces.

Date-slice verification: release gate 187 tests in 20 files, ten migration checks/blank apply, TypeScript and build passed; six date/report browser checks and seventeen date/draft-workflow checks passed (the date journey appears in both runs). A previous negative test expected errors only at final calculation; it now verifies the same invalid dates are caught earlier beside the source field. Save, submission and ownership code are unchanged.

## Manual FX slice

New original-currency entries use a manually entered quote per one currency unit. The recommended method is BOT average buying, with the commercial-bank buying rate available explicitly. The reference date and source are entered by the user. Bank dates must match remittance; BOT dates must precede it, and the interface states the RD convention of the preceding business day. There is no rate lookup, substitution of today's rate, independent quote verification or holiday-calendar verification. A preceding date alone cannot prove it was the last business day; the user must check the reference source.

The existing FX record stores the selected method in `rateType` and manual acquisition in `sourceKind=user_supplied`; no schema migration is needed. D/E/F share that same quote and show a compact source-currency-to-THB breakdown. THB worksheet entry is explicitly already converted. HTML and Excel reports pair original amounts with frozen THB amounts and retain rate, units, method, source, date and the unverified disclosure. Legacy manual/fixture and per-100 records keep their stored values and units. New policy v3/engine v6 identify this expanded manual-input treatment without changing FTC arithmetic or the RD eligibility window.

FX verification: release gate 189 tests passed; an additional authenticated HTTP regression passed for method/date/source persistence and unchanged old snapshots after a draft rate edit. Ten focused browser journeys passed, including the downloaded Excel, legacy quotes, source-bound resets and JPY/VND per-unit entry. The USD example independently checks D=36,150, E=3,615, F=18,075 and FTC=1,807.50. Review also repaired the FX date input's accessible name and removed a delayed dropdown blur timer that could close a newly reopened currency choice.
