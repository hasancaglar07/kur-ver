"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ArrowClockwise, WarningCircle, X } from "@phosphor-icons/react";

import { QualityTag } from "@/components/QualityTag";
import {
  createOperator,
  getMe,
  getSuperadminAnalytics,
  listOperators,
  listSubmissionRequests,
  listSubmissions,
  resolveSubmissionRequest,
  reviewSubmission,
  resetOperatorPassword,
  retryFailedSms,
  sendSms,
  updateOperator,
  updateOperatorStatus,
} from "@/lib/api";
import { useFeedback } from "@/components/ui/feedback-center";
import type { OperatorAccount, SubmissionChangeRequestItem, SubmissionItem, SuperadminAnalyticsOverview, UserRole } from "@/lib/types";
import { pushUserAction } from "@/lib/userActions";

type AdminTab = "queue" | "operators";
type AccountRoleFilter = "all" | "operator" | "admin";
type AccountStatusFilter = "all" | "active" | "passive";
type AccountSortBy = "created_at" | "username" | "full_name" | "country" | "city" | "role";
type AccountSortDir = "asc" | "desc";

const statusLabels: Record<string, string> = {
  uploaded: "Yüklendi",
  processing: "İşleniyor",
  review_ready: "İncelemeye Hazır",
  approved: "Onaylandı",
  rejected: "Reddedildi",
  failed: "Hata",
};

const statusBadgeClass: Record<string, string> = {
  failed: "saas-badge-error",
  approved: "saas-badge-success",
  review_ready: "saas-badge-info",
};

const adminActionLabels: Record<string, string> = {
  submission_reviewed: "İnceleme",
  sms_dispatched: "Toplu SMS",
  sms_dispatched_single: "Tekli SMS",
  sms_dispatched_selected: "Seçili SMS",
  sms_retry_failed: "SMS Retry",
  submission_change_request_resolved: "Talep Çözüm",
  submission_risk_overridden: "Risk Override",
};

function toErrorMessage(err: unknown, fallback: string): string {
  const normalize = (value: string) => {
    const text = value.trim();
    if (!text) return fallback;
    if (text === "[object Object]" || text === "{}" || text === "null" || text === "undefined") return fallback;
    return text;
  };

  if (err instanceof Error) {
    if (typeof err.message === "string") return normalize(err.message);
    return fallback;
  }
  if (typeof err === "string") return normalize(err);
  if (err && typeof err === "object") {
    const maybeMessage = (err as { message?: unknown; detail?: unknown }).message ?? (err as { detail?: unknown }).detail;
    if (typeof maybeMessage === "string") return normalize(maybeMessage);
    if (Array.isArray(maybeMessage)) {
      const joined = maybeMessage
        .map((item) => {
          if (typeof item === "string") return item.trim();
          if (item && typeof item === "object") {
            const msg = (item as { msg?: unknown; detail?: unknown }).msg ?? (item as { detail?: unknown }).detail;
            return typeof msg === "string" ? msg.trim() : "";
          }
          return "";
        })
        .filter(Boolean)
        .join(" | ");
      if (joined) return normalize(joined);
    }
  }
  return fallback;
}

