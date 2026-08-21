import type {
  ActivityEvent,
  ApplicantProfile,
  Application,
  ApplicationExport,
  DocumentMatch,
  DocumentRecord,
  Issue,
  ProfileConflict,
  ReadinessReport,
  Requirement,
  ValidationResult,
  VaultDocument,
} from "@applyready/shared";

export class ApiClientError extends Error {
  code: string;
  nextSteps?: string[];
  details?: unknown;

  constructor(payload: {
    code: string;
    message: string;
    nextSteps?: string[];
    details?: unknown;
  }) {
    super(payload.message);
    this.code = payload.code;
    this.nextSteps = payload.nextSteps;
    this.details = payload.details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiClientError({
      code: data?.error?.code || "REQUEST_FAILED",
      message: data?.error?.message || "Request failed",
      nextSteps: data?.error?.nextSteps,
      details: data?.error?.details,
    });
  }
  return data as T;
}

export const api = {
  health: () => request<{ ok: boolean }>("/api/health"),
  storage: () =>
    request<{
      dataDir?: string;
      uploadsDir?: string;
      dbPath?: string;
      privacy: string;
      publicDemoMode?: boolean;
    }>("/api/settings/storage"),
  config: () =>
    request<{ publicDemoMode: boolean; mode: string }>("/api/config"),
  clearAll: () =>
    request<{ ok: boolean }>("/api/settings/clear-all", { method: "DELETE" }),
  listApplications: () =>
    request<{ applications: Application[] }>("/api/applications"),
  createApplication: (body: Record<string, unknown>) =>
    request<{ application: Application }>("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  getApplication: (id: string) =>
    request<{
      application: Application;
      requirements: Requirement[];
      documents: DocumentRecord[];
      issues: Issue[];
      matches: DocumentMatch[];
      conflicts: ProfileConflict[];
      profile: ApplicantProfile | null;
      activity: ActivityEvent[];
      validations: ValidationResult[];
    }>(`/api/applications/${id}`),
  updateApplication: (id: string, body: Record<string, unknown>) =>
    request<{ application: Application }>(`/api/applications/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  deleteApplication: (id: string) =>
    request<{ ok: boolean }>(`/api/applications/${id}`, { method: "DELETE" }),
  exportApplication: (id: string) =>
    request<ApplicationExport>(`/api/applications/${id}/export`),
  previewUrl: (url: string) =>
    request<{ title: string; description: string; text: string }>(
      "/api/applications/preview-url",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      },
    ),
  addTextSource: (id: string, text: string, sourceName: string) =>
    request<{ requirements: Requirement[] }>(
      `/api/applications/${id}/sources/text`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, sourceName }),
      },
    ),
  addUrlSource: (id: string, url: string) =>
    request<{ requirements: Requirement[]; warnings?: string[] }>(
      `/api/applications/${id}/sources/url`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      },
    ),
  addUploadSource: async (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ requirements: Requirement[] }>(
      `/api/applications/${id}/sources/upload`,
      { method: "POST", body: form },
    );
  },
  createRequirement: (id: string, body: Record<string, unknown>) =>
    request<{ requirement: Requirement }>(`/api/applications/${id}/requirements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  updateRequirement: (id: string, body: Record<string, unknown>) =>
    request<{ requirement: Requirement }>(`/api/requirements/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  confirmRequirement: (
    id: string,
    body?: {
      certainty?: "required" | "optional";
      applicability?: "applicable" | "not_applicable" | "unknown";
    },
  ) =>
    request<{ requirement: Requirement }>(`/api/requirements/${id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }),
  deleteRequirement: (id: string) =>
    request<{ ok: boolean }>(`/api/requirements/${id}`, { method: "DELETE" }),
  mergeRequirements: (appId: string, keepId: string, mergeId: string) =>
    request<{ requirement: Requirement }>(
      `/api/applications/${appId}/requirements/merge`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keepId, mergeId }),
      },
    ),
  uploadDocument: async (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ document: DocumentRecord }>(
      `/api/applications/${id}/documents`,
      { method: "POST", body: form },
    );
  },
  deleteDocument: (id: string) =>
    request<{ ok: boolean }>(`/api/documents/${id}`, { method: "DELETE" }),
  analyze: (id: string) =>
    request<{
      report: ReadinessReport;
      issues: Issue[];
      matches: DocumentMatch[];
      conflicts: ProfileConflict[];
    }>(`/api/applications/${id}/analyze`, { method: "POST" }),
  updateMatch: (id: string, body: Record<string, unknown>) =>
    request<{ match: DocumentMatch }>(`/api/document-matches/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  assignDocument: (requirementId: string, documentId: string) =>
    request<{ match: DocumentMatch }>(
      `/api/requirements/${requirementId}/assign-document`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId }),
      },
    ),
  updateIssue: (id: string, status: string) =>
    request<{ issue: Issue }>(`/api/issues/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }),
  updateProfile: (id: string, body: Record<string, unknown>) =>
    request<{ profile: ApplicantProfile }>(`/api/applications/${id}/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  resolveConflict: (id: string, equivalent: boolean, confirmedValue?: string) =>
    request<{ conflict: ProfileConflict }>(`/api/conflicts/${id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ equivalent, confirmedValue }),
    }),
  listVault: () => request<{ documents: VaultDocument[] }>("/api/vault"),
  uploadVault: async (
    file: File,
    meta: { category: string; notes?: string; expirationDate?: string },
  ) => {
    const form = new FormData();
    form.append("file", file);
    form.append("category", meta.category);
    if (meta.notes) form.append("notes", meta.notes);
    if (meta.expirationDate) form.append("expirationDate", meta.expirationDate);
    return request<{ document: VaultDocument }>("/api/vault", {
      method: "POST",
      body: form,
    });
  },
  updateVault: (id: string, body: Record<string, unknown>) =>
    request<{ document: VaultDocument }>(`/api/vault/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  deleteVault: (id: string) =>
    request<{ ok: boolean }>(`/api/vault/${id}`, { method: "DELETE" }),
  useVault: (appId: string, vaultId: string) =>
    request<{ document: DocumentRecord }>(
      `/api/applications/${appId}/use-vault-document/${vaultId}`,
      { method: "POST" },
    ),
  demoSteps: () =>
    request<{
      steps: Array<{
        step: number;
        title: string;
        summary: string;
        nextAction: string | null;
        shortLabel: string;
      }>;
    }>("/api/demo/steps"),
  startDemo: () =>
    request<{
      application: Application;
      analysis: { report: ReadinessReport; issues: Issue[] };
      step: {
        step: number;
        title: string;
        summary: string;
        nextAction: string | null;
        shortLabel: string;
      };
      steps: Array<{
        step: number;
        title: string;
        summary: string;
        nextAction: string | null;
        shortLabel: string;
      }>;
    }>("/api/demo/start", { method: "POST" }),
  fixDemo: (
    id: string,
    body: { mode: "suggested" } | { mode: "custom"; value: string } = {
      mode: "suggested",
    },
  ) =>
    request<{
      application: Application;
      analysis: { report: ReadinessReport; issues: Issue[] };
      step: {
        step: number;
        title: string;
        summary: string;
        nextAction: string | null;
        shortLabel: string;
      };
      done?: boolean;
      advanced?: boolean;
      appliedFix?: {
        mode: "suggested" | "custom";
        field: string | null;
        requestedValue: string | null;
        extractedValue: string | null;
        resolved: boolean;
      };
    }>(`/api/demo/${id}/fix`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  demoFixPreview: (id: string) =>
    request<{
      preview: import("@applyready/shared").DemoFixPreview;
    }>(`/api/demo/${id}/fix-preview`),
  resetDemo: (id: string) =>
    request<{
      application: Application;
      analysis: { report: ReadinessReport; issues: Issue[] };
      step: {
        step: number;
        title: string;
        summary: string;
        nextAction: string | null;
        shortLabel: string;
      };
      done?: boolean;
    }>(`/api/demo/${id}/reset`, { method: "POST" }),
  setDemoStep: (id: string, step: number) =>
    request<{
      application: Application;
      analysis: { report: ReadinessReport; issues: Issue[] };
      step: {
        step: number;
        title: string;
        summary: string;
        nextAction: string | null;
        shortLabel: string;
      };
      done?: boolean;
    }>(`/api/demo/${id}/step`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step }),
    }),
};
