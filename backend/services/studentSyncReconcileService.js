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

function timeoutMs() {
  return Number(process.env.STUDENT_SYNC_TIMEOUT_MS || 8000);
}

async function doRequest(config) {
  return axios({
    timeout: timeoutMs(),
    ...config,
  });
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

function normalizeNameKey(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeStudent(row) {
  return {
    id: String(row?.id ?? "").trim(),
    name: String(row?.name ?? "").trim(),
    grade: String(row?.grade ?? "").trim(),
    studentPhone: String(row?.studentPhone ?? row?.student_phone ?? "").trim(),
    parentPhone: String(row?.parentPhone ?? row?.parent_phone ?? "").trim(),
  };
}

function groupByName(students) {
  const map = new Map();
  for (const student of students) {
    const key = normalizeNameKey(student.name);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(student);
  }
  return map;
}

function groupById(students) {
  const map = new Map();
  for (const student of students) {
    const key = String(student?.id || "").trim();
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(student);
  }
  return map;
}

function duplicateRowsFromGroupMap(groupMap) {
  const rows = [];
  for (const [nameKey, items] of groupMap.entries()) {
    if (items.length <= 1) continue;
    rows.push({
      nameKey,
      items: items.map((s) => ({ id: s.id, name: s.name })),
    });
  }
  return rows;
}

function ensureConfigured(value) {
  return Boolean(String(value || "").trim());
}

async function fetchDosirakStudents() {
  const target = "dosirak";
  const baseUrl = process.env.SYNC_DOSIRAK_BASE_URL;
  const username = process.env.SYNC_DOSIRAK_ADMIN_USER;
  const password = process.env.SYNC_DOSIRAK_ADMIN_PASS;

  if (!ensureConfigured(baseUrl)) {
    return { target, status: "skipped", message: "SYNC_DOSIRAK_BASE_URL not configured", students: [] };
  }
  if (!username || !password) {
    return { target, status: "skipped", message: "SYNC_DOSIRAK_ADMIN_USER/PASS not configured", students: [] };
  }

  try {
    const loginRes = await doRequest({
      method: "post",
      url: apiUrl(baseUrl, "/admin/login"),
      data: { username, password },
    });
    const cookieHeader = extractCookieHeader(loginRes?.headers?.["set-cookie"]);
    if (!cookieHeader) {
      throw new Error("dosirak login succeeded but no session cookie received");
    }

    const listRes = await doRequest({
      method: "get",
      url: apiUrl(baseUrl, "/admin/students"),
      headers: { Cookie: cookieHeader },
    });
    const rows = Array.isArray(listRes?.data) ? listRes.data : [];
    const students = rows.map((r) =>
      normalizeStudent({
        id: r?.code,
        name: r?.name,
        student_phone: r?.phone,
        parent_phone: r?.parent_phone,
      })
    );

    return {
      target,
      status: "ready",
      message: "ok",
      students,
      auth: { cookieHeader },
    };
  } catch (err) {
    return { target, status: "failed", message: errorMessage(err), students: [] };
  }
}

async function fetchPenaltyStudents() {
  const target = "penalty";
  const baseUrl = process.env.SYNC_PENALTY_BASE_URL;
  if (!ensureConfigured(baseUrl)) {
    return { target, status: "skipped", message: "SYNC_PENALTY_BASE_URL not configured", students: [] };
  }

  try {
    const listRes = await doRequest({
      method: "get",
      url: apiUrl(baseUrl, "/students"),
    });
    const rows = Array.isArray(listRes?.data?.data) ? listRes.data.data : [];
    const students = rows.map((r) =>
      normalizeStudent({
        id: r?.id,
        name: r?.name,
        grade: r?.grade,
        student_phone: r?.student_phone,
        parent_phone: r?.parent_phone,
      })
    );
    return { target, status: "ready", message: "ok", students };
  } catch (err) {
    return { target, status: "failed", message: errorMessage(err), students: [] };
  }
}

async function fetchMentoringStudents() {
  const target = "mentoring";
  const baseUrl = process.env.SYNC_MENTORING_BASE_URL;
  const username = process.env.SYNC_MENTORING_USERNAME;
  const password = process.env.SYNC_MENTORING_PASSWORD;

  if (!ensureConfigured(baseUrl)) {
    return { target, status: "skipped", message: "SYNC_MENTORING_BASE_URL not configured", students: [] };
  }
  if (!username || !password) {
    return { target, status: "skipped", message: "SYNC_MENTORING_USERNAME/PASSWORD not configured", students: [] };
  }

  try {
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
    const students = rows.map((r) =>
      normalizeStudent({
        id: r?.external_id,
        name: r?.name,
        grade: r?.grade,
        student_phone: r?.student_phone,
        parent_phone: r?.parent_phone,
      })
    );
    return {
      target,
      status: "ready",
      message: "ok",
      students,
      auth: { authHeaders },
    };
  } catch (err) {
    return { target, status: "failed", message: errorMessage(err), students: [] };
  }
}

async function fetchLegacyStudents() {
  const target = "legacy-state";
  const baseUrl = process.env.SYNC_LEGACY_BASE_URL;
  const username = process.env.SYNC_LEGACY_USERNAME;
  const password = process.env.SYNC_LEGACY_PASSWORD;

  if (!ensureConfigured(baseUrl)) {
    return { target, status: "skipped", message: "SYNC_LEGACY_BASE_URL not configured", students: [] };
  }
  if (!username || !password) {
    return { target, status: "skipped", message: "SYNC_LEGACY_USERNAME/PASSWORD not configured", students: [] };
  }

  try {
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
    const state =
      stateRes?.data?.state && typeof stateRes.data.state === "object"
        ? stateRes.data.state
        : {};
    const rows = Array.isArray(state.students) ? state.students : [];
    const students = rows.map((r) =>
      normalizeStudent({
        id: r?.id,
        name: r?.name,
        grade: r?.grade,
        studentPhone: r?.studentPhone,
        parentPhone: r?.parentPhone,
      })
    );
    return {
      target,
      status: "ready",
      message: "ok",
      students,
      auth: { authHeaders, state },
    };
  } catch (err) {
    return { target, status: "failed", message: errorMessage(err), students: [] };
  }
}

function buildTargetPlan({ sourceStudents, targetName, targetStudents }) {
  const sourceByName = groupByName(sourceStudents);
  const targetByName = groupByName(targetStudents);
  const targetById = groupById(targetStudents);

  const toAdd = [];
  const extras = [];
  const warnings = [];
  const idCollisions = [];

  let matchedCount = 0;

  for (const [nameKey, sourceRows] of sourceByName.entries()) {
    if (sourceRows.length > 1) {
      warnings.push({
        type: "source_duplicate_name",
        target: targetName,
        name: sourceRows[0]?.name || nameKey,
        rows: sourceRows.map((r) => ({ id: r.id, name: r.name })),
      });
      continue;
    }

    const source = sourceRows[0];
    const sameNameTargetRows = targetByName.get(nameKey) || [];

    if (sameNameTargetRows.length > 0) {
      matchedCount += 1;
      if (sameNameTargetRows.length > 1) {
        warnings.push({
          type: "target_duplicate_name",
          target: targetName,
          name: source.name,
          rows: sameNameTargetRows.map((r) => ({ id: r.id, name: r.name })),
        });
      }
      continue;
    }

    const sameIdRows = targetById.get(source.id) || [];
    if (sameIdRows.length > 0) {
      idCollisions.push({
        source: { id: source.id, name: source.name },
        targetRows: sameIdRows.map((r) => ({ id: r.id, name: r.name })),
      });
      continue;
    }

    toAdd.push(source);
  }

  for (const [nameKey, targetRows] of targetByName.entries()) {
    if (sourceByName.has(nameKey)) continue;
    for (const row of targetRows) {
      extras.push({
        id: row.id,
        name: row.name,
      });
    }
  }

  return {
    target: targetName,
    matchedCount,
    toAdd,
    extras,
    warnings,
    idCollisions,
    sourceCount: sourceStudents.length,
    targetCount: targetStudents.length,
  };
}

async function previewForAllTargets(sourceStudents) {
  const targetSnapshots = await Promise.all([
    fetchDosirakStudents(),
    fetchMentoringStudents(),
    fetchPenaltyStudents(),
    fetchLegacyStudents(),
  ]);

  return targetSnapshots.map((snapshot) => {
    if (snapshot.status !== "ready") {
      return {
        target: snapshot.target,
        status: snapshot.status,
        message: snapshot.message,
        sourceCount: sourceStudents.length,
        targetCount: 0,
        matchedCount: 0,
        toAddCount: 0,
        extraCount: 0,
        toAdd: [],
        extras: [],
        warnings: [],
        idCollisions: [],
      };
    }

    const plan = buildTargetPlan({
      sourceStudents,
      targetName: snapshot.target,
      targetStudents: snapshot.students,
    });

    return {
      target: snapshot.target,
      status: "ready",
      message: snapshot.message,
      sourceCount: plan.sourceCount,
      targetCount: plan.targetCount,
      matchedCount: plan.matchedCount,
      toAddCount: plan.toAdd.length,
      extraCount: plan.extras.length,
      toAdd: plan.toAdd,
      extras: plan.extras,
      warnings: plan.warnings,
      idCollisions: plan.idCollisions,
    };
  });
}

async function applyToDosirak(students) {
  const snapshot = await fetchDosirakStudents();
  if (snapshot.status !== "ready") {
    return {
      target: "dosirak",
      status: snapshot.status === "failed" ? "failed" : "skipped",
      message: snapshot.message,
      appliedCount: 0,
      failedCount: 0,
      details: [],
    };
  }
  if (!students.length) {
    return {
      target: "dosirak",
      status: "skipped",
      message: "no students to add",
      appliedCount: 0,
      failedCount: 0,
      details: [],
    };
  }

  try {
    await doRequest({
      method: "post",
      url: apiUrl(process.env.SYNC_DOSIRAK_BASE_URL, "/admin/students/bulk-upsert"),
      headers: { Cookie: snapshot.auth.cookieHeader },
      data: {
        students: students.map((s) => ({
          name: s.name,
          code: s.id,
          phone: s.studentPhone,
          parent_phone: s.parentPhone,
        })),
      },
    });
    return {
      target: "dosirak",
      status: "success",
      message: `added ${students.length} students`,
      appliedCount: students.length,
      failedCount: 0,
      details: students.map((s) => ({ id: s.id, name: s.name, status: "success" })),
    };
  } catch (err) {
    return {
      target: "dosirak",
      status: "failed",
      message: errorMessage(err),
      appliedCount: 0,
      failedCount: students.length,
      details: students.map((s) => ({
        id: s.id,
        name: s.name,
        status: "failed",
        message: errorMessage(err),
      })),
    };
  }
}

async function applyToPenalty(students) {
  const baseUrl = process.env.SYNC_PENALTY_BASE_URL;
  if (!ensureConfigured(baseUrl)) {
    return {
      target: "penalty",
      status: "skipped",
      message: "SYNC_PENALTY_BASE_URL not configured",
      appliedCount: 0,
      failedCount: 0,
      details: [],
    };
  }
  if (!students.length) {
    return {
      target: "penalty",
      status: "skipped",
      message: "no students to add",
      appliedCount: 0,
      failedCount: 0,
      details: [],
    };
  }

  const details = [];
  let appliedCount = 0;
  for (const s of students) {
    try {
      await doRequest({
        method: "post",
        url: apiUrl(baseUrl, "/students"),
        data: {
          id: s.id,
          name: s.name,
          grade: s.grade || null,
          student_phone: s.studentPhone || null,
          parent_phone: s.parentPhone || null,
        },
      });
      appliedCount += 1;
      details.push({ id: s.id, name: s.name, status: "success" });
    } catch (err) {
      details.push({
        id: s.id,
        name: s.name,
        status: "failed",
        message: errorMessage(err),
      });
    }
  }

  const failedCount = details.filter((d) => d.status === "failed").length;
  return {
    target: "penalty",
    status: failedCount > 0 ? "partial" : "success",
    message:
      failedCount > 0
        ? `added ${appliedCount}, failed ${failedCount}`
        : `added ${appliedCount} students`,
    appliedCount,
    failedCount,
    details,
  };
}

async function applyToMentoring(students) {
  const snapshot = await fetchMentoringStudents();
  if (snapshot.status !== "ready") {
    return {
      target: "mentoring",
      status: snapshot.status === "failed" ? "failed" : "skipped",
      message: snapshot.message,
      appliedCount: 0,
      failedCount: 0,
      details: [],
    };
  }
  if (!students.length) {
    return {
      target: "mentoring",
      status: "skipped",
      message: "no students to add",
      appliedCount: 0,
      failedCount: 0,
      details: [],
    };
  }

  const details = [];
  let appliedCount = 0;
  for (const s of students) {
    try {
      await doRequest({
        method: "post",
        url: apiUrl(process.env.SYNC_MENTORING_BASE_URL, "/students"),
        headers: snapshot.auth.authHeaders,
        data: {
          external_id: s.id,
          name: s.name,
          grade: s.grade || null,
          student_phone: s.studentPhone || null,
          parent_phone: s.parentPhone || null,
        },
      });
      appliedCount += 1;
      details.push({ id: s.id, name: s.name, status: "success" });
    } catch (err) {
      details.push({
        id: s.id,
        name: s.name,
        status: "failed",
        message: errorMessage(err),
      });
    }
  }

  const failedCount = details.filter((d) => d.status === "failed").length;
  return {
    target: "mentoring",
    status: failedCount > 0 ? "partial" : "success",
    message:
      failedCount > 0
        ? `added ${appliedCount}, failed ${failedCount}`
        : `added ${appliedCount} students`,
    appliedCount,
    failedCount,
    details,
  };
}

async function applyToLegacyState(students) {
  const snapshot = await fetchLegacyStudents();
  if (snapshot.status !== "ready") {
    return {
      target: "legacy-state",
      status: snapshot.status === "failed" ? "failed" : "skipped",
      message: snapshot.message,
      appliedCount: 0,
      failedCount: 0,
      details: [],
    };
  }
  if (!students.length) {
    return {
      target: "legacy-state",
      status: "skipped",
      message: "no students to add",
      appliedCount: 0,
      failedCount: 0,
      details: [],
    };
  }

  const state = snapshot.auth.state && typeof snapshot.auth.state === "object"
    ? snapshot.auth.state
    : {};
  const existing = Array.isArray(state.students) ? [...state.students] : [];
  const existingIds = new Set(existing.map((s) => String(s?.id ?? "").trim()).filter(Boolean));

  const toInsert = [];
  const details = [];

  for (const s of students) {
    if (existingIds.has(s.id)) {
      details.push({
        id: s.id,
        name: s.name,
        status: "failed",
        message: "id already exists on legacy-state",
      });
      continue;
    }
    toInsert.push({
      id: s.id,
      name: s.name,
      grade: s.grade || "",
      studentPhone: s.studentPhone || "",
      parentPhone: s.parentPhone || "",
    });
    details.push({ id: s.id, name: s.name, status: "success" });
  }

  if (!toInsert.length) {
    const failedCount = details.filter((d) => d.status === "failed").length;
    return {
      target: "legacy-state",
      status: failedCount > 0 ? "partial" : "skipped",
      message: failedCount > 0 ? "all rows skipped by id collision" : "no students to add",
      appliedCount: 0,
      failedCount,
      details,
    };
  }

  try {
    await doRequest({
      method: "put",
      url: apiUrl(process.env.SYNC_LEGACY_BASE_URL, "/state"),
      headers: snapshot.auth.authHeaders,
      data: {
        state: {
          ...state,
          students: [...existing, ...toInsert],
        },
      },
    });
    const appliedCount = details.filter((d) => d.status === "success").length;
    const failedCount = details.filter((d) => d.status === "failed").length;
    return {
      target: "legacy-state",
      status: failedCount > 0 ? "partial" : "success",
      message:
        failedCount > 0
          ? `added ${appliedCount}, failed ${failedCount}`
          : `added ${appliedCount} students`,
      appliedCount,
      failedCount,
      details,
    };
  } catch (err) {
    return {
      target: "legacy-state",
      status: "failed",
      message: errorMessage(err),
      appliedCount: 0,
      failedCount: toInsert.length,
      details: toInsert.map((s) => ({
        id: s.id,
        name: s.name,
        status: "failed",
        message: errorMessage(err),
      })),
    };
  }
}

function normalizeSourceStudents(localStudentsInput) {
  const sourceStudents = (Array.isArray(localStudentsInput) ? localStudentsInput : [])
    .map(normalizeStudent)
    .filter((s) => s.id && s.name);
  return sourceStudents;
}

export async function previewStudentNameSync(localStudentsInput) {
  const sourceStudents = normalizeSourceStudents(localStudentsInput);
  const sourceByName = groupByName(sourceStudents);
  const sourceDuplicateNames = duplicateRowsFromGroupMap(sourceByName);

  const targets = await previewForAllTargets(sourceStudents);

  return {
    generatedAt: new Date().toISOString(),
    sourceCount: sourceStudents.length,
    sourceDuplicateNames,
    targets,
  };
}

export async function applyStudentNameSync(localStudentsInput) {
  const preview = await previewStudentNameSync(localStudentsInput);

  const results = [];

  for (const targetPlan of preview.targets) {
    const toAdd = Array.isArray(targetPlan.toAdd) ? targetPlan.toAdd : [];

    if (targetPlan.status !== "ready") {
      results.push({
        target: targetPlan.target,
        status: targetPlan.status === "failed" ? "failed" : "skipped",
        message: targetPlan.message,
        plannedAddCount: toAdd.length,
        appliedCount: 0,
        failedCount: 0,
        extraCount: targetPlan.extraCount || 0,
        extras: targetPlan.extras || [],
        details: [],
      });
      continue;
    }

    let applied;
    if (targetPlan.target === "dosirak") {
      applied = await applyToDosirak(toAdd);
    } else if (targetPlan.target === "mentoring") {
      applied = await applyToMentoring(toAdd);
    } else if (targetPlan.target === "penalty") {
      applied = await applyToPenalty(toAdd);
    } else if (targetPlan.target === "legacy-state") {
      applied = await applyToLegacyState(toAdd);
    } else {
      applied = {
        target: targetPlan.target,
        status: "skipped",
        message: "unknown target",
        appliedCount: 0,
        failedCount: 0,
        details: [],
      };
    }

    results.push({
      ...applied,
      plannedAddCount: toAdd.length,
      extraCount: targetPlan.extraCount || 0,
      extras: targetPlan.extras || [],
      idCollisions: targetPlan.idCollisions || [],
      warnings: targetPlan.warnings || [],
    });
  }

  const ok = results.every(
    (r) => r.status !== "failed" && r.status !== "partial"
  );

  return {
    ok,
    generatedAt: new Date().toISOString(),
    preview,
    targets: results,
  };
}

