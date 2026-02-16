import axios from "axios";

function normalizeBaseUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function apiUrl(baseUrl, path) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return "";
  if (base.endsWith("/api")) return `${base}${path}`;
  return `${base}/api${path}`;
}

function toPhone(value) {
  return String(value || "").trim();
}

function normalizeNameKey(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function findByIdOrUniqueName(rows, { id, name, getId, getName }) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const wantedId = String(id || "").trim();

  if (wantedId) {
    const byId = safeRows.find(
      (row) => String(getId?.(row) || "").trim() === wantedId
    );
    if (byId) {
      return { match: byId, strategy: "id" };
    }
  }

  const nameKey = normalizeNameKey(name);
  if (!nameKey) {
    return { match: null, strategy: "none", reason: "student name missing" };
  }

  const byName = safeRows.filter(
    (row) => normalizeNameKey(getName?.(row)) === nameKey
  );
  if (byName.length === 1) {
    return { match: byName[0], strategy: "name" };
  }
  if (byName.length > 1) {
    return {
      match: null,
      strategy: "name-ambiguous",
      reason: `multiple students matched by name (${byName.length})`,
    };
  }
  return { match: null, strategy: "none", reason: "student not found on target" };
}

function normalizeStudent(student) {
  return {
    id: String(student?.id ?? "").trim(),
    name: String(student?.name ?? "").trim(),
    grade: String(student?.grade ?? "").trim(),
    studentPhone: toPhone(student?.studentPhone),
    parentPhone: toPhone(student?.parentPhone),
  };
}

function extractCookieHeader(setCookieHeader) {
  const raw = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : [];
  const pairs = raw
    .map((v) => String(v).split(";")[0].trim())
    .filter(Boolean);
  return pairs.join("; ");
}

function errorMessage(err) {
  const status = err?.response?.status;
  const detail =
    err?.response?.data?.error ||
    err?.response?.data?.message ||
    err?.response?.statusText ||
    err?.message ||
    String(err);
  return status ? `${status} ${detail}` : detail;
}

function result(target, status, message, extra = {}) {
  return { target, status, message, ...extra };
}

function parseBoolEnv(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  const norm = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(norm)) return true;
  if (["0", "false", "no", "n", "off", ""].includes(norm)) return false;
  return fallback;
}

function deleteMode() {
  const mode = String(process.env.STUDENT_SYNC_DELETE_MODE || "skip")
    .trim()
    .toLowerCase();
  return mode === "hard" ? "hard" : "skip";
}

function deleteBlockReason() {
  const mode = deleteMode();
  if (mode !== "hard") {
    return `delete sync skipped by STUDENT_SYNC_DELETE_MODE=${mode}`;
  }
  if (!parseBoolEnv(process.env.STUDENT_SYNC_ALLOW_DELETE, false)) {
    return "delete sync skipped because STUDENT_SYNC_ALLOW_DELETE is not true";
  }
  return "delete sync skipped by policy";
}

function canHardDelete() {
  return (
    deleteMode() === "hard" &&
    parseBoolEnv(process.env.STUDENT_SYNC_ALLOW_DELETE, false)
  );
}

function syncEnabled() {
  return (
    String(process.env.STUDENT_SYNC_ENABLED || "true").toLowerCase() !== "false"
  );
}

function timeoutMs() {
  return Number(process.env.STUDENT_SYNC_TIMEOUT_MS || 8000);
}

async function doRequest(config) {
  return axios({
    timeout: timeoutMs(),
    ...config,
  });
}

async function syncDosirak(action, student) {
  const baseUrl = process.env.SYNC_DOSIRAK_BASE_URL;
  const username = process.env.SYNC_DOSIRAK_ADMIN_USER;
  const password = process.env.SYNC_DOSIRAK_ADMIN_PASS;

  if (!normalizeBaseUrl(baseUrl)) {
    return result("dosirak", "skipped", "SYNC_DOSIRAK_BASE_URL not configured");
  }
  if (!username || !password) {
    return result(
      "dosirak",
      "skipped",
      "SYNC_DOSIRAK_ADMIN_USER/PASS not configured"
    );
  }
  if (action !== "upsert" && !canHardDelete()) {
    return result("dosirak", "skipped", deleteBlockReason());
  }

  const loginRes = await doRequest({
    method: "post",
    url: apiUrl(baseUrl, "/admin/login"),
    data: { username, password },
  });
  const cookieHeader = extractCookieHeader(loginRes?.headers?.["set-cookie"]);
  if (!cookieHeader) {
    throw new Error("dosirak login succeeded but no session cookie received");
  }

  if (action === "upsert") {
    await doRequest({
      method: "post",
      url: apiUrl(baseUrl, "/admin/students/bulk-upsert"),
      headers: { Cookie: cookieHeader },
      data: {
        students: [
          {
            name: student.name,
            code: student.id,
            phone: student.studentPhone,
            parent_phone: student.parentPhone,
          },
        ],
      },
    });
    return result("dosirak", "success", "student upsert synced");
  }

  const listRes = await doRequest({
    method: "get",
    url: apiUrl(baseUrl, "/admin/students"),
    headers: { Cookie: cookieHeader },
  });
  const rows = Array.isArray(listRes?.data) ? listRes.data : [];
  const lookup = findByIdOrUniqueName(rows, {
    id: student.id,
    name: student.name,
    getId: (r) => r?.code,
    getName: (r) => r?.name,
  });
  if (!lookup.match?.id) {
    return result("dosirak", "skipped", lookup.reason || "student not found on target");
  }

  await doRequest({
    method: "delete",
    url: apiUrl(baseUrl, `/admin/students/${lookup.match.id}`),
    headers: { Cookie: cookieHeader },
  });
  return result(
    "dosirak",
    "success",
    lookup.strategy === "name"
      ? "student deleted on target (name fallback)"
      : "student deleted on target"
  );
}

