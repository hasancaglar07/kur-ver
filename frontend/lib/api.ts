import type {
  AdminLogsResponse,
  ImportResponse,
  MeResponse,
  OperatorLogsResponse,
  OperatorAnalyticsDetail,
  OperatorAccount,
  OpsOverview,
  SuperadminStatsDashboard,
  SubmissionChangeRequestItem,
  SubmissionDetail,
  SubmissionItem,
  SuperadminAnalyticsOverview,
  UserRole,
} from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000/api";

type ApiErrorPayload = {
  detail?: unknown;
  message?: unknown;
  error?: unknown;
};

function translateApiMessage(message: string): string {
  const map: Array<[string, string]> = [
    ["Invalid token", "Geçersiz oturum anahtarı"],
    ["User not found", "Kullanıcı bulunamadı"],
    ["Insufficient role", "Bu işlem için yetkiniz yok"],
    ["Invalid credentials", "Kullanıcı adı veya şifre hatalı"],
    ["Account not found", "Hesap bulunamadı"],
    ["Username already exists", "Kullanıcı adı zaten kullanımda"],
    ["Username cannot be empty", "Kullanıcı adı boş olamaz"],
    ["Submission not found", "Kayıt bulunamadı"],
    ["Request not found", "Talep bulunamadı"],
    ["Request already resolved", "Talep zaten sonuçlandırılmış"],
    ["Decision must be approved or rejected", "Karar 'onaylandı' veya 'reddedildi' olmalıdır"],
    ["Submission is risk locked", "Kayıt risk kilidinde"],
    ["Submission has no processed video", "Kayıt için işlenmiş video yok"],
    ["Submission must be approved before SMS", "SMS göndermek için kayıt onaylı olmalı"],
    ["Submission must be approved before single SMS", "Tekli SMS için kayıt onaylı olmalı"],
    ["Submission must be approved before selected SMS", "Seçili SMS için kayıt onaylı olmalı"],
    ["No phone numbers available for this NO", "Bu NO için telefon numarası bulunamadı"],
    ["No phone numbers available for selection", "Seçim için telefon numarası bulunamadı"],
    ["Donor record not found", "Bağışçı kaydı bulunamadı"],
    ["Donor phone is empty", "Bağışçı telefon numarası boş"],
    ["No failed SMS recipients to retry", "Tekrar gönderilecek başarısız SMS alıcısı yok"],
    ["Failed recipients cannot be mapped to donor phones", "Başarısız alıcılar bağışçı telefonlarıyla eşleştirilemedi"],
    ["Default accounts are disabled. Use managed accounts.", "Varsayılan hesaplar kapalı. Yönetilen hesapları kullanın."],
  ];

  let out = message;
  for (const [en, tr] of map) {
    out = out.replaceAll(en, tr);
  }
  return out;
}

function getToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("access_token") ?? "";
}

function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = getToken();
  return {
    ...(extra ?? {}),
    Authorization: token ? `Bearer ${token}` : "",
  };
}

async function apiFetch(input: RequestInfo | URL, init: RequestInit | undefined, fallback: string) {
  const method = (init?.method ?? "GET").toUpperCase();
  const maxAttempts = method === "GET" ? 3 : 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetch(input, init);
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
        continue;
      }
    }
  }

  throw new Error(`${fallback} API erişimi yok (${API_BASE}). Backend servisinin çalıştığını kontrol edin.`);
}

async function readApiError(res: Response, fallback: string) {
  const normalize = (value: string) => {
    const text = value.trim();
    if (!text) return fallback;
    if (text === "[object Object]" || text === "{}" || text === "null" || text === "undefined") return fallback;
    return translateApiMessage(text);
  };

  const payload = (await res.json().catch(() => ({}))) as ApiErrorPayload;
  const pick = payload.detail ?? payload.message ?? payload.error;
  if (typeof pick === "string") return normalize(pick);
  if (Array.isArray(pick)) {
    const joined = pick
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const maybeMsg = (item as { msg?: unknown }).msg;
          if (typeof maybeMsg === "string") return maybeMsg;
        }
        return "";
      })
      .filter(Boolean)
      .join(" | ");
    if (joined) return normalize(joined);
  }
  if (pick && typeof pick === "object") {
    const maybeMsg = (pick as { msg?: unknown; detail?: unknown }).msg ?? (pick as { detail?: unknown }).detail;
    if (typeof maybeMsg === "string") return normalize(maybeMsg);
    const asJson = JSON.stringify(pick);
    if (asJson && asJson !== "{}") return normalize(asJson);
  }
  return fallback;
}

