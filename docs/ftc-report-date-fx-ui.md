# Report, income-date and FX improvements

This delivery follows `FTC-Report-Date-FX-UI-Comments.md`, separately from the earlier review briefs. The user authorized direct implementation after the required GPT-6-Luna max agents were stopped by their usage limit. Tests retain the previously agreed shared calculation/validation, browser and authenticated HTTP interfaces.

## Income-date slice

The source already stores an exact earned date. Editing that date derives the source year; there is no second editable source-year field. The residence form's year groups residence facts, while the source's derived year selects those facts for the Section 41 test. The saved report retains both the date and derived year. Neither the remittance date nor residence records are rewritten when the earned date changes.

The source-year display now includes Gregorian and Buddhist Era years and explains why the year is used. Inline Thai feedback identifies earned dates after the selected claim year's end, after remittance, mismatched saved date/year combinations, and the existing pre-2024 scope. The new end-of-year message makes an existing invalid chronology explicit; the tax formula and eligible date window are unchanged. Engine v5 identifies the updated assessment output; historical snapshots remain frozen.

Reference: [RD FTC manual](https://www.rd.go.th/fileadmin/user_upload/porphor/GuideTaxFromAbroad_EN.pdf), printed pages 12–14 for earned year, dates and worksheet inputs. Tests were written red-first through the public calculation and browser interfaces.

Date-slice verification: release gate 187 tests in 20 files, ten migration checks/blank apply, TypeScript and build passed; six date/report browser checks and seventeen date/draft-workflow checks passed (the date journey appears in both runs). A previous negative test expected errors only at final calculation; it now verifies the same invalid dates are caught earlier beside the source field. Save, submission and ownership code are unchanged.
