import type { FxRateType } from "./contracts.js";

export const MANUAL_FX_NOTICE = "อัตราที่ผู้ใช้กรอกเอง ยังไม่ผ่านการตรวจสอบโดยต้นแบบ";

export function fxDateBasisLabel(method: FxRateType | null): string {
  if (method === "bot_average_buying") return "อ้างอิงสิ้นวันทำการก่อนวันที่นำเงินเข้าไทย ผู้ใช้ต้องตรวจสอบวันทำการจากแหล่งอ้างอิง";
  if (method === "bank_buying" || method === "manual") return "อ้างอิงวันที่นำเงินเข้าไทย";
  return "อัตราและวันที่ตามข้อมูลเดิมที่บันทึกไว้";
}

/** Checks entered chronology; it does not verify quotes or a banking holiday calendar. */
export function manualFxDateIssue(method: FxRateType | null, effectiveDate: string | null, remittanceDate: string | null | undefined): { code: string; message: string } | null {
  if (!effectiveDate || !remittanceDate) return null;
  if (method === "bot_average_buying" && effectiveDate >= remittanceDate) return {
    code: "fx.bot_date_mismatch", message: "อัตราอ้างอิง ธปท. ต้องเป็นวันทำการก่อนวันที่นำเงินเข้าไทย ตรวจสอบวันทำการจากแหล่งอ้างอิง",
  };
  if (method === "bank_buying" && effectiveDate !== remittanceDate) return {
    code: "fx.bank_date_mismatch", message: "อัตรารับซื้อของธนาคารต้องอ้างอิงวันที่นำเงินเข้าไทย",
  };
  if (method === "manual" && effectiveDate !== remittanceDate) return {
    code: "fx.manual_date_mismatch", message: "วันที่ของอัตราที่กรอกเองต้องตรงกับวันที่นำเงินเข้าไทย",
  };
  return null;
}