export function hasAuthToken() {
  return Boolean(getToken());
}

export async function login(username: string, password: string): Promise<UserRole> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, "Giriş başarısız. Kullanıcı adı veya şifreyi kontrol edin."));
  }
  const data = await res.json();
  localStorage.setItem("access_token", data.access_token);
  localStorage.setItem("user_role", data.user_role);
  return data.user_role;
}

export async function getMe(): Promise<MeResponse> {
  const res = await apiFetch(`${API_BASE}/auth/me`, { headers: authHeaders() }, "Kullanıcı bilgisi alınamadı.");
  if (!res.ok) {
    throw new Error(await readApiError(res, "Oturum geçersiz veya süresi dolmuş."));
  }
  return res.json();
}

export async function initUpload(payload: {
  country: string;
  city: string;
  region: string;
  no: string;
  original_filename: string;
  title?: string;
  note?: string;
}) {
  const res = await fetch(`${API_BASE}/uploads/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, "Yükleme başlatılamadı."));
  }
  return res.json();
}

export async function uploadFile(submissionId: number, file: File) {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${API_BASE}/uploads/${submissionId}/file`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });

  if (!res.ok) {
    throw new Error(await readApiError(res, "Video dosyası yüklenemedi."));
  }
  return res.json();
}

export async function completeUpload(submissionId: number) {
  const res = await fetch(`${API_BASE}/uploads/${submissionId}/complete`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, "Yükleme tamamlanamadı."));
  }
  return res.json();
}

export async function listMyUploads(limit = 20): Promise<SubmissionItem[]> {
  const res = await fetch(`${API_BASE}/uploads/mine?limit=${limit}`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, "Kendi kayıtlarınız alınamadı."));
  }
  return res.json();
}

export async function getMyUploadLogs(params?: {
  limit?: number;
  offset?: number;
  status?: string;
  date_from?: string;
  date_to?: string;
}): Promise<OperatorLogsResponse> {
  const qs = new URLSearchParams();
  if (params?.limit !== undefined) qs.set("limit", String(params.limit));
  if (params?.offset !== undefined) qs.set("offset", String(params.offset));
  if (params?.status) qs.set("status_filter", params.status);
  if (params?.date_from) qs.set("date_from", `${params.date_from}T00:00:00Z`);
  if (params?.date_to) qs.set("date_to", `${params.date_to}T23:59:59Z`);

  const query = qs.toString();
  const res = await fetch(`${API_BASE}/uploads/mine/logs${query ? `?${query}` : ""}`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, "Operatör logları alınamadı."));
  }
  return res.json();
}