async function syncPenalty(action, student) {
  const baseUrl = process.env.SYNC_PENALTY_BASE_URL;
  if (!normalizeBaseUrl(baseUrl)) {
    return result("penalty", "skipped", "SYNC_PENALTY_BASE_URL not configured");
  }
  if (action !== "upsert" && !canHardDelete()) {
    return result("penalty", "skipped", deleteBlockReason());
  }

  if (action === "upsert") {
    await doRequest({
      method: "post",
      url: apiUrl(baseUrl, "/students"),
      data: {
        id: student.id,
        name: student.name,
        grade: student.grade || null,
        student_phone: student.studentPhone || null,
        parent_phone: student.parentPhone || null,
      },
    });
    return result("penalty", "success", "student upsert synced");
  }

  const listRes = await doRequest({
    method: "get",
    url: apiUrl(baseUrl, "/students"),
  });
  const rows = Array.isArray(listRes?.data?.data) ? listRes.data.data : [];
  const lookup = findByIdOrUniqueName(rows, {
    id: student.id,
    name: student.name,
    getId: (r) => r?.id,
    getName: (r) => r?.name,
  });
  const targetId = String(lookup.match?.id || "").trim();
  if (!targetId) {
    return result("penalty", "skipped", lookup.reason || "student not found on target");
  }

  await doRequest({
    method: "delete",
    url: apiUrl(baseUrl, `/students/${encodeURIComponent(targetId)}`),
  });
  return result(
    "penalty",
    "success",
    lookup.strategy === "name"
      ? "student deleted on target (name fallback)"
      : "student deleted on target"
  );
}

async function syncMentoring(action, student) {
  const baseUrl = process.env.SYNC_MENTORING_BASE_URL;
  const username = process.env.SYNC_MENTORING_USERNAME;
  const password = process.env.SYNC_MENTORING_PASSWORD;

  if (!normalizeBaseUrl(baseUrl)) {
    return result(
      "mentoring",
      "skipped",
      "SYNC_MENTORING_BASE_URL not configured"
    );
  }
  if (!username || !password) {
    return result(
      "mentoring",
      "skipped",
      "SYNC_MENTORING_USERNAME/PASSWORD not configured"
    );
  }
  if (action !== "upsert" && !canHardDelete()) {
    return result("mentoring", "skipped", deleteBlockReason());
  }

  const loginRes = await doRequest({
    method: "post",
    url: apiUrl(baseUrl, "/auth/login"),
    data: { username, password },
  });
  const token = loginRes?.data?.token;
  if (!token) {
    throw new Error("mentoring login succeeded but token missing");
  }
  const authHeaders = { Authorization: `Bearer ${token}` };

  const listRes = await doRequest({
    method: "get",
    url: apiUrl(baseUrl, "/students"),
    headers: authHeaders,
  });
  const rows = Array.isArray(listRes?.data?.students) ? listRes.data.students : [];
  const existing = rows.find(
    (r) => String(r?.external_id || "").trim() === student.id
  );

  if (action === "upsert") {
    const body = {
      name: student.name,
      grade: student.grade || null,
      student_phone: student.studentPhone || null,
      parent_phone: student.parentPhone || null,
    };
    if (existing?.id) {
      await doRequest({
        method: "put",
        url: apiUrl(baseUrl, `/students/${existing.id}`),
        headers: authHeaders,
        data: body,
      });
    } else {
      await doRequest({
        method: "post",
        url: apiUrl(baseUrl, "/students"),
        headers: authHeaders,
        data: {
          external_id: student.id,
          ...body,
        },
      });
    }
    return result("mentoring", "success", "student upsert synced");
  }

  const lookup = findByIdOrUniqueName(rows, {
    id: student.id,
    name: student.name,
    getId: (r) => r?.external_id,
    getName: (r) => r?.name,
  });
  if (!lookup.match?.id) {
    return result("mentoring", "skipped", lookup.reason || "student not found on target");
  }

  await doRequest({
    method: "delete",
    url: apiUrl(baseUrl, `/students/${lookup.match.id}`),
    headers: authHeaders,
  });
  return result(
    "mentoring",
    "success",
    lookup.strategy === "name"
      ? "student deleted on target (name fallback)"
      : "student deleted on target"
  );
}