export default function AdminPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const feedbackUi = useFeedback();

  const [rows, setRows] = useState<SubmissionItem[]>([]);
  const [openRequests, setOpenRequests] = useState<SubmissionChangeRequestItem[]>([]);
  const [feedback, setFeedback] = useState<{ type: "error" | "info"; message: string } | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [operators, setOperators] = useState<OperatorAccount[]>([]);
  const [analytics, setAnalytics] = useState<SuperadminAnalyticsOverview | null>(null);
  const [operatorBusy, setOperatorBusy] = useState(false);
  const [operatorActionBusyId, setOperatorActionBusyId] = useState<number | null>(null);
  const [operatorEditId, setOperatorEditId] = useState<number | null>(null);
  const [operatorEditForm, setOperatorEditForm] = useState({
    username: "",
    role: "operator" as "operator" | "admin",
    first_name: "",
    last_name: "",
    country: "",
    city: "",
    region: "",
  });
  const [operatorForm, setOperatorForm] = useState({
    username: "",
    password: "",
    role: "operator" as "operator" | "admin",
    first_name: "",
    last_name: "",
    country: "",
    city: "",
    region: "",
  });
  const [accountSearch, setAccountSearch] = useState("");
  const [accountRoleFilter, setAccountRoleFilter] = useState<AccountRoleFilter>("all");
  const [accountStatusFilter, setAccountStatusFilter] = useState<AccountStatusFilter>("all");
  const [accountSortBy, setAccountSortBy] = useState<AccountSortBy>("created_at");
  const [accountSortDir, setAccountSortDir] = useState<AccountSortDir>("desc");

  const [statusFilter, setStatusFilter] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [noFilter, setNoFilter] = useState("");
  const [smsFilter, setSmsFilter] = useState("");
  const [riskFilter, setRiskFilter] = useState<"" | "true" | "false">("");
  const [requestStatusFilter, setRequestStatusFilter] = useState<"" | "open" | "approved" | "rejected">("");
  const [claimStateFilter, setClaimStateFilter] = useState<"" | "none" | "active" | "mine" | "other">("");
  const [slaFilter, setSlaFilter] = useState<"" | "true" | "false">("");
  const [dateFromFilter, setDateFromFilter] = useState("");
  const [dateToFilter, setDateToFilter] = useState("");
  const [minQualityFilter, setMinQualityFilter] = useState("");
  const [maxQualityFilter, setMaxQualityFilter] = useState("");
  const [quickSmsSendingId, setQuickSmsSendingId] = useState<number | null>(null);
  const [previewRow, setPreviewRow] = useState<SubmissionItem | null>(null);
  const [selectedSubmissionIds, setSelectedSubmissionIds] = useState<number[]>([]);
  const [batchBusy, setBatchBusy] = useState<null | "approve" | "reject" | "retry_sms">(null);
  const [batchFailureIds, setBatchFailureIds] = useState<number[]>([]);
  const [focusedRowIndex, setFocusedRowIndex] = useState(0);

  const [activeTab, setActiveTab] = useState<AdminTab>("queue");
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [requestBusyId, setRequestBusyId] = useState<number | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    if (!feedback) return;
    feedbackUi.notify({
      tone: feedback.type === "error" ? "error" : "success",
      title: feedback.type === "error" ? "İşlem Hatası" : "İşlem Tamamlandı",
      description: feedback.message,
    });
  }, [feedback, feedbackUi]);

  useEffect(() => {
    getMe()
      .then((me) => {
        setUserRole(me.role);
      })
      .catch((err) => setFeedback({ type: "error", message: toErrorMessage(err, "Kullanıcı bilgisi alınamadı.") }));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab");
    const nextTab: AdminTab = tabParam === "operators" ? "operators" : "queue";
    const status = params.get("status") ?? "";
    const no = params.get("no") ?? "";
    const region = params.get("region") ?? "";
    const dateFrom = params.get("date_from") ?? "";
    const dateTo = params.get("date_to") ?? "";
    setActiveTab(nextTab);
    setStatusFilter(status);
    setDateFromFilter(dateFrom);
    setDateToFilter(dateTo);
    setNoFilter(no);
    setRegionFilter(region);
    setRiskFilter((params.get("risk_locked") as "" | "true" | "false") ?? "");
    setRequestStatusFilter((params.get("request_status") as "" | "open" | "approved" | "rejected") ?? "");
    setClaimStateFilter((params.get("claim_state") as "" | "none" | "active" | "mine" | "other") ?? "");
    setSlaFilter((params.get("sla_breached") as "" | "true" | "false") ?? "");
  }, []);

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    const nextTab: AdminTab = tabParam === "operators" ? "operators" : "queue";
    setActiveTab((prev) => (prev === nextTab ? prev : nextTab));
  }, [searchParams]);

  useEffect(() => {
    const validIds = new Set(rows.map((row) => row.id));
    setSelectedSubmissionIds((prev) => prev.filter((id) => validIds.has(id)));
  }, [rows]);

  useEffect(() => {
    if (rows.length === 0) {
      setFocusedRowIndex(0);
      return;
    }
    setFocusedRowIndex((prev) => Math.max(0, Math.min(prev, rows.length - 1)));
  }, [rows]);

  useEffect(() => {
    if (!userRole) return;
    if (userRole === "operator") {
      router.replace("/uploader");
      return;
    }
    if (userRole !== "super_admin" && activeTab !== "queue") {
      setActiveTab("queue");
      router.replace("/admin");
    }
  }, [activeTab, router, userRole]);

  const loadSuperadminData = async () => {
    const [operatorList, analyticsData] = await Promise.all([listOperators(), getSuperadminAnalytics()]);
    setOperators(operatorList);
    setAnalytics(analyticsData);
  };

  useEffect(() => {
    if (userRole === "super_admin") {
      loadSuperadminData().catch((err) => setFeedback({ type: "error", message: toErrorMessage(err, "Süperadmin verileri alınamadı.") }));
    }
  }, [userRole]);

  const refreshQueueData = useCallback(async () => {
    const [submissions, requests] = await Promise.all([
      listSubmissions({
        status: statusFilter || undefined,
        region: regionFilter || undefined,
        no: noFilter || undefined,
        sms_status: smsFilter || undefined,
        risk_locked: riskFilter ? riskFilter === "true" : undefined,
        request_status: requestStatusFilter || undefined,
        claim_state: claimStateFilter || undefined,
        sla_breached: slaFilter ? slaFilter === "true" : undefined,
        priority: true,
        date_from: dateFromFilter || undefined,
        date_to: dateToFilter || undefined,
        min_quality: minQualityFilter ? Number(minQualityFilter) : undefined,
        max_quality: maxQualityFilter ? Number(maxQualityFilter) : undefined,
      }),
      listSubmissionRequests("open"),
    ]);
    setRows(submissions);
    setOpenRequests(requests);
    setLastSyncAt(new Date().toISOString());
  }, [
    claimStateFilter,
    slaFilter,
    dateFromFilter,
    dateToFilter,
    maxQualityFilter,
    minQualityFilter,
    noFilter,
    regionFilter,
    requestStatusFilter,
    riskFilter,
    smsFilter,
    statusFilter,
  ]);

  const onResolveRequest = async (requestId: number, decision: "approved" | "rejected") => {
    const note = await feedbackUi.prompt({
      title: decision === "approved" ? "Talep Onayı Notu" : "Talep Red Notu",
      description: decision === "approved" ? "Kayıt reddedilecek. Lütfen karar notunu girin." : "Kayıt incelemeye geri dönecek. Lütfen red notunu girin.",
      minLength: 3,
      placeholder: "Karar notu",
      confirmText: "Gönder",
    });
    if (!note) {
      return;
    }
    setRequestBusyId(requestId);
    try {
      await resolveSubmissionRequest(requestId, { decision, decision_note: note.trim() });
      setFeedback({ type: "info", message: "Talep işlendi." });
      await refreshQueueData();
    } catch (err) {
      setFeedback({ type: "error", message: toErrorMessage(err, "Talep işlenemedi.") });
    } finally {
      setRequestBusyId(null);
    }
  };

  useEffect(() => {
    refreshQueueData().catch((err) => setFeedback({ type: "error", message: toErrorMessage(err, "Kuyruk verisi alınamadı.") }));
  }, [refreshQueueData]);

  useEffect(() => {
    if (!autoRefreshEnabled || activeTab !== "queue") return;
    const timer = window.setInterval(() => {
      refreshQueueData().catch((err) => setFeedback({ type: "error", message: toErrorMessage(err, "Otomatik yenilemede hata oluştu.") }));
    }, 20000);
    return () => window.clearInterval(timer);
  }, [activeTab, autoRefreshEnabled, refreshQueueData]);

  const onManualRefresh = async () => {
    setRefreshBusy(true);
    try {
      await refreshQueueData();
      setFeedback({ type: "info", message: "Kuyruk güncellendi." });
    } catch (err) {
      setFeedback({ type: "error", message: toErrorMessage(err, "Kuyruk güncellenemedi.") });
    } finally {
      setRefreshBusy(false);
    }
  };

  const activeFilterCount = useMemo(
    () =>
      [statusFilter, regionFilter, noFilter, smsFilter, riskFilter, requestStatusFilter, claimStateFilter, dateFromFilter, dateToFilter, minQualityFilter, maxQualityFilter]
        .filter(Boolean).length,
    [statusFilter, regionFilter, noFilter, smsFilter, riskFilter, requestStatusFilter, claimStateFilter, slaFilter, dateFromFilter, dateToFilter, minQualityFilter, maxQualityFilter]
  );
  const slaBreachedCount = useMemo(() => rows.filter((item) => item.sla_breached).length, [rows]);
  const topSlaBreachedRows = useMemo(() => rows.filter((item) => item.sla_breached).slice(0, 5), [rows]);

  const clearFilters = () => {
    setStatusFilter("");
    setRegionFilter("");
    setNoFilter("");
    setSmsFilter("");
    setRiskFilter("");
    setRequestStatusFilter("");
    setClaimStateFilter("");
    setSlaFilter("");
    setDateFromFilter("");
    setDateToFilter("");
    setMinQualityFilter("");
    setMaxQualityFilter("");
  };

  const setReviewReadyTodayFilter = () => {
    const today = new Date().toISOString().slice(0, 10);
    setStatusFilter("review_ready");
    setDateFromFilter(today);
    setDateToFilter(today);
    setNoFilter("");
    setRegionFilter("");
    setSmsFilter("");
    setRiskFilter("");
    setRequestStatusFilter("");
    setClaimStateFilter("");
    setSlaFilter("");
    setMinQualityFilter("");
    setMaxQualityFilter("");
  };

  const onQuickSendSms = async (row: SubmissionItem) => {
    if (row.risk_locked) {
      setFeedback({ type: "error", message: "Kayıt risk kilidinde. Önce talebi çözün veya risk override yapın." });
      return;
    }
    if (row.status !== "approved") {
      setFeedback({ type: "error", message: "Hızlı SMS sadece onaylı kayıtlar için kullanılabilir." });
      return;
    }

    setQuickSmsSendingId(row.id);
    try {
      const res = await sendSms(row.id);
      await refreshQueueData();
      setFeedback({ type: "info", message: `Kayıt #${row.id} için SMS gönderildi. Başarılı: ${res.sent_count}, başarısız: ${res.failed_count}` });
      pushUserAction({
        type: "sms_sent",
        label: `Kayıt #${row.id} için SMS gönderildi`,
        href: `/admin/${row.id}`,
      });
    } catch (err) {
      setFeedback({ type: "error", message: toErrorMessage(err, "SMS gönderimi başarısız") });
    } finally {
      setQuickSmsSendingId(null);
    }
  };

  const onShortcutReview = async (row: SubmissionItem, decision: "approved" | "rejected") => {
    if (row.risk_locked && decision === "approved") {
      setFeedback({ type: "error", message: "Risk kilidindeki kayıt doğrudan onaylanamaz." });
      return;
    }
    try {
      let decisionNote: string | undefined;
      if (decision === "rejected") {
        const input = await feedbackUi.prompt({
          title: "Reddetme Nedeni",
          description: "Kayıdı reddetmek için neden/admin raporu zorunlu.",
          minLength: 1,
          placeholder: "Red nedeni / admin raporu",
          confirmText: "Reddet",
        });
        if (!input) {
          return;
        }
        decisionNote = input;
      }
      await reviewSubmission(row.id, decision, decisionNote);
      await refreshQueueData();
      setFeedback({
        type: "info",
        message: decision === "approved" ? `Kayıt #${row.id} onaylandı.` : `Kayıt #${row.id} reddedildi.`,
      });
    } catch (err) {
      setFeedback({ type: "error", message: toErrorMessage(err, "Kısayol işlemi başarısız.") });
    }
  };

  const toggleSubmissionSelection = (id: number) => {
    setSelectedSubmissionIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const selectAllVisible = () => {
    setSelectedSubmissionIds(rows.map((row) => row.id));
  };

  const clearSelection = () => {
    setSelectedSubmissionIds([]);
  };

  const getSelectedRows = () => {
    const selectedSet = new Set(selectedSubmissionIds);
    return rows.filter((row) => selectedSet.has(row.id));
  };

  const runBulkReview = async (decision: "approved" | "rejected") => {
    if (selectedSubmissionIds.length === 0) {
      setFeedback({ type: "error", message: "Önce en az bir kayıt seçin." });
      return;
    }
    const selectedRows = getSelectedRows();
    if (selectedRows.length === 0) {
      setFeedback({ type: "error", message: "Seçili kayıtlar listede bulunamadı. Listeyi yenileyin." });
      return;
    }

    const eligibleRows =
      decision === "approved" ? selectedRows.filter((row) => !row.risk_locked) : selectedRows;
    const blockedRows =
      decision === "approved" ? selectedRows.filter((row) => row.risk_locked) : [];

    if (eligibleRows.length === 0) {
      setFeedback({ type: "error", message: "Toplu onay için uygun kayıt yok. Risk kilitli kayıtlar hariç tutuldu." });
      return;
    }

    const actionLabel = decision === "approved" ? "onay" : "red";
    const confirmed = await feedbackUi.confirm({
      title: "Toplu İşlem Onayı",
      description:
        decision === "approved"
          ? `Seçili ${selectedRows.length} kaydın ${eligibleRows.length} adedi onaya uygun, ${blockedRows.length} adedi risk kilidi nedeniyle atlanacak. Devam edilsin mi?`
          : `Seçili ${selectedRows.length} kayıt için toplu ${actionLabel} işlemi yapılsın mı?`,
      confirmText: "Evet, uygula",
      cancelText: "Vazgeç",
      tone: "warn",
    });
    if (!confirmed) return;

    setBatchBusy(decision === "approved" ? "approve" : "reject");
    setBatchFailureIds([]);
    try {
      let successCount = 0;
      let failCount = 0;
      const failedIds: number[] = [];
      let bulkNote: string | undefined;
      if (decision === "rejected") {
        const input = await feedbackUi.prompt({
          title: "Toplu Red Nedeni",
          description: "Toplu red için neden/admin raporu girin.",
          minLength: 1,
          placeholder: "Toplu red notu",
          confirmText: "Devam et",
        });
        if (!input) {
          setBatchBusy(null);
          return;
        }
        bulkNote = input;
      }
      for (const row of eligibleRows) {
        try {
          await reviewSubmission(row.id, decision, bulkNote);
          successCount += 1;
        } catch {
          failCount += 1;
          failedIds.push(row.id);
        }
      }
      await refreshQueueData();
      setBatchFailureIds(failedIds);
      const skippedInfo = decision === "approved" && blockedRows.length > 0 ? `, atlanan ${blockedRows.length}` : "";
      setFeedback({
        type: failCount > 0 ? "error" : "info",
        message: `Toplu ${actionLabel}: başarılı ${successCount}, başarısız ${failCount}${skippedInfo}`,
      });
      pushUserAction({
        type: decision === "approved" ? "bulk_approved" : "bulk_rejected",
        label: `Toplu ${actionLabel}: ${successCount} kayıt`,
        href: "/admin",
      });
      clearSelection();
    } catch (err) {
      setFeedback({ type: "error", message: toErrorMessage(err, "Toplu işlem sırasında hata oluştu.") });
    } finally {
      setBatchBusy(null);
    }
  };

  const runBulkRetrySms = async () => {
    if (selectedSubmissionIds.length === 0) {
      setFeedback({ type: "error", message: "Önce en az bir kayıt seçin." });
      return;
    }
    const selectedRows = getSelectedRows();
    if (selectedRows.length === 0) {
      setFeedback({ type: "error", message: "Seçili kayıtlar listede bulunamadı. Listeyi yenileyin." });
      return;
    }
    const eligibleRows = selectedRows.filter((row) => row.sms_failed_count > 0);
    const blockedRows = selectedRows.filter((row) => row.sms_failed_count === 0);
    if (eligibleRows.length === 0) {
      setFeedback({ type: "error", message: "Retry için başarısız SMS içeren kayıt yok." });
      return;
    }
    const confirmed = await feedbackUi.confirm({
      title: "Toplu SMS Retry",
      description: `Seçili ${selectedRows.length} kaydın ${eligibleRows.length} adedinde başarısız SMS var, ${blockedRows.length} adedi atlanacak. Retry başlatılsın mı?`,
      confirmText: "Retry başlat",
      cancelText: "İptal",
      tone: "warn",
    });
    if (!confirmed) return;
    setBatchBusy("retry_sms");
    setBatchFailureIds([]);
    try {
      let successCount = 0;
      let failCount = 0;
      const failedIds: number[] = [];
      for (const row of eligibleRows) {
        try {
          await retryFailedSms(row.id);
          successCount += 1;
        } catch {
          failCount += 1;
          failedIds.push(row.id);
        }
      }
      await refreshQueueData();
      setBatchFailureIds(failedIds);
      setFeedback({
        type: failCount > 0 ? "error" : "info",
        message: `Toplu SMS retry: başarılı ${successCount}, başarısız ${failCount}, atlanan ${blockedRows.length}`,
      });
      pushUserAction({
        type: "bulk_sms_retry",
        label: `Toplu SMS retry: ${successCount} kayıt`,
        href: "/admin",
      });
      clearSelection();
    } catch (err) {
      setFeedback({ type: "error", message: toErrorMessage(err, "Toplu SMS retry sırasında hata oluştu.") });
    } finally {
      setBatchBusy(null);
    }
  };

  useEffect(() => {
    if (activeTab !== "queue") return;

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTyping = tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable;
      if (isTyping) return;
      if (rows.length === 0) return;

      const key = event.key.toLowerCase();
      if (key === "j") {
        event.preventDefault();
        setFocusedRowIndex((prev) => Math.min(prev + 1, rows.length - 1));
        return;
      }
      if (key === "k") {
        event.preventDefault();
        setFocusedRowIndex((prev) => Math.max(prev - 1, 0));
        return;
      }

      const row = rows[Math.max(0, Math.min(focusedRowIndex, rows.length - 1))];
      if (!row) return;

      if (key === "a") {
        event.preventDefault();
        void onShortcutReview(row, "approved");
      } else if (key === "r") {
        event.preventDefault();
        void onShortcutReview(row, "rejected");
      } else if (key === "s") {
        event.preventDefault();
        void onQuickSendSms(row);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTab, focusedRowIndex, onQuickSendSms, onShortcutReview, rows]);

  const onCreateOperator = async (e: FormEvent) => {
    e.preventDefault();
    setOperatorBusy(true);
    try {
      await createOperator(operatorForm);
      await loadSuperadminData();
      setOperatorForm({ username: "", password: "", role: "operator", first_name: "", last_name: "", country: "", city: "", region: "" });
      setFeedback({ type: "info", message: operatorForm.role === "admin" ? "Admin hesabı oluşturuldu." : "Operatör hesabı oluşturuldu." });
    } catch (err) {
      setFeedback({ type: "error", message: toErrorMessage(err, "Hesap oluşturulamadı") });
    } finally {
      setOperatorBusy(false);
    }
  };

  const onToggleOperatorStatus = async (operatorId: number, isActive: boolean) => {
    setOperatorActionBusyId(operatorId);
    try {
      await updateOperatorStatus(operatorId, !isActive);
      await loadSuperadminData();
    } catch (err) {
      setFeedback({ type: "error", message: toErrorMessage(err, "Durum güncellenemedi") });
    } finally {
      setOperatorActionBusyId(null);
    }
  };

  const onResetOperatorPassword = async (operatorId: number) => {
    const nextPassword = await feedbackUi.prompt({
      title: "Şifre Güncelle",
      description: "Yeni şifreyi girin (minimum 8 karakter).",
      minLength: 8,
      placeholder: "Yeni şifre",
      confirmText: "Güncelle",
    });
    if (!nextPassword) return;
    setOperatorActionBusyId(operatorId);
    try {
      await resetOperatorPassword(operatorId, nextPassword);
      await loadSuperadminData();
      setFeedback({ type: "info", message: `Hesap #${operatorId} şifresi güncellendi.` });
    } catch (err) {
      setFeedback({ type: "error", message: toErrorMessage(err, "Şifre güncellenemedi") });
    } finally {
      setOperatorActionBusyId(null);
    }
  };

  const onStartOperatorEdit = (op: OperatorAccount) => {
    setOperatorEditId(op.id);
    setOperatorEditForm({
      username: op.username ?? "",
      role: op.role === "admin" ? "admin" : "operator",
      first_name: op.first_name ?? "",
      last_name: op.last_name ?? "",
      country: op.country ?? "",
      city: op.city ?? "",
      region: op.region ?? "",
    });
  };

  const onCancelOperatorEdit = () => {
    setOperatorEditId(null);
    setOperatorEditForm({
      username: "",
      role: "operator",
      first_name: "",
      last_name: "",
      country: "",
      city: "",
      region: "",
    });
  };

  const onSaveOperatorEdit = async (operatorId: number) => {
    const username = operatorEditForm.username.trim();
    if (!username) {
      setFeedback({ type: "error", message: "Kullanıcı adı boş olamaz." });
      return;
    }
    setOperatorActionBusyId(operatorId);
    try {
      await updateOperator(operatorId, {
        username,
        role: operatorEditForm.role,
        first_name: operatorEditForm.first_name.trim(),
        last_name: operatorEditForm.last_name.trim(),
        country: operatorEditForm.country.trim(),
        city: operatorEditForm.city.trim(),
        region: operatorEditForm.region.trim(),
      });
      await loadSuperadminData();
      setFeedback({ type: "info", message: `Hesap #${operatorId} bilgileri güncellendi.` });
      onCancelOperatorEdit();
    } catch (err) {
      setFeedback({ type: "error", message: toErrorMessage(err, "Hesap bilgileri güncellenemedi.") });
    } finally {
      setOperatorActionBusyId(null);
    }
  };

  const filteredOperators = useMemo(() => {
    const q = accountSearch.trim().toLocaleLowerCase("tr-TR");
    const rows = operators.filter((op) => {
      if (accountRoleFilter !== "all" && op.role !== accountRoleFilter) return false;
      if (accountStatusFilter === "active" && !op.is_active) return false;
      if (accountStatusFilter === "passive" && op.is_active) return false;
      if (!q) return true;
      const fullName = `${op.first_name ?? ""} ${op.last_name ?? ""}`.trim();
      const haystack = [op.username, fullName, op.country ?? "", op.city ?? "", op.region ?? "", op.role]
        .join(" ")
        .toLocaleLowerCase("tr-TR");
      return haystack.includes(q);
    });

    const collator = new Intl.Collator("tr-TR");
    rows.sort((a, b) => {
      const direction = accountSortDir === "asc" ? 1 : -1;
      if (accountSortBy === "created_at") {
        const left = new Date(a.created_at).getTime();
        const right = new Date(b.created_at).getTime();
        return (left - right) * direction;
      }
      if (accountSortBy === "full_name") {
        const left = `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim();
        const right = `${b.first_name ?? ""} ${b.last_name ?? ""}`.trim();
        return collator.compare(left || "-", right || "-") * direction;
      }
      const leftValue =
        accountSortBy === "country"
          ? a.country ?? ""
          : accountSortBy === "city"
            ? a.city ?? ""
            : accountSortBy === "role"
              ? a.role
              : a.username;
      const rightValue =
        accountSortBy === "country"
          ? b.country ?? ""
          : accountSortBy === "city"
            ? b.city ?? ""
            : accountSortBy === "role"
              ? b.role
              : b.username;
      return collator.compare(leftValue || "-", rightValue || "-") * direction;
    });
    return rows;
  }, [accountRoleFilter, accountSearch, accountSortBy, accountSortDir, accountStatusFilter, operators]);

  return (
    <main className="w-full max-w-full overflow-x-hidden">
      <section className="mx-auto w-full max-w-[1680px] space-y-5 py-4">
        {activeTab === "operators" && (
          <header className="rounded-[14px] border border-[#E6E8E5] bg-white p-6">
            <h1 className="text-[clamp(2.1rem,4vw,3.2rem)] font-semibold tracking-[-0.02em] text-[#111111]">Operatör Yönetimi</h1>
            <p className="mt-2 max-w-4xl text-[16px] leading-relaxed text-[#4B4F52]">
              Operatör ve admin hesaplarını, aktiflik durumlarını ve şifre güncellemelerini bu ekrandan yönetin.
            </p>
          </header>
        )}

        {feedback && (
          <div
            className={`inline-flex items-center gap-1 rounded-[8px] border px-3 py-2 text-[16px] ${
              feedback.type === "error" ? "border-[#FDEBEC] bg-[#FDEBEC] text-[#9F2F2D]" : "border-[#EDF3EC] bg-[#EDF3EC] text-[#346538]"
            }`}
          >
            {feedback.type === "error" && <WarningCircle size={14} />}
            {feedback.message}
          </div>
        )}

        {activeTab === "queue" && (
          <>
            {/* ── Command Bar ── */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[#EAEAEA] bg-white px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[28px] font-bold leading-none text-[#111111]">{rows.length}</span>
                  <span className="text-[13px] text-[#787774]">kayıt</span>
                </div>
                {slaBreachedCount > 0 && (
                  <div className="flex items-baseline gap-1 rounded-full bg-[#FFF3CD] px-3 py-1">
                    <span className="text-[20px] font-bold leading-none text-[#8E5A00]">{slaBreachedCount}</span>
                    <span className="text-[12px] font-semibold text-[#8E5A00]">SLA</span>
                  </div>
                )}
                {openRequests.length > 0 && (
                  <div className="flex items-baseline gap-1 rounded-full bg-[#FDEDED] px-3 py-1">
                    <span className="text-[20px] font-bold leading-none text-[#9D3438]">{openRequests.length}</span>
                    <span className="text-[12px] font-semibold text-[#9D3438]">talep</span>
                  </div>
                )}
                <span className="hidden text-[12px] text-[#787774] sm:inline">
                  {lastSyncAt ? new Date(lastSyncAt).toLocaleTimeString("tr-TR") : "–"}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="hidden rounded-[6px] bg-[#F3F3F1] px-2.5 py-1 text-[12px] font-medium text-[#5A6063] sm:inline">
                  <strong>J/K</strong> satır · <strong>A</strong> onayla · <strong>R</strong> reddet · <strong>S</strong> SMS
                </span>
                <button
                  type="button"
                  onClick={setReviewReadyTodayFilter}
                  className="inline-flex h-9 items-center rounded-[6px] bg-[#111111] px-3 text-[13px] font-semibold text-white"
                >
                  Hazır Kayıtlar
                </button>
                <button
                  type="button"
                  onClick={onManualRefresh}
                  disabled={refreshBusy}
                  className="inline-flex h-9 items-center gap-1 rounded-[6px] border border-[#EAEAEA] bg-white px-3 text-[13px] font-medium text-[#2F3437] disabled:opacity-50"
                >
                  <ArrowClockwise size={13} className={refreshBusy ? "animate-spin" : ""} />
                  {refreshBusy ? "..." : "Yenile"}
                </button>
                <button
                  type="button"
                  onClick={() => setAutoRefreshEnabled((p) => !p)}
                  className={`inline-flex h-9 items-center rounded-[6px] px-3 text-[13px] font-medium ${autoRefreshEnabled ? "bg-[#E8F5E9] text-[#2E7D32]" : "border border-[#EAEAEA] bg-white text-[#787774]"}`}
                >
                  Auto {autoRefreshEnabled ? "Açık" : "Kapalı"}
                </button>
                <button
                  type="button"
                  onClick={() => setFiltersOpen((p) => !p)}
                  className={`inline-flex h-9 items-center gap-1 rounded-[6px] border px-3 text-[13px] font-semibold ${activeFilterCount > 0 ? "border-[#2E7D32] bg-[#F0F9F1] text-[#2E7D32]" : "border-[#EAEAEA] bg-white text-[#4B4F52]"}`}
                >
                  Filtrele {activeFilterCount > 0 && <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#2E7D32] text-[10px] font-bold text-white">{activeFilterCount}</span>}
                </button>
              </div>
            </div>

            {/* ── Filter Panel (collapsible) ── */}
            {filtersOpen && (
              <div className="rounded-[12px] border border-[#E0EBE1] bg-[#F8FBF8] p-4">
                <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
                  <FilterField label="Durum">
                    <Select value={statusFilter} onChange={setStatusFilter}>
                      <option value="">Tümü</option>
                      <option value="uploaded">Yüklendi</option>
                      <option value="processing">İşleniyor</option>
                      <option value="review_ready">Hazır</option>
                      <option value="approved">Onaylandı</option>
                      <option value="rejected">Reddedildi</option>
                      <option value="failed">Hata</option>
                    </Select>
                  </FilterField>
                  <FilterField label="NO">
                    <Input value={noFilter} onChange={setNoFilter} placeholder="Örn: 99" />
                  </FilterField>
                  <FilterField label="Bölge">
                    <Input value={regionFilter} onChange={setRegionFilter} placeholder="Örn: R1" />
                  </FilterField>
                  <FilterField label="SMS">
                    <Select value={smsFilter} onChange={setSmsFilter}>
                      <option value="">Tümü</option>
                      <option value="none">Hiç gönderilmedi</option>
                      <option value="sent">Gönderilen var</option>
                      <option value="failed">Hatalı var</option>
                      <option value="pending">Bekleyen var</option>
                    </Select>
                  </FilterField>
                  <FilterField label="Risk">
                    <Select value={riskFilter} onChange={(v) => setRiskFilter(v as "" | "true" | "false")}>
                      <option value="">Tümü</option>
                      <option value="true">Sadece riskli</option>
                      <option value="false">Sadece risksiz</option>
                    </Select>
                  </FilterField>
                  <FilterField label="Talep">
                    <Select value={requestStatusFilter} onChange={(v) => setRequestStatusFilter(v as "" | "open" | "approved" | "rejected")}>
                      <option value="">Tümü</option>
                      <option value="open">Açık</option>
                      <option value="approved">Onaylı</option>
                      <option value="rejected">Reddedilmiş</option>
                    </Select>
                  </FilterField>
                  <FilterField label="Claim">
                    <Select value={claimStateFilter} onChange={(v) => setClaimStateFilter(v as "" | "none" | "active" | "mine" | "other")}>
                      <option value="">Tümü</option>
                      <option value="none">Claim yok</option>
                      <option value="active">Aktif</option>
                      <option value="mine">Benimkiler</option>
                      <option value="other">Diğerleri</option>
                    </Select>
                  </FilterField>
                  <FilterField label="SLA">
                    <Select value={slaFilter} onChange={(v) => setSlaFilter(v as "" | "true" | "false")}>
                      <option value="">Tümü</option>
                      <option value="true">SLA aşılmış</option>
                      <option value="false">SLA içinde</option>
                    </Select>
                  </FilterField>
                  <FilterField label="Tarih Başlangıç">
                    <Input type="date" value={dateFromFilter} onChange={setDateFromFilter} placeholder="" />
                  </FilterField>
                  <FilterField label="Tarih Bitiş">
                    <Input type="date" value={dateToFilter} onChange={setDateToFilter} placeholder="" />
                  </FilterField>
                  <FilterField label="Min Kalite">
                    <Input type="number" value={minQualityFilter} onChange={setMinQualityFilter} placeholder="0" />
                  </FilterField>
                  <FilterField label="Max Kalite">
                    <Input type="number" value={maxQualityFilter} onChange={setMaxQualityFilter} placeholder="100" />
                  </FilterField>
                </div>
                {activeFilterCount > 0 && (
                  <button type="button" onClick={clearFilters} className="mt-3 text-[13px] font-semibold text-[#9D3438] underline underline-offset-2">
                    Filtreleri temizle
                  </button>
                )}
              </div>
            )}

            {/* ── Open Requests ── */}
            {openRequests.length > 0 && (
              <div className="rounded-[12px] border-2 border-[#F2D9DB] bg-[#FDF8F8] p-4">
                <p className="mb-2 text-[13px] font-bold uppercase tracking-[0.08em] text-[#8E2F33]">
                  Açık Operatör Talepleri — {openRequests.length} adet
                </p>
                <div className="space-y-2">
                  {openRequests.slice(0, 10).map((req) => (
                    <div key={req.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-[#F2D9DB] bg-white px-3 py-2.5">
                      <div>
                        <p className="text-[14px] font-semibold text-[#2F3437]">
                          Talep #{req.id} · Kayıt #{req.submission_id}
                        </p>
                        <p className="text-[12px] text-[#787774]">
                          {req.operator_username ?? "-"} · {req.reason_type} · NO {req.submission_no ?? "-"} · {req.submission_region ?? "-"}
                        </p>
                      </div>
                      <div className="flex gap-1.5">
                        <button type="button" onClick={() => onResolveRequest(req.id, "approved")} disabled={requestBusyId === req.id}
                          className="rounded-[6px] border border-[#D6EAD7] bg-[#EDF8EE] px-3 py-1.5 text-[13px] font-semibold text-[#2F6A34] disabled:opacity-50">
                          Onayla (Kaydı Reddet)
                        </button>
                        <button type="button" onClick={() => onResolveRequest(req.id, "rejected")} disabled={requestBusyId === req.id}
                          className="rounded-[6px] border border-[#EAEAEA] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#2F3437] disabled:opacity-50">
                          Reddet (Kaydı Aç)
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── SLA Alarms ── */}
            {topSlaBreachedRows.length > 0 && (
              <div className="rounded-[12px] border-2 border-[#FFD699] bg-[#FFFBF0] px-4 py-3">
                <p className="mb-2 text-[13px] font-bold uppercase tracking-[0.08em] text-[#8E5A00]">
                  SLA Alarm — {slaBreachedCount} kayıt
                </p>
                <div className="flex flex-wrap gap-2">
                  {topSlaBreachedRows.map((row) => (
                    <Link key={`sla-${row.id}`} href={`/admin/${row.id}`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#FFD699] bg-white px-3 py-1 text-[13px] font-semibold text-[#8E5A00] hover:bg-[#FFF3CD]">
                      #{row.id} · {row.no} · {row.created_age_minutes ?? "?"}dk
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* ── Batch Action Bar (only when items selected) ── */}
            {selectedSubmissionIds.length > 0 && (
              <div className="sticky bottom-4 z-30 mx-auto flex max-w-xl flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[#D0D0CE] bg-white px-4 py-3 shadow-[0_8px_24px_rgba(17,17,17,0.12)]">
                <span className="text-[15px] font-semibold text-[#111111]">{selectedSubmissionIds.length} kayıt seçili</span>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => runBulkReview("approved")} disabled={batchBusy !== null}
                    className="rounded-[8px] border border-[#D6EAD7] bg-[#EDF8EE] px-3 py-1.5 text-[13px] font-bold text-[#2F6A34] disabled:opacity-50">
                    {batchBusy === "approve" ? "Onaylanıyor..." : "Toplu Onayla"}
                  </button>
                  <button type="button" onClick={() => runBulkReview("rejected")} disabled={batchBusy !== null}
                    className="rounded-[8px] border border-[#F2D9DB] bg-[#FDF0F1] px-3 py-1.5 text-[13px] font-bold text-[#9D3438] disabled:opacity-50">
                    {batchBusy === "reject" ? "Reddediliyor..." : "Toplu Reddet"}
                  </button>
                  <button type="button" onClick={runBulkRetrySms} disabled={batchBusy !== null}
                    className="rounded-[8px] border border-[#EAEAEA] bg-white px-3 py-1.5 text-[13px] font-bold text-[#2F3437] disabled:opacity-50">
                    {batchBusy === "retry_sms" ? "Retry..." : "SMS Retry"}
                  </button>
                  <button type="button" onClick={clearSelection}
                    className="rounded-[8px] border border-[#EAEAEA] bg-white px-3 py-1.5 text-[13px] text-[#787774]">
                    <X size={14} />
                  </button>
                </div>
                {batchFailureIds.length > 0 && (
                  <p className="w-full text-[12px] text-[#9D3438]">Başarısız: {batchFailureIds.join(", ")}</p>
                )}
              </div>
            )}

            {/* ── Main Table ── */}
            <div className="rounded-[14px] border border-[#E5E7E4] bg-white">
              {/* Table header bar */}
              <div className="flex items-center justify-between gap-2 border-b border-[#E5E7E4] px-4 py-3">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    onChange={(e) => (e.target.checked ? selectAllVisible() : clearSelection())}
                    checked={selectedSubmissionIds.length === rows.length && rows.length > 0}
                    className="h-4 w-4 cursor-pointer accent-[#2E7D32]"
                  />
                  <span className="text-[13px] font-medium text-[#4B4F52]">
                    {selectedSubmissionIds.length > 0 ? `${selectedSubmissionIds.length} seçili` : "Tümü seç"}
                  </span>
                </div>
                <div className="flex gap-1">
                  {(["review_ready", "approved", "rejected", "failed"] as const).map((s) => {
                    const cnt = rows.filter((r) => r.status === s).length;
                    if (!cnt) return null;
                    const cls = s === "review_ready" ? "bg-[#EEF4FF] text-[#1565C0]" : s === "approved" ? "bg-[#E8F5E9] text-[#2E7D32]" : "bg-[#FDEDED] text-[#9D3438]";
                    return (
                      <span key={s} className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${cls}`}>
                        {statusLabels[s]} {cnt}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Mobile cards */}
              <div className="space-y-0 md:hidden">
                {rows.length === 0 ? (
                  <div className="px-4 py-12 text-center">
                    <p className="text-[15px] font-medium text-[#4B4F52]">Kayıt bulunamadı</p>
                    <button type="button" onClick={setReviewReadyTodayFilter} className="mt-3 rounded-[6px] bg-[#111111] px-3 py-2 text-[14px] font-semibold text-white">
                      Hazır kayıtları getir
                    </button>
                  </div>
                ) : (
                  rows.map((row, rowIndex) => {
                    const canQuickSms = row.status === "approved" && !row.risk_locked;
                    const rowFocused = rowIndex === focusedRowIndex;
                    const borderColor = row.risk_locked ? "border-l-[#E53935]" : row.sla_breached ? "border-l-[#F57C00]" : row.status === "review_ready" ? "border-l-[#1565C0]" : row.status === "approved" ? "border-l-[#2E7D32]" : row.status === "rejected" || row.status === "failed" ? "border-l-[#C62828]" : "border-l-[#D0D0CE]";
                    const rowBg = rowFocused ? "bg-[#FFFBEB]" : row.risk_locked ? "bg-[#FFF5F5]" : row.sla_breached ? "bg-[#FFFBF0]" : "bg-white";
                    return (
                      <article key={`m-${row.id}`} className={`border-b border-[#F0F0EE] border-l-4 ${borderColor} ${rowBg} p-4`}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <input type="checkbox" checked={selectedSubmissionIds.includes(row.id)} onChange={() => toggleSubmissionSelection(row.id)} className="h-4 w-4 accent-[#2E7D32]" />
                              <p className="text-[18px] font-bold text-[#111111]">#{row.id}</p>
                              <p className="text-[15px] font-semibold text-[#4B4F52]">{row.no}</p>
                            </div>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              <span className={`${statusBadgeClass[row.status] ?? "saas-badge-warn"}`}>{statusLabels[row.status] ?? row.status}</span>
                              {row.risk_locked && <span className="inline-flex rounded-full bg-[#FDEDED] px-2 py-0.5 text-[11px] font-bold text-[#9D3438]">Risk</span>}
                              {row.sla_breached && <span className="inline-flex rounded-full bg-[#FFF3CD] px-2 py-0.5 text-[11px] font-bold text-[#8E5A00]">SLA</span>}
                            </div>
                          </div>
                          <div className="text-right">
                            <QualityTag score={row.quality_score} />
                            <p className="mt-1 text-[12px] text-[#787774]">{row.duration_seconds ? `${Math.round(row.duration_seconds)}sn` : "-"}</p>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button type="button" onClick={() => onShortcutReview(row, "approved")} disabled={row.risk_locked}
                            className="flex-1 rounded-[8px] border border-[#D6EAD7] bg-[#EDF8EE] py-2 text-[14px] font-bold text-[#2F6A34] disabled:opacity-40">
                            Onayla
                          </button>
                          <button type="button" onClick={() => onShortcutReview(row, "rejected")}
                            className="flex-1 rounded-[8px] border border-[#F2D9DB] bg-[#FDF0F1] py-2 text-[14px] font-bold text-[#9D3438]">
                            Reddet
                          </button>
                          <button type="button" onClick={() => onQuickSendSms(row)} disabled={!canQuickSms || quickSmsSendingId === row.id}
                            className="rounded-[8px] bg-[#111111] px-4 py-2 text-[14px] font-bold text-white disabled:opacity-40">
                            {quickSmsSendingId === row.id ? "..." : "SMS"}
                          </button>
                          <button type="button" onClick={() => setPreviewRow(row)} disabled={!row.preview_watch_url}
                            className="rounded-[8px] border border-[#EAEAEA] bg-white px-3 py-2 text-[13px] font-semibold disabled:opacity-40">
                            Önizle
                          </button>
                          <Link href={`/admin/${row.id}`} className="rounded-[8px] border border-[#EAEAEA] bg-white px-3 py-2 text-[13px] font-semibold">
                            Detay
                          </Link>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>

              {/* Desktop table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[900px] text-left">
                  <thead>
                    <tr className="border-b border-[#F0F0EE] bg-[#FAFAFA] text-[11px] font-bold uppercase tracking-[0.08em] text-[#787774]">
                      <th className="w-10 px-4 py-3" />
                      <th className="px-4 py-3">ID · NO · Bölge</th>
                      <th className="px-4 py-3">Durum</th>
                      <th className="px-4 py-3">Kalite · Süre</th>
                      <th className="px-4 py-3">Meta</th>
                      <th className="px-4 py-3">Aksiyon</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-16 text-center">
                          <p className="text-[16px] font-medium text-[#4B4F52]">Seçili filtreler için kayıt bulunamadı</p>
                          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                            <button type="button" onClick={setReviewReadyTodayFilter} className="rounded-[8px] bg-[#111111] px-4 py-2 text-[14px] font-semibold text-white">
                              Hazır kayıtları getir
                            </button>
                            <button type="button" onClick={clearFilters} className="rounded-[8px] border border-[#EAEAEA] bg-white px-4 py-2 text-[14px] font-semibold text-[#2F3437]">
                              Tüm filtreleri temizle
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      rows.map((row, rowIndex) => {
                        const canQuickSms = row.status === "approved" && !row.risk_locked;
                        const rowFocused = rowIndex === focusedRowIndex;
                        const leftBorder = row.risk_locked ? "border-l-[#E53935]" : row.sla_breached ? "border-l-[#F57C00]" : row.status === "review_ready" ? "border-l-[#1565C0]" : row.status === "approved" ? "border-l-[#2E7D32]" : row.status === "rejected" || row.status === "failed" ? "border-l-[#C62828]" : "border-l-transparent";
                        const rowBg = rowFocused ? "bg-[#FFFBEB]" : row.risk_locked ? "bg-[#FFF8F8] hover:bg-[#FFF0F0]" : row.sla_breached ? "bg-[#FFFCF4] hover:bg-[#FFF8E8]" : "hover:bg-[#F9F9F8]";
                        return (
                          <tr key={row.id} className={`border-b border-l-4 border-[#F0F0EE] transition-colors ${leftBorder} ${rowBg}`}>
                            <td className="px-4 py-3.5">
                              <input type="checkbox" checked={selectedSubmissionIds.includes(row.id)} onChange={() => toggleSubmissionSelection(row.id)} className="h-4 w-4 cursor-pointer accent-[#2E7D32]" />
                            </td>
                            <td className="px-4 py-3.5">
                              <p className="text-[17px] font-bold text-[#111111]">#{row.id}</p>
                              <p className="mt-0.5 font-mono text-[14px] font-semibold text-[#4B4F52]">{row.no}</p>
                              {row.region && <p className="text-[12px] text-[#787774]">{row.region}</p>}
                            </td>
                            <td className="px-4 py-3.5">
                              <span className={`${statusBadgeClass[row.status] ?? "saas-badge-warn"}`}>
                                {statusLabels[row.status] ?? row.status}
                              </span>
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {row.risk_locked && <span className="inline-flex rounded-full bg-[#FDEDED] px-2 py-0.5 text-[11px] font-bold text-[#9D3438]">Risk</span>}
                                {row.sla_breached && <span className="inline-flex rounded-full bg-[#FFF3CD] px-2 py-0.5 text-[11px] font-bold text-[#8E5A00]">SLA</span>}
                              </div>
                            </td>
                            <td className="px-4 py-3.5">
                              <QualityTag score={row.quality_score} />
                              <p className="mt-1 text-[12px] text-[#787774]">
                                {row.duration_seconds ? `${Math.round(row.duration_seconds)} sn` : "-"}
                              </p>
                            </td>
                            <td className="px-4 py-3.5 text-[12px] text-[#6B7073]">
                              <p>P: {row.queue_priority_score?.toFixed(1) ?? "-"} · {row.created_age_minutes ?? "-"}dk</p>
                              {row.last_admin_actor_username && (
                                <p className="mt-0.5">{row.last_admin_actor_username} · {row.last_admin_action ? adminActionLabels[row.last_admin_action] ?? row.last_admin_action : "-"}</p>
                              )}
                              {row.latest_request_status && (
                                <p className="mt-0.5 text-[#8E2F33]">Talep: {row.latest_request_reason_type ?? "-"}</p>
                              )}
                            </td>
                            <td className="px-4 py-3.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <button type="button" onClick={() => onShortcutReview(row, "approved")} disabled={row.risk_locked}
                                  className="rounded-[8px] border border-[#D6EAD7] bg-[#EDF8EE] px-3 py-1.5 text-[13px] font-bold text-[#2F6A34] hover:bg-[#D6EAD7] disabled:opacity-40">
                                  Onayla
                                </button>
                                <button type="button" onClick={() => onShortcutReview(row, "rejected")}
                                  className="rounded-[8px] border border-[#F2D9DB] bg-[#FDF0F1] px-3 py-1.5 text-[13px] font-bold text-[#9D3438] hover:bg-[#F2D9DB]">
                                  Reddet
                                </button>
                                <button type="button" onClick={() => onQuickSendSms(row)} disabled={!canQuickSms || quickSmsSendingId === row.id}
                                  className="rounded-[8px] bg-[#111111] px-3 py-1.5 text-[13px] font-bold text-white hover:bg-[#333333] disabled:opacity-40">
                                  {quickSmsSendingId === row.id ? "..." : "SMS"}
                                </button>
                                <button type="button" onClick={() => setPreviewRow(row)} disabled={!row.preview_watch_url}
                                  className="rounded-[8px] border border-[#EAEAEA] bg-white px-2.5 py-1.5 text-[12px] font-semibold disabled:opacity-40">
                                  Önizle
                                </button>
                                <Link href={`/admin/${row.id}`}
                                  className="rounded-[8px] border border-[#EAEAEA] bg-white px-2.5 py-1.5 text-[12px] font-semibold hover:border-[#D0D0CE]">
                                  Detay
                                </Link>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {activeTab === "operators" && userRole === "super_admin" && (
          <Card title="Operatör Yönetimi">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric title="Toplam Operatör" value={String(analytics?.total_operators ?? "-")} />
              <Metric title="Aktif" value={String(analytics?.active_operators ?? "-")} />
              <Metric title="AI Başarı" value={`${analytics?.ai_success_rate_percent ?? "-"}%`} />
              <Metric title="Ort. Süre" value={analytics?.avg_duration_seconds ? `${analytics.avg_duration_seconds}s` : "-"} />
            </div>

            <form className="mt-4 grid gap-2 sm:grid-cols-2" onSubmit={onCreateOperator}>
              <Input value={operatorForm.username} onChange={(v) => setOperatorForm((p) => ({ ...p, username: v }))} placeholder="Kullanıcı adı" />
              <Input type="password" value={operatorForm.password} onChange={(v) => setOperatorForm((p) => ({ ...p, password: v }))} placeholder="Şifre" />
              <Select value={operatorForm.role} onChange={(v) => setOperatorForm((p) => ({ ...p, role: v as "operator" | "admin" }))}>
                <option value="operator">Operatör</option>
                <option value="admin">Admin</option>
              </Select>
              <Input value={operatorForm.first_name} onChange={(v) => setOperatorForm((p) => ({ ...p, first_name: v }))} placeholder="Ad" />
              <Input value={operatorForm.last_name} onChange={(v) => setOperatorForm((p) => ({ ...p, last_name: v }))} placeholder="Soyad" />
              <Input value={operatorForm.country} onChange={(v) => setOperatorForm((p) => ({ ...p, country: v }))} placeholder="Ülke" />
              <Input value={operatorForm.city} onChange={(v) => setOperatorForm((p) => ({ ...p, city: v }))} placeholder="Şehir" />
              <Input className="sm:col-span-2" value={operatorForm.region} onChange={(v) => setOperatorForm((p) => ({ ...p, region: v }))} placeholder="Bölge" />
              <button className="sm:col-span-2 h-10 rounded-[6px] bg-[#111111] text-[16px] font-medium text-white hover:bg-[#333333] disabled:opacity-60" disabled={operatorBusy}>
                {operatorBusy ? "Oluşturuluyor..." : "Hesap Oluştur"}
              </button>
            </form>

            <div className="mt-4 grid gap-2 md:grid-cols-2 lg:grid-cols-5">
              <FilterField label="Ara">
                <Input value={accountSearch} onChange={setAccountSearch} placeholder="Kullanıcı, ad, şehir..." />
              </FilterField>
              <FilterField label="Rol">
                <Select value={accountRoleFilter} onChange={(v) => setAccountRoleFilter(v as AccountRoleFilter)}>
                  <option value="all">Tümü</option>
                  <option value="operator">Operatör</option>
                  <option value="admin">Admin</option>
                </Select>
              </FilterField>
              <FilterField label="Durum">
                <Select value={accountStatusFilter} onChange={(v) => setAccountStatusFilter(v as AccountStatusFilter)}>
                  <option value="all">Tümü</option>
                  <option value="active">Aktif</option>
                  <option value="passive">Pasif</option>
                </Select>
              </FilterField>
              <FilterField label="Sırala">
                <Select value={accountSortBy} onChange={(v) => setAccountSortBy(v as AccountSortBy)}>
                  <option value="created_at">Kayıt tarihi</option>
                  <option value="username">Kullanıcı adı</option>
                  <option value="full_name">Ad Soyad</option>
                  <option value="country">Ülke</option>
                  <option value="city">Şehir</option>
                  <option value="role">Rol</option>
                </Select>
              </FilterField>
              <FilterField label="Yön">
                <Select value={accountSortDir} onChange={(v) => setAccountSortDir(v as AccountSortDir)}>
                  <option value="desc">Azalan</option>
                  <option value="asc">Artan</option>
                </Select>
              </FilterField>
            </div>

            <TableWrap className="mt-4">
              <table className="saas-table min-w-[760px] text-left text-[16px]">
                <thead className="text-[16px] uppercase tracking-[0.08em] text-[#787774]">
                  <tr>
                    <th className="px-3 py-2">ID</th><th className="px-3 py-2">Kullanıcı</th><th className="px-3 py-2">Rol</th><th className="px-3 py-2">Ad Soyad</th><th className="px-3 py-2">Lokasyon</th><th className="px-3 py-2">Durum</th><th className="px-3 py-2">Detay</th><th className="px-3 py-2">Aksiyon</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOperators.length === 0 ? (
                    <tr className="border-t border-[#EAEAEA]">
                      <td colSpan={8} className="px-3 py-8 text-center text-[16px] text-[#787774]">
                        Filtreye uyan hesap bulunamadı.
                      </td>
                    </tr>
                  ) : (
                    filteredOperators.map((op) => {
                    const isEditing = operatorEditId === op.id;
                    return (
                    <tr key={op.id} className="border-t border-[#EAEAEA]">
                      <td className="px-3 py-2">{op.id}</td>
                      <td className="px-3 py-2">
                        {isEditing ? (
                          <input
                            value={operatorEditForm.username}
                            onChange={(e) => setOperatorEditForm((p) => ({ ...p, username: e.target.value }))}
                            className="h-9 w-full min-w-[140px] rounded-[6px] border border-[#EAEAEA] bg-[#F9F9F8] px-2 text-[15px] outline-none focus:border-[#D0D0CF]"
                          />
                        ) : (
                          op.username
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {isEditing ? (
                          <select
                            value={operatorEditForm.role}
                            onChange={(e) => setOperatorEditForm((p) => ({ ...p, role: e.target.value as "operator" | "admin" }))}
                            className="h-9 w-full min-w-[120px] rounded-[6px] border border-[#EAEAEA] bg-[#F9F9F8] px-2 text-[15px] outline-none focus:border-[#D0D0CF]"
                          >
                            <option value="operator">Operatör</option>
                            <option value="admin">Admin</option>
                          </select>
                        ) : (
                          <span className={op.role === "admin" ? "saas-badge-info" : "saas-badge-warn"}>{op.role === "admin" ? "Admin" : "Operatör"}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {isEditing ? (
                          <div className="grid min-w-[220px] gap-1">
                            <input
                              value={operatorEditForm.first_name}
                              onChange={(e) => setOperatorEditForm((p) => ({ ...p, first_name: e.target.value }))}
                              placeholder="Ad"
                              className="h-8 rounded-[6px] border border-[#EAEAEA] bg-[#F9F9F8] px-2 text-[14px] outline-none focus:border-[#D0D0CF]"
                            />
                            <input
                              value={operatorEditForm.last_name}
                              onChange={(e) => setOperatorEditForm((p) => ({ ...p, last_name: e.target.value }))}
                              placeholder="Soyad"
                              className="h-8 rounded-[6px] border border-[#EAEAEA] bg-[#F9F9F8] px-2 text-[14px] outline-none focus:border-[#D0D0CF]"
                            />
                          </div>
                        ) : (
                          `${op.first_name ?? ""} ${op.last_name ?? ""}`.trim() || "-"
                        )}
                      </td>
                      <td className="px-3 py-2 text-[#787774]">
                        {isEditing ? (
                          <div className="grid min-w-[220px] gap-1">
                            <input
                              value={operatorEditForm.country}
                              onChange={(e) => setOperatorEditForm((p) => ({ ...p, country: e.target.value }))}
                              placeholder="Ülke"
                              className="h-8 rounded-[6px] border border-[#EAEAEA] bg-[#F9F9F8] px-2 text-[14px] outline-none focus:border-[#D0D0CF]"
                            />
                            <input
                              value={operatorEditForm.city}
                              onChange={(e) => setOperatorEditForm((p) => ({ ...p, city: e.target.value }))}
                              placeholder="Şehir"
                              className="h-8 rounded-[6px] border border-[#EAEAEA] bg-[#F9F9F8] px-2 text-[14px] outline-none focus:border-[#D0D0CF]"
                            />
                            <input
                              value={operatorEditForm.region}
                              onChange={(e) => setOperatorEditForm((p) => ({ ...p, region: e.target.value }))}
                              placeholder="Bölge"
                              className="h-8 rounded-[6px] border border-[#EAEAEA] bg-[#F9F9F8] px-2 text-[14px] outline-none focus:border-[#D0D0CF]"
                            />
                          </div>
                        ) : (
                          `${op.country ?? "-"} / ${op.city ?? "-"} / ${op.region ?? "-"}`
                        )}
                      </td>
                      <td className="px-3 py-2">{op.is_active ? "Aktif" : "Pasif"}</td>
                      <td className="px-3 py-2">
                        {op.role === "operator" ? <Link href={`/admin/operators/${op.id}`} className="underline">Analitik</Link> : <span className="text-[#787774]">-</span>}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {isEditing ? (
                            <>
                              <button
                                className="rounded-[6px] bg-[#111111] px-2 py-1 text-[16px] text-white disabled:opacity-50"
                                disabled={operatorActionBusyId === op.id}
                                onClick={() => onSaveOperatorEdit(op.id)}
                              >
                                {operatorActionBusyId === op.id ? "Kaydediliyor..." : "Kaydet"}
                              </button>
                              <button
                                className="rounded-[6px] border border-[#EAEAEA] bg-white px-2 py-1 text-[16px]"
                                disabled={operatorActionBusyId === op.id}
                                onClick={onCancelOperatorEdit}
                              >
                                İptal
                              </button>
                            </>
                          ) : (
                            <button className="rounded-[6px] border border-[#EAEAEA] bg-white px-2 py-1 text-[16px]" disabled={operatorActionBusyId === op.id} onClick={() => onStartOperatorEdit(op)}>
                              Düzenle
                            </button>
                          )}
                          <button className="rounded-[6px] border border-[#EAEAEA] bg-white px-2 py-1 text-[16px]" disabled={operatorActionBusyId === op.id} onClick={() => onToggleOperatorStatus(op.id, op.is_active)}>
                            {operatorActionBusyId === op.id ? "..." : op.is_active ? "Pasif" : "Aktif"}
                          </button>
                          <button className="rounded-[6px] bg-[#111111] px-2 py-1 text-[16px] text-white" disabled={operatorActionBusyId === op.id || isEditing} onClick={() => onResetOperatorPassword(op.id)}>
                            Şifre
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                    })
                  )}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        )}

      </section>

      {previewRow && (
        <PreviewModal row={previewRow} onClose={() => setPreviewRow(null)} />
      )}
    </main>
  );
}

function PreviewModal({ row, onClose }: { row: SubmissionItem; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-3xl rounded-[12px] border border-[#EAEAEA] bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <p className="text-[16px] uppercase tracking-[0.08em] text-[#787774]">Video Önizleme</p>
            <p className="text-[16px] font-semibold text-[#111111]">Kayıt #{row.id} · NO {row.no}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-[6px] border border-[#EAEAEA] bg-white p-1.5 text-[#4B4F52]">
            <X size={16} />
          </button>
        </div>

        {row.preview_watch_url ? (
          <video src={row.preview_watch_url} controls className="h-auto w-full rounded-[8px] border border-[#EAEAEA] bg-black" />
        ) : (
          <div className="rounded-[8px] border border-[#EAEAEA] bg-[#F9F9F8] p-4 text-[16px] text-[#787774]">Bu kayıt için işlenmiş video henüz hazır değil.</div>
        )}
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[12px] border border-[#EAEAEA] bg-white p-5">
      <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[#3C4144]">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <article className="rounded-[8px] border border-[#EAEAEA] bg-[#F9F9F8] p-3">
      <p className="text-[15px] uppercase tracking-[0.08em] text-[#666B6E]">{title}</p>
      <p className="mt-1 text-xl font-semibold text-[#111111]">{value}</p>
    </article>
  );
}

function TableWrap({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`max-h-[68vh] overflow-auto rounded-[8px] border border-[#EAEAEA] ${className}`}>{children}</div>;
}

function Input({ value, onChange, placeholder, type = "text", className = "" }: { value: string; onChange: (v: string) => void; placeholder: string; type?: string; className?: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      type={type}
      className={`h-11 w-full rounded-[8px] border border-[#EAEAEA] bg-[#F9F9F8] px-3 text-[16px] outline-none focus:border-[#D0D0CF] ${className}`}
    />
  );
}

function Select({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="h-11 w-full rounded-[8px] border border-[#EAEAEA] bg-[#F9F9F8] px-3 text-[16px] outline-none focus:border-[#D0D0CF]">
      {children}
    </select>
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[16px] font-medium tracking-[0.01em] text-[#5E6468]">{label}</span>
      {children}
    </label>
  );
}