export async function createUploadCancelRequest(
  submissionId: number,
  payload: { reason_type: "wrong_upload" | "duplicate_upload"; note: string }
) {
  const res = await fetch(`${API_BASE}/uploads/${submissionId}/requests/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, "Talep oluşturulamadı."));
  }
  return res.json();
}

export async function listSubmissions(filters?: {
  status?: string;
  region?: string;
  no?: string;
  date_from?: string;
  date_to?: string;
  min_quality?: number;
  max_quality?: number;
  sms_status?: string;
  risk_locked?: boolean;
  request_status?: "open" | "approved" | "rejected";
  claim_state?: "none" | "active" | "mine" | "other";
  sla_breached?: boolean;
  priority?: boolean;
}): Promise<SubmissionItem[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.region) params.set("region", filters.region);
  if (filters?.no) params.set("no", filters.no);
  if (filters?.date_from) params.set("date_from", `${filters.date_from}T00:00:00Z`);
  if (filters?.date_to) params.set("date_to", `${filters.date_to}T23:59:59Z`);
  if (filters?.min_quality !== undefined) params.set("min_quality", String(filters.min_quality));
  if (filters?.max_quality !== undefined) params.set("max_quality", String(filters.max_quality));
  if (filters?.sms_status) params.set("sms_status", filters.sms_status);
  if (filters?.risk_locked !== undefined) params.set("risk_locked", String(filters.risk_locked));
  if (filters?.request_status) params.set("request_status", filters.request_status);
  if (filters?.claim_state) params.set("claim_state", filters.claim_state);
  if (filters?.sla_breached !== undefined) params.set("sla_breached", String(filters.sla_breached));
  if (filters?.priority !== undefined) params.set("priority", String(filters.priority));

  const query = params.toString();
  const res = await apiFetch(`${API_BASE}/submissions${query ? `?${query}` : ""}`, {
    headers: authHeaders(),
    cache: "no-store",
  }, "Kayıt listesi alınamadı.");
  if (!res.ok) {
    throw new Error(await readApiError(res, "Kayıt listesi alınamadı."));
  }
  return res.json();
}

export async function getOpsOverview(limit = 20): Promise<OpsOverview> {
  const res = await apiFetch(`${API_BASE}/submissions/ops/overview?limit=${limit}`, {
    headers: authHeaders(),
    cache: "no-store",
  }, "Operasyon özeti alınamadı.");
  if (!res.ok) {
    throw new Error(await readApiError(res, "Operasyon özeti alınamadı."));
  }
  return res.json();
}

export async function getSubmission(id: number): Promise<SubmissionDetail> {
  const res = await apiFetch(`${API_BASE}/submissions/${id}`, {
    headers: authHeaders(),
    cache: "no-store",
  }, "Kayıt detayı alınamadı.");
  if (!res.ok) {
    throw new Error(await readApiError(res, "Kayıt detayı alınamadı."));
  }
  return res.json();
}

export async function deleteSubmission(submissionId: number) {
  const res = await apiFetch(`${API_BASE}/submissions/${submissionId}`, {
    method: "DELETE",
    headers: authHeaders(),
  }, "Kayıt silinemedi.");
  if (!res.ok) {
    throw new Error(await readApiError(res, "Kayıt silinemedi."));
  }
  return res.json();
}

export async function claimSubmission(submissionId: number, note?: string) {
  const res = await apiFetch(`${API_BASE}/submissions/${submissionId}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ note }),
  }, "Kayıt claim alınamadı.");
  if (!res.ok) {
    throw new Error(await readApiError(res, "Kayıt claim alınamadı."));
  }
  return res.json();
}

export async function releaseSubmissionClaim(submissionId: number) {
  const res = await apiFetch(`${API_BASE}/submissions/${submissionId}/claim`, {
    method: "DELETE",
    headers: authHeaders(),
  }, "Kayıt claim bırakılırken hata oluştu.");
  if (!res.ok) {
    throw new Error(await readApiError(res, "Kayıt claim bırakılırken hata oluştu."));
  }
  return res.json();
}

export async function getMyAdminLogs(params?: {
  limit?: number;
  action?: string;
  date_from?: string;
  date_to?: string;
  no?: string;
  region?: string;
}): Promise<AdminLogsResponse> {
  const qs = new URLSearchParams();
  if (params?.limit !== undefined) qs.set("limit", String(params.limit));
  if (params?.action) qs.set("action", params.action);
  if (params?.date_from) qs.set("date_from", `${params.date_from}T00:00:00Z`);
  if (params?.date_to) qs.set("date_to", `${params.date_to}T23:59:59Z`);
  if (params?.no) qs.set("no", params.no);
  if (params?.region) qs.set("region", params.region);
  const query = qs.toString();
  const res = await apiFetch(`${API_BASE}/submissions/admin-logs/mine${query ? `?${query}` : ""}`, {
    headers: authHeaders(),
    cache: "no-store",
  }, "Admin logları alınamadı.");
  if (!res.ok) {
    throw new Error(await readApiError(res, "Admin logları alınamadı."));
  }
  return res.json();
}

export async function reviewSubmission(id: number, decision: "approved" | "rejected", decision_note?: string) {
  const res = await apiFetch(`${API_BASE}/submissions/${id}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ decision, decision_note }),
  }, "İnceleme kararı kaydedilemedi.");

  if (!res.ok) {
    throw new Error(await readApiError(res, "İnceleme kararı kaydedilemedi."));
  }
  return res.json();
}

export async function updateSubmissionNo(submissionId: number, no: string, note?: string) {
  const res = await apiFetch(`${API_BASE}/submissions/${submissionId}/no/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ no, note }),
  }, "NO güncellenemedi.");
  if (!res.ok) {
    throw new Error(await readApiError(res, "NO güncellenemedi."));
  }
  return res.json();
}

