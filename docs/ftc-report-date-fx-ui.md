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

## Amount layout and page spacing

The I/J/K/L section now uses a full-width two-column desktop grid and a single-column phone stack. Calculated I/K have a distinct background and read-only outputs; editable J/L retain the original input identifiers, validation and required markers. Plain Thai headings lead, with worksheet letters as secondary references. All four amount controls have matching 48px heights, tabular numbers and aligned currency units. The formula note and confirmation panel remain concise.

J/L display grouped two-decimal amounts while unfocused, while their actual input values remain canonical decimal strings at all times. Editing J updates K and does not change L. Review caught and corrected a focus/selection race in an initial formatter; the finished display layer never replaces the input text during focus. Invalid text remains visible for correction.

The case editor has inset phone gutters and consistent spacing. Residence cards have inner padding, separated date rows and actions, associated helper text, and fully visible day-count summaries. Screenshots at 1280px, 390px and 320px were inspected for long Thai labels, complete amounts, borders and overflow. The existing visual identity and residence logic are retained.

The complete browser suite passes 113 journeys, and all 11 authenticated taxpayer/officer journeys pass. These include saved reports, downloaded workbooks, ownership and session boundaries, submission and historical snapshots. No hosting/access settings or tax formulas were changed by this brief.

The final isolated release gate passes 190 tests in 20 files, TypeScript, ten ordered/checksummed migration checks with blank-database application, and the production build. One concurrent run hit the existing restore fixture's five-second timeout; the isolated rerun passed with the original limits and no changes to that fixture. All review findings in this brief were addressed before the final commit.
