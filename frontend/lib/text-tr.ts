export function trStatus(status: string): string {
  const map: Record<string, string> = {
    uploaded: "Yüklendi",
    processing: "İşleniyor",
    review_ready: "İncelemeye Hazır",
    approved: "Onaylandı",
    rejected: "Reddedildi",
    failed: "Hata",
  };
  return map[status] ?? status;
}

export function trRiskCode(code: string): string {
  const map: Record<string, string> = {
    duplicate_hash: "Mükerrer video tespiti",
    no_mismatch_ai_vs_operator: "NO uyuşmazlığı (AI ve operatör)",
    no_mismatch_ai_vs_upload: "NO uyuşmazlığı (AI ve yükleme)",
    low_quality_score: "Düşük kalite skoru",
    short_duration: "Video süresi kısa",
    long_duration: "Video süresi uzun",
    transcription_missing: "Metin çıkarımı yetersiz",
    ocr_missing: "OCR metni yetersiz",
  };
  return map[code] ?? code.replaceAll("_", " ");
}

export function trIssueSource(source: string): string {
  if (source === "failure_reason") return "Hata Nedeni";
  if (source === "risk_code") return "Risk Kodu";
  if (source === "risk_state") return "Risk Durumu";
  if (source === "status") return "Kayıt Durumu";
  return source;
}

export function trIssueKey(source: string, key: string): string {
  if (source === "risk_code") return trRiskCode(key);
  if (source === "risk_state" && key === "risk_locked") return "Risk kilidi aktif";
  if (source === "status") return trStatus(key);
  if (source === "failure_reason" && key === "upload_abandoned_timeout_30m") {
    return "Yükleme 30 dakika içinde tamamlanmadı";
  }
  return key.replaceAll("_", " ");
}

export function trRequestStatus(status: string): string {
  const map: Record<string, string> = {
    open: "Açık",
    approved: "Onaylandı",
    rejected: "Reddedildi",
  };
  return map[status] ?? status;
}

export function trRequestReason(reason: string | null | undefined): string {
  if (!reason) return "-";
  const map: Record<string, string> = {
    wrong_upload: "Yanlış yükleme",
    duplicate_upload: "Mükerrer yükleme",
  };
  return map[reason] ?? reason.replaceAll("_", " ");
}

export function trAdminAction(action: string): string {
  const map: Record<string, string> = {
    submission_reviewed: "İnceleme kararı",
    sms_dispatched: "Toplu SMS",
    sms_dispatched_single: "Tekli SMS",
    sms_dispatched_selected: "Seçili SMS",
    sms_retry_failed: "Başarısız SMS tekrar deneme",
    submission_change_request_resolved: "Talep çözümü",
    submission_risk_overridden: "Risk kilidi kaldırma",
  };
  return map[action] ?? action.replaceAll("_", " ");
}

export function trRiskNote(note: string | null | undefined): string {
  if (!note) return "";
  return note
    .replaceAll("Not:", "Notu:")
    .replaceAll("auto_duplicate_detection", "otomatik mükerrer tespiti")
    .replaceAll("duplicate_hash", "mükerrer video tespiti")
    .replaceAll("no_mismatch_ai_vs_operator", "NO uyuşmazlığı")
    .replaceAll("operator_no=", "operatör NO=")
    .replaceAll("detected_no=", "tespit edilen NO=");
}