export async function overrideSubmissionMatches(submissionId: number, donorRecordIds: number[], note?: string) {
  const res = await apiFetch(`${API_BASE}/submissions/${submissionId}/matches/override`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ donor_record_ids: donorRecordIds, note }),
  }, "Manuel eşleşme kaydedilemedi.");
  if (!res.ok) {
    throw new Error(await readApiError(res, "Manuel eşleşme kaydedilemedi."));
  }
  return res.json();
}

export async function sendSms(id: number) {
  const res = await apiFetch(`${API_BASE}/submissions/${id}/sms/send`, {
    method: "POST",
    headers: authHeaders(),
  }, "SMS gönderimi başarısız.");
  if (!res.ok) {
    throw new Error(await readApiError(res, "SMS gönderimi başarısız."));
  }
  return res.json();
}

export async function sendSmsToDonor(submissionId: number, donorRecordId: number) {
  const res = await apiFetch(`${API_BASE}/submissions/${submissionId}/sms/send-donor`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ donor_record_id: donorRecordId }),
  }, "Seçili kişiye SMS gönderilemedi.");
  if (!res.ok) {
    throw new Error(await readApiError(res, "Seçili kişiye SMS gönderilemedi."));
  }
  return res.json();
}

export async function sendSmsToSelectedDonors(submissionId: number, donorRecordIds: number[]) {
  const res = await apiFetch(`${API_BASE}/submissions/${submissionId}/sms/send-selected`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ donor_record_ids: donorRecordIds }),
  }, "Seçili kişilere SMS gönderilemedi.");
  if (!res.ok) {
    throw new Error(await readApiError(res, "Seçili kişilere SMS gönderilemedi."));
  }
  return res.json();
}

export async function createOperator(payload: {
  username: string;
  password: string;
  role?: "operator" | "admin";
  organization_name?: string;
  first_name: string;
  last_name: string;
  country: string;
  city: string;
  region: string;
}): Promise<OperatorAccount> {
  const res = await apiFetch(`${API_BASE}/superadmin/operators`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  }, "Hesap oluşturulamadı.");
  if (!res.ok) {
    throw new Error(await readApiError(res, "Hesap oluşturulamadı."));
  }
  return res.json();
}

export async function listOperators(): Promise<OperatorAccount[]> {
  const res = await apiFetch(`${API_BASE}/superadmin/operators`, {
    headers: authHeaders(),
    cache: "no-store",
  }, "Hesap listesi alınamadı.");
  if (!res.ok) {
    throw new Error(await readApiError(res, "Hesap listesi alınamadı."));
  }
  return res.json();
}

export async function getSuperadminAnalytics(): Promise<SuperadminAnalyticsOverview> {
  const res = await apiFetch(`${API_BASE}/superadmin/analytics/overview`, {
    headers: authHeaders(),
    cache: "no-store",
  }, "Süperadmin analitiği alınamadı.");
  if (!res.ok) {
    throw new Error(await readApiError(res, "Süperadmin analitiği alınamadı."));
  }
  return res.json();
}

export async function getSuperadminStatsDashboard(options?: {
  onlineWindowMinutes?: number;
  dateFrom?: string;
  dateTo?: string;
}): Promise<SuperadminStatsDashboard> {
  const onlineWindowMinutes = options?.onlineWindowMinutes ?? 15;
  const qs = new URLSearchParams();
  qs.set("online_window_minutes", String(onlineWindowMinutes));
  if (options?.dateFrom) qs.set("date_from", options.dateFrom);
  if (options?.dateTo) qs.set("date_to", options.dateTo);
  const res = await apiFetch(`${API_BASE}/superadmin/analytics/dashboard?${qs.toString()}`, {
    headers: authHeaders(),
    cache: "no-store",
  }, "Süperadmin dashboard istatistikleri alınamadı.");
  if (!res.ok) {
    throw new Error(await readApiError(res, "Süperadmin dashboard istatistikleri alınamadı."));
  }
  return res.json();
}

export async function getOperatorAnalyticsDetail(operatorId: number): Promise<OperatorAnalyticsDetail> {
  const res = await apiFetch(`${API_BASE}/superadmin/analytics/operators/${operatorId}`, {
    headers: authHeaders(),
    cache: "no-store",
  }, "Operatör detay analitiği alınamadı.");
  if (!res.ok) {
    throw new Error(await readApiError(res, "Operatör detay analitiği alınamadı."));
  }
  return res.json();
}