function mergeLegacyStudent(existing, student) {
  return {
    ...existing,
    id: existing?.id ?? student.id,
    name: student.name || existing?.name || "",
    grade: student.grade || existing?.grade || "",
    studentPhone: student.studentPhone || existing?.studentPhone || "",
    parentPhone: student.parentPhone || existing?.parentPhone || "",
  };
}

async function syncLegacyState(action, student) {
  const baseUrl = process.env.SYNC_LEGACY_BASE_URL;
  const username = process.env.SYNC_LEGACY_USERNAME;
  const password = process.env.SYNC_LEGACY_PASSWORD;

  if (!normalizeBaseUrl(baseUrl)) {
    return result("legacy-state", "skipped", "SYNC_LEGACY_BASE_URL not configured");
  }
  if (!username || !password) {
    return result(
      "legacy-state",
      "skipped",
      "SYNC_LEGACY_USERNAME/PASSWORD not configured"
    );
  }
  if (action !== "upsert" && !canHardDelete()) {
    return result("legacy-state", "skipped", deleteBlockReason());
  }

  const loginRes = await doRequest({
    method: "post",
    url: apiUrl(baseUrl, "/login"),
    data: { username, password },
  });
  const token = loginRes?.data?.token;
  if (!token) {
    throw new Error("legacy-state login succeeded but token missing");
  }
  const authHeaders = { Authorization: `Bearer ${token}` };

  const stateRes = await doRequest({
    method: "get",
    url: apiUrl(baseUrl, "/state"),
    headers: authHeaders,
  });
  const state = stateRes?.data?.state && typeof stateRes.data.state === "object"
    ? stateRes.data.state
    : {};
  const students = Array.isArray(state.students) ? [...state.students] : [];

  const lookup = findByIdOrUniqueName(students, {
    id: student.id,
    name: student.name,
    getId: (r) => r?.id,
    getName: (r) => r?.name,
  });
  const matchId = String(lookup.match?.id || "").trim();
  const idx = matchId
    ? students.findIndex((r) => String(r?.id ?? "").trim() === matchId)
    : -1;
  let nextStudents = students;

  if (action === "upsert") {
    if (idx >= 0) {
      const updated = mergeLegacyStudent(students[idx], student);
      nextStudents = [...students];
      nextStudents[idx] = updated;
    } else {
      nextStudents = [
        ...students,
        {
          id: student.id,
          name: student.name,
          grade: student.grade || "",
          studentPhone: student.studentPhone || "",
          parentPhone: student.parentPhone || "",
        },
      ];
    }
  } else if (canHardDelete()) {
    if (!matchId) {
      return result("legacy-state", "skipped", lookup.reason || "student not found on target");
    }
    nextStudents = students.filter((r) => String(r?.id ?? "").trim() !== matchId);
  } else {
    return result(
      "legacy-state",
      "skipped",
      deleteBlockReason()
    );
  }

  const changed =
    JSON.stringify(students) !== JSON.stringify(nextStudents);
  if (!changed) {
    return result("legacy-state", "skipped", "no changes needed");
  }

  await doRequest({
    method: "put",
    url: apiUrl(baseUrl, "/state"),
    headers: authHeaders,
    data: {
      state: {
        ...state,
        students: nextStudents,
      },
    },
  });

  return result("legacy-state", "success", "state synced");
}

async function runTarget(handler, name) {
  try {
    return await handler();
  } catch (err) {
    return result(name, "failed", errorMessage(err));
  }
}

export async function syncStudentToExternalApps({ action, student }) {
  if (!syncEnabled()) {
    return {
      ok: true,
      action,
      studentId: null,
      targets: [result("all", "skipped", "STUDENT_SYNC_ENABLED=false")],
    };
  }

  const normalizedAction = action === "remove" ? "remove" : "upsert";
  const normalizedStudent = normalizeStudent(student);
  if (!normalizedStudent.id) {
    return {
      ok: false,
      action: normalizedAction,
      studentId: null,
      targets: [result("all", "failed", "student.id is required")],
    };
  }
  if (normalizedAction === "upsert" && !normalizedStudent.name) {
    return {
      ok: false,
      action: normalizedAction,
      studentId: normalizedStudent.id,
      targets: [result("all", "failed", "student.name is required for upsert")],
    };
  }

  const targets = await Promise.all([
    runTarget(
      () => syncDosirak(normalizedAction, normalizedStudent),
      "dosirak"
    ),
    runTarget(
      () => syncMentoring(normalizedAction, normalizedStudent),
      "mentoring"
    ),
    runTarget(
      () => syncPenalty(normalizedAction, normalizedStudent),
      "penalty"
    ),
    runTarget(
      () => syncLegacyState(normalizedAction, normalizedStudent),
      "legacy-state"
    ),
  ]);

  const ok = targets.every((t) => t.status !== "failed");
  return {
    ok,
    action: normalizedAction,
    studentId: normalizedStudent.id,
    targets,
  };
}