export async function updateOperatorStatus(operatorId: number, isActive: boolean): Promise<OperatorAccount> {
  const res = await apiFetch(`${API_BASE}/superadmin/operators/${operatorId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ is_active: isActive }),
  }, "Hesap durumu güncellenemedi.");
  if (!res.ok) {
    throw new Error(await readApiError(res, "Hesap durumu güncellenemedi."));
  }
  return res.json();
}

export async function resetOperatorPassword(operatorId: number, newPassword: string): Promise<OperatorAccount> {
  const res = await apiFetch(`${API_BASE}/superadmin/operators/${operatorId}/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ new_password: newPassword }),
  }, "Hesap şifresi güncellenemedi.");
  if (!res.ok) {
    throw new Error(await readApiError(res, "Hesap şifresi güncellenemedi."));
  }
  return res.json();
}

export async function updateOperator(
  operatorId: number,
  payload: {
    username: string;
    role: "operator" | "admin";
    first_name: string;
    last_name: string;
    country: string;
    city: string;
    region: string;
  }
): Promise<OperatorAccount> {
  const res = await apiFetch(`${API_BASE}/superadmin/operators/${operatorId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  }, "Hesap bilgileri güncellenemedi.");
  if (!res.ok) {
    throw new Error(await readApiError(res, "Hesap bilgileri güncellenemedi."));
  }
  return res.json();
}

export async function retryFailedSms(submissionId: number) {
  const res = await apiFetch(`${API_BASE}/submissions/${submissionId}/sms/retry-failed`, {
    method: "POST",
    headers: authHeaders(),
  }, "Başarısız SMS kayıtları yeniden denenemedi.");
  if (!res.ok) {
    throw new Error(await readApiError(res, "Başarısız SMS kayıtları yeniden denenemedi."));
  }
  return res.json();
}

export async function listSubmissionRequests(status?: "open" | "approved" | "rejected"): Promise<SubmissionChangeRequestItem[]> {
  const qs = status ? `?status=${status}` : "";
  let res = await apiFetch(`${API_BASE}/submissions/requests/list${qs}`, {
    headers: authHeaders(),
    cache: "no-store",
  }, "Talep listesi alınamadı.");
  let usedLegacyPath = false;
  if (res.status === 404) {
    usedLegacyPath = true;
    res = await apiFetch(`${API_BASE}/submissions/requests${qs}`, {
      headers: authHeaders(),
      cache: "no-store",
    }, "Talep listesi alınamadı.");
  }
  if (usedLegacyPath && res.status === 422) {
    throw new Error("Backend eski route ile çalışıyor. Sunucuyu yeniden başlatıp tekrar deneyin.");
  }
  if (!res.ok) {
    throw new Error(await readApiError(res, "Talep listesi alınamadı."));
  }
  return res.json();
}

export async function resolveSubmissionRequest(
  requestId: number,
  payload: { decision: "approved" | "rejected"; decision_note: string }
): Promise<SubmissionChangeRequestItem> {
  const res = await apiFetch(`${API_BASE}/submissions/requests/${requestId}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  }, "Talep çözümlenemedi.");
  if (!res.ok) {
    throw new Error(await readApiError(res, "Talep çözümlenemedi."));
  }
  return res.json();
}

export async function overrideSubmissionRisk(submissionId: number, note: string) {
  const res = await apiFetch(`${API_BASE}/submissions/${submissionId}/risk/override`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ note }),
  }, "Risk kilidi kaldırılamadı.");
  if (!res.ok) {
    throw new Error(await readApiError(res, "Risk kilidi kaldırılamadı."));
  }
  return res.json();
}

export async function importDonorDb(file: File): Promise<ImportResponse> {
  const form = new FormData();
  form.append("file", file);

  const res = await apiFetch(`${API_BASE}/db/import`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  }, "Donor DB import başarısız.");
  if (!res.ok) {
    throw new Error(await readApiError(res, "Donor DB import başarısız."));
  }
  return res.json();
}

export function logout() {
  localStorage.removeItem("access_token");
  localStorage.removeItem("user_role");
}
