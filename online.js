(function () {
  "use strict";
  const cfg = window.GFP_CONFIG || {};
  const runtimeVersion = "20260804-11";
  const state = {
    accessToken: "",
    refreshToken: "",
    expiresAt: 0,
    user: null,
    profile: null,
    memberships: [],
    schools: [],
    adminSchools: [],
    schoolId: "",
    actualSchoolId: "",
    role: "",
    preview: null,
    ready: false,
    saveTimer: null,
    saving: false,
    savePromise: null,
    pendingPayload: null,
    pendingBaseVersion: null,
    dataVersion: 0,
    lastChange: null,
    retryAction: null,
    conflict: false,
    adminUsers: [],
  };
  const configured = () =>
    /^https:\/\/[^.]+\.supabase\.co$/.test(String(cfg.supabaseUrl || "")) &&
    !String(cfg.anonKey || "").includes("SUA-CHAVE");
  const base = () => String(cfg.supabaseUrl || "").replace(/\/$/, "");
  const authKey = "gfp_online_auth_v2";
  function el(id) {
    return document.getElementById(id);
  }
  function jsonHeaders(auth = true) {
    const h = { apikey: cfg.anonKey, "Content-Type": "application/json" };
    if (auth && state.accessToken)
      h.Authorization = "Bearer " + state.accessToken;
    return h;
  }
  function errorText(value, fallback = "Ocorreu um erro inesperado.") {
    if (value instanceof Error) return errorText(value.message, fallback);
    if (
      typeof value === "string" &&
      value.trim() &&
      value.trim() !== "[object Object]"
    )
      return value.trim();
    if (value && typeof value === "object") {
      for (const key of [
        "message",
        "msg",
        "error_description",
        "details",
        "hint",
        "error",
      ]) {
        const text = errorText(value[key], "");
        if (text) return text;
      }
      try {
        const text = JSON.stringify(value);
        if (text && text !== "{}") return text;
      } catch {}
    }
    return fallback;
  }
  function notify(message, type = "info", options = {}) {
    if (typeof window.GFP_APP?.notify === "function")
      return window.GFP_APP.notify(errorText(message), type, options);
    if (type === "error") console.error(errorText(message));
    else console.log(errorText(message));
  }
  async function confirmAction(options) {
    if (typeof window.GFP_APP?.confirmAction === "function")
      return window.GFP_APP.confirmAction(options);
    return confirm(options.message || options.title);
  }
  async function request(
    path,
    { method = "GET", body, headers = {}, auth = true } = {},
  ) {
    const res = await fetch(base() + path, {
      method,
      headers: { ...jsonHeaders(auth), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let payload = null;
    const text = await res.text();
    if (text)
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    if (!res.ok)
      throw new Error(
        errorText(payload, `Erro ${res.status}. Tente novamente.`),
      );
    return payload;
  }
  function saveSession() {
    localStorage.setItem(
      authKey,
      JSON.stringify({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        expiresAt: state.expiresAt,
        user: state.user,
      }),
    );
  }
  function clearSession() {
    localStorage.removeItem(authKey);
    state.accessToken = "";
    state.refreshToken = "";
    state.expiresAt = 0;
    state.user = null;
  }
  function clearSyncedLocalData() {
    try {
      const keys = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index) || "";
        if (key.startsWith("gfp_school_cache_")) keys.push(key);
      }
      keys.push("gfp_last_school");
      keys.forEach((key) => localStorage.removeItem(key));
      window.GFP_APP?.clearLegacyLocalData?.();
    } catch (error) {
      console.warn("Os dados locais já sincronizados não puderam ser limpos.", error);
    }
  }
  function restoreSession() {
    try {
      const s = JSON.parse(localStorage.getItem(authKey) || "null");
      if (s) {
        Object.assign(state, s);
        return true;
      }
    } catch {}
    return false;
  }
  async function signIn(email, password) {
    const x = await request("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: { email, password },
      auth: false,
    });
    state.accessToken = x.access_token;
    state.refreshToken = x.refresh_token;
    state.expiresAt = Date.now() + Number(x.expires_in || 3600) * 1000;
    state.user = x.user;
    saveSession();
  }
  async function refreshSession() {
    if (!state.refreshToken) throw new Error("Sessão expirada.");
    const x = await request("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      body: { refresh_token: state.refreshToken },
      auth: false,
    });
    state.accessToken = x.access_token;
    state.refreshToken = x.refresh_token || state.refreshToken;
    state.expiresAt = Date.now() + Number(x.expires_in || 3600) * 1000;
    state.user = x.user || state.user;
    saveSession();
  }
  async function ensureToken() {
    if (state.accessToken && Date.now() < state.expiresAt - 60000) return;
    if (state.refreshToken) await refreshSession();
    else throw new Error("Faça login novamente.");
  }
  async function validateRestoredSession() {
    await ensureToken();
    const user = await request("/auth/v1/user");
    if (!user?.id) throw new Error("Não foi possível validar a sessão salva.");
    state.user = user;
    saveSession();
  }
  async function signOut() {
    try {
      await flushPendingSave();
      if (state.pendingPayload)
        throw new Error("Ainda existem alterações pendentes.");
      await request("/auth/v1/logout", { method: "POST", body: {} });
    } catch (e) {
      if (state.pendingPayload) {
        notify(
          "Não foi possível salvar as alterações no banco. Verifique sua conexão e tente sair novamente.",
          "error",
          { sticky: true, actionLabel: "Tentar novamente", onAction: signOut },
        );
        return;
      }
    }
    clearSyncedLocalData();
    clearSession();
    location.reload();
  }
  function recoveryRedirectUrl() {
    return location.origin + location.pathname;
  }
  async function resetPassword() {
    const email = await window.GFP_APP?.promptEmail?.();
    if (!email) return;
    await request(
      "/auth/v1/recover?redirect_to=" + encodeURIComponent(recoveryRedirectUrl()),
      { method: "POST", body: { email }, auth: false },
    );
    notify(
      "Se o e-mail estiver cadastrado, o Supabase enviará as instruções de recuperação.",
      "success",
    );
  }
  function q(v) {
    return encodeURIComponent(v);
  }
  async function rest(table, query = "", opts = {}) {
    await ensureToken();
    return request(`/rest/v1/${table}${query ? "?" + query : ""}`, opts);
  }
  function recoveryFromUrl() {
    const raw = (location.hash || "").replace(/^#/, "");
    if (!raw) return false;
    const hp = new URLSearchParams(raw);
    if (hp.get("type") !== "recovery" || !hp.get("access_token")) return false;
    state.accessToken = hp.get("access_token") || "";
    state.refreshToken = hp.get("refresh_token") || "";
    state.expiresAt = Date.now() + Number(hp.get("expires_in") || 3600) * 1000;
    saveSession();
    el("loginForm").style.display = "none";
    el("forgotPasswordBtn").style.display = "none";
    el("recoveryForm").style.display = "block";
    history.replaceState(null, "", location.pathname + location.search);
    return true;
  }
  async function completeRecovery(e) {
    e.preventDefault();
    const fd = new FormData(e.target),
      password = String(fd.get("password") || ""),
      confirm = String(fd.get("confirm") || "");
    if (password.length < 8) {
      showAuthError("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      showAuthError("As senhas não coincidem.");
      return;
    }
    try {
      await request("/auth/v1/user", { method: "PUT", body: { password } });
      notify("Senha atualizada. Entre novamente com a nova senha.", "success");
      clearSession();
      setTimeout(() => location.reload(), 700);
    } catch (err) {
      showAuthError(err.message);
    }
  }
  async function loadIdentity() {
    const uid = state.user?.id;
    if (!uid) throw new Error("Usuário não identificado.");
    const profiles = await rest(
      "profiles",
      `select=id,full_name,system_role,active&id=eq.${q(uid)}`,
    );
    state.profile = profiles?.[0];
    if (!state.profile || !state.profile.active)
      throw new Error(
        "Este usuário está inativo ou não possui perfil no sistema.",
      );
    if (state.profile.system_role === "master") {
      state.schools = await rest(
        "schools",
        "select=*&active=eq.true&order=name.asc",
      );
      state.memberships = [];
      state.role = "master";
    } else {
      state.memberships = await rest(
        "memberships",
        `select=id,user_id,school_id,role,active,schools(id,name,short_name,code,active)&user_id=eq.${q(uid)}&active=eq.true`,
      );
      state.schools = state.memberships
        .map((m) => m.schools)
        .filter(Boolean)
        .filter((s) => s.active);
    }
    if (!state.schools.length && state.profile.system_role !== "master")
      throw new Error("Seu usuário não está vinculado a nenhuma escola ativa.");
  }
  function activeMembership(schoolId) {
    if (state.profile?.system_role === "master") return { role: "master" };
    return state.memberships.find((m) => m.school_id === schoolId && m.active);
  }
  function effectiveRole() {
    return (
      state.preview?.role ||
      state.role ||
      activeMembership(state.schoolId)?.role ||
      ""
    );
  }
  const schoolAdminRoles = new Set([
    "master",
    "admin",
    "operator",
    "director_admin",
    "tech_admin",
  ]);
  const taskViewerRoles = new Set(["consulta", "director_view", "tech_view"]);
  const taskWritableRoles = new Set([
    ...schoolAdminRoles,
    ...taskViewerRoles,
  ]);
  function isSchoolAdminRole(role = effectiveRole()) {
    return schoolAdminRoles.has(role);
  }
  function isTaskViewerRole(role = effectiveRole()) {
    return taskViewerRoles.has(role);
  }
  function canEditTasks() {
    return (
      taskWritableRoles.has(effectiveRole()) &&
      (!state.preview || isTaskViewerRole(effectiveRole()))
    );
  }
  function canDeleteTasks() {
    return !state.preview && isSchoolAdminRole();
  }
  function roleLabel(r) {
    return (
      {
        master: "MASTER",
        admin: "Secretário / Oficial",
        operator: "Administrador da escola (legado)",
        director_admin: "Diretor / Coordenador administrador",
        tech_admin: "Coordenador Técnico administrador",
        consulta: "Visualização com tarefas (legado)",
        director_view: "Diretor / Coordenador visualização",
        tech_view: "Coordenador Técnico visualização",
      }[r] ||
      r ||
      "Sem permissão"
    );
  }
  function setCloud(text, cls = "", retryAction = null) {
    const e = el("cloudStatus"),
      retry = el("cloudRetryButton");
    state.retryAction = retryAction;
    if (e) {
      e.textContent = text;
      e.className = "cloud-status " + cls;
    }
    if (retry) retry.hidden = typeof retryAction !== "function";
    if (typeof window.GFP_APP?.refreshDashboard === "function")
      window.GFP_APP.refreshDashboard();
  }
  function localCacheKey() {
    return "gfp_school_cache_" + (state.schoolId || "none");
  }
  function pendingSaveKey(schoolId = state.schoolId) {
    return "gfp_pending_save_" + (schoolId || "none");
  }
  function cacheLocal(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      console.warn("Cópia local indisponível:", errorText(e));
      return false;
    }
  }
  function readPending(schoolId = state.schoolId) {
    try {
      return JSON.parse(
        localStorage.getItem(pendingSaveKey(schoolId)) || "null",
      );
    } catch {
      return null;
    }
  }
  function storePending(payload, baseVersion = state.dataVersion) {
    cacheLocal(
      pendingSaveKey(),
      JSON.stringify({
        payload,
        baseVersion: Number(baseVersion || 0),
        queuedAt: new Date().toISOString(),
      }),
    );
  }
  function clearPending(schoolId = state.schoolId) {
    try {
      localStorage.removeItem(pendingSaveKey(schoolId));
    } catch {}
  }
  function formatLastChange(row) {
    if (!row?.updated_at) return "Dados sincronizados";
    const date = new Date(row.updated_at),
      now = new Date(),
      sameDay = date.toDateString() === now.toDateString(),
      when = sameDay
        ? `hoje às ${date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
        : `em ${date.toLocaleDateString("pt-BR")} às ${date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`,
      author = String(row.updated_by_name || "").trim();
    return `Última alteração ${when}${author ? " por " + author : ""}`;
  }
  function showAppError(
    error,
    prefix = "Não foi possível carregar os dados",
    retryAction = null,
  ) {
    const message = errorText(error);
    console.error(prefix, error);
    setCloud(`${prefix}: ${message}`, "error", retryAction);
    notify(message, "error", {
      sticky: true,
      ...(retryAction
        ? { actionLabel: "Tentar novamente", onAction: retryAction }
        : {}),
    });
    return message;
  }
  async function loadSchool(schoolId, { preserveActual = false } = {}) {
    if (!schoolId) return;
    state.ready = false;
    state.conflict = false;
    setCloud("Carregando dados...", "saving");
    try {
      await ensureToken();
      let rows = await rest(
        "school_data",
        `select=payload,updated_at,updated_by,updated_by_name,version&school_id=eq.${q(schoolId)}`,
      );
      let row = rows?.[0],
        payload = row?.payload;
      if (!row) {
        const school =
          state.schools.find((item) => item.id === schoolId) ||
          state.preview?.school ||
          {};
        payload = window.GFP_APP.createEmptyData(school);
        rows = await rest("school_data", "", {
          method: "POST",
          headers: {
            Prefer: "resolution=merge-duplicates,return=representation",
          },
          body: { school_id: schoolId, payload },
        });
        row = rows?.[0] || {
          payload,
          version: 1,
          updated_at: new Date().toISOString(),
          updated_by_name: state.profile?.full_name || "",
        };
      }
      state.schoolId = schoolId;
      state.dataVersion = Number(row.version || 1);
      state.lastChange = row;
      if (!preserveActual && !state.preview) state.actualSchoolId = schoolId;
      state.role =
        state.profile.system_role === "master"
          ? "master"
          : activeMembership(schoolId)?.role || "";
      cacheLocal("gfp_last_school", schoolId);
      const durable = readPending(schoolId);
      if (
        durable?.payload &&
        Number(durable.baseVersion) === state.dataVersion &&
        !isReadOnly()
      ) {
        payload = durable.payload;
        state.pendingPayload = durable.payload;
        state.pendingBaseVersion = state.dataVersion;
      } else if (
        durable?.payload &&
        Number(durable.baseVersion) !== state.dataVersion
      ) {
        state.conflict = true;
        state.pendingPayload = durable.payload;
        state.pendingBaseVersion = Number(durable.baseVersion);
        notify(
          "Os dados foram alterados por outro usuário. A cópia pendente deste computador foi preservada.",
          "warning",
          {
            sticky: true,
            actionLabel: "Recarregar dados",
            onAction: discardPendingAndReload,
          },
        );
      }
      cacheLocal(localCacheKey(), JSON.stringify(payload));
      applyUI();
      if (!window.GFP_APP || typeof window.GFP_APP.setData !== "function")
        throw new Error(
          "A interface do aplicativo não terminou de iniciar. Atualize a página.",
        );
      window.GFP_APP.setData(payload);
      state.ready = true;
      window.GFP_APP.refreshStorageInfo();
      if (state.conflict)
        setCloud(
          "Os dados foram alterados por outro usuário",
          "error",
          discardPendingAndReload,
        );
      else if (state.pendingPayload) {
        setCloud("Alterações pendentes — enviando...", "saving");
        setTimeout(() => flushPendingSave().catch(() => {}), 100);
      } else setCloud(formatLastChange(row), "ok");
      return payload;
    } catch (error) {
      state.ready = false;
      if (state.schoolId)
        try {
          applyUI();
        } catch (uiError) {
          console.error("Falha ao atualizar a interface:", uiError);
        }
      showAppError(error, "Não foi possível carregar os dados", () =>
        loadSchool(schoolId, { preserveActual }),
      );
      throw error;
    }
  }
  async function ensureSchoolReady() {
    if (isReadOnly())
      throw new Error(
        "Saia do modo somente leitura antes de alterar os dados.",
      );
    if (state.schoolId && state.ready) return state.schoolId;
    const selected = el("schoolSelector")?.value;
    if (!selected)
      throw new Error(
        "Selecione uma unidade e aguarde a conexão antes de importar.",
      );
    await loadSchool(selected);
    if (!state.schoolId || !state.ready)
      throw new Error(
        "Não foi possível conectar a unidade selecionada ao banco.",
      );
    return state.schoolId;
  }
  async function switchSchool(schoolId) {
    const previous = state.schoolId;
    if (previous && previous !== schoolId && state.pendingPayload) {
      try {
        await flushPendingSave();
      } catch (error) {
        if (el("schoolSelector")) el("schoolSelector").value = previous;
        notify(
          "Não foi possível trocar de unidade porque ainda há alterações pendentes.",
          "error",
          {
            sticky: true,
            actionLabel: "Tentar novamente",
            onAction: () => switchSchool(schoolId),
          },
        );
        return;
      }
      if (state.pendingPayload) {
        if (el("schoolSelector")) el("schoolSelector").value = previous;
        notify(
          "Resolva o conflito de dados antes de trocar de unidade.",
          "warning",
        );
        return;
      }
    }
    state.pendingPayload = null;
    state.pendingBaseVersion = null;
    await loadSchool(schoolId);
  }
  function queueSave(payload) {
    try {
      localStorage.setItem(localCacheKey(), JSON.stringify(payload));
    } catch {}
    if (!state.ready || !state.schoolId || isReadOnly()) return;
    state.pendingPayload = payload;
    if (state.pendingBaseVersion === null)
      state.pendingBaseVersion = state.dataVersion;
    storePending(payload, state.pendingBaseVersion);
    if (state.conflict) {
      setCloud(
        "Conflito detectado — alterações locais preservadas",
        "error",
        discardPendingAndReload,
      );
      return;
    }
    clearTimeout(state.saveTimer);
    setCloud("Alterações pendentes...", "saving");
    state.saveTimer = setTimeout(
      () => flushPendingSave().catch((e) => console.error(e)),
      650,
    );
  }
  async function discardPendingAndReload() {
    const confirmed = await confirmAction({
      title: "Recarregar dados do banco?",
      message:
        "Os dados do servidor substituirão as alterações pendentes deste computador.",
      detail:
        "Antes de recarregar, o sistema baixará automaticamente um backup das alterações locais.",
      confirmLabel: "Baixar backup e recarregar",
      danger: true,
    });
    if (!confirmed) return;
    const pending = readPending();
    if (pending?.payload) {
      const blob = new Blob([JSON.stringify(pending.payload, null, 2)], {
          type: "application/json",
        }),
        link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `backup_alteracoes_pendentes_${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    }
    clearPending();
    state.pendingPayload = null;
    state.pendingBaseVersion = null;
    state.conflict = false;
    await loadSchool(state.schoolId);
  }
  function markConflict() {
    state.conflict = true;
    setCloud(
      "Os dados foram alterados por outro usuário",
      "error",
      discardPendingAndReload,
    );
    notify(
      "Os dados foram alterados por outro usuário. Suas alterações pendentes foram preservadas e não sobrescreveram o banco.",
      "warning",
      {
        sticky: true,
        actionLabel: "Recarregar dados",
        onAction: discardPendingAndReload,
      },
    );
  }
  async function flushPendingSave() {
    clearTimeout(state.saveTimer);
    if (state.savePromise) return state.savePromise;
    if (
      !state.pendingPayload ||
      isReadOnly() ||
      !state.schoolId ||
      state.conflict
    )
      return;
    state.savePromise = (async () => {
      while (state.pendingPayload && !state.conflict) {
        const payload = state.pendingPayload,
          expected = Number(state.pendingBaseVersion ?? state.dataVersion);
        state.pendingPayload = null;
        state.saving = true;
        setCloud("Salvando...", "saving");
        try {
          await ensureToken();
          const rows = await rest(
            "school_data",
            `school_id=eq.${q(state.schoolId)}&version=eq.${q(expected)}&select=version,updated_at,updated_by,updated_by_name`,
            {
              method: "PATCH",
              headers: { Prefer: "return=representation" },
              body: { payload },
            },
          );
          const confirmed = rows?.[0];
          if (!confirmed) {
            state.pendingPayload = payload;
            storePending(payload, expected);
            markConflict();
            throw new Error("Os dados foram alterados por outro usuário.");
          }
          if (Number(confirmed.version) !== expected + 1)
            throw new Error(
              "O servidor não confirmou a nova versão dos dados.",
            );
          state.dataVersion = Number(confirmed.version);
          state.lastChange = confirmed;
          state.pendingBaseVersion = null;
          clearPending();
          setCloud(formatLastChange(confirmed), "ok");
          await audit("save_school_data", "school_data", {
            app_version: window.GFP_APP.version,
            data_version: state.dataVersion,
          });
          if (state.pendingPayload) {
            state.pendingBaseVersion = state.dataVersion;
            storePending(state.pendingPayload, state.dataVersion);
          }
        } catch (error) {
          if (!state.conflict) {
            state.pendingPayload = state.pendingPayload || payload;
            state.pendingBaseVersion = expected;
            storePending(state.pendingPayload, expected);
            setCloud(
              "Falha ao salvar — alterações locais preservadas",
              "error",
              flushPendingSave,
            );
            notify(errorText(error), "error", {
              sticky: true,
              actionLabel: "Tentar novamente",
              onAction: flushPendingSave,
            });
          }
          throw error;
        } finally {
          state.saving = false;
        }
      }
    })().finally(() => {
      state.savePromise = null;
    });
    return state.savePromise;
  }
  async function saveNow(payload) {
    await ensureSchoolReady();
    queueSave(payload);
    await flushPendingSave();
    if (state.conflict)
      throw new Error(
        "Os dados foram alterados por outro usuário. Recarregue a unidade antes de salvar novamente.",
      );
    window.GFP_APP.setData(payload);
  }
  async function saveTasks(tasks) {
    await ensureSchoolReady();
    if (!canEditTasks())
      throw new Error("Seu perfil nao permite alterar tarefas.");
    const payload = window.GFP_APP.getData();
    payload.tasks = Array.isArray(tasks) ? tasks : [];
    if (!isTaskViewerRole()) {
      await saveNow(payload);
      return;
    }
    if (state.conflict)
      throw new Error(
        "Os dados foram alterados por outro usuario. Recarregue a unidade antes de salvar tarefas.",
      );
    const expected = Number(state.dataVersion || 0);
    state.saving = true;
    setCloud("Salvando tarefas...", "saving");
    try {
      await ensureToken();
      const result = await rest("rpc/update_school_tasks", "", {
        method: "POST",
        body: {
          target_school: state.schoolId,
          expected_version: expected,
          next_tasks: payload.tasks,
        },
      });
      const confirmed = Array.isArray(result) ? result[0] : result;
      if (!confirmed) {
        markConflict();
        throw new Error("Os dados foram alterados por outro usuario.");
      }
      if (Number(confirmed.version) !== expected + 1)
        throw new Error("O servidor nao confirmou a nova versao das tarefas.");
      state.dataVersion = Number(confirmed.version);
      state.lastChange = confirmed;
      setCloud(formatLastChange(confirmed), "ok");
      try {
        localStorage.setItem(localCacheKey(), JSON.stringify(payload));
      } catch {}
      window.GFP_APP.setData(payload);
    } catch (error) {
      if (!state.conflict) {
        setCloud("Falha ao salvar tarefas", "error", () => saveTasks(tasks));
        notify(errorText(error), "error", {
          sticky: true,
          actionLabel: "Tentar novamente",
          onAction: () => saveTasks(tasks),
        });
      }
      throw error;
    } finally {
      state.saving = false;
    }
  }
  async function audit(action, entity, details = {}) {
    try {
      await rest("audit_logs", "", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: {
          school_id: state.schoolId || null,
          actor_user_id: state.user.id,
          effective_user_id: state.preview?.user_id || state.user.id,
          action,
          entity,
          details,
        },
      });
    } catch (e) {
      console.warn("audit", e.message);
    }
  }
  async function auditChange(action, entity, entityId = "", details = {}) {
    if (!state.user?.id || !state.schoolId || isReadOnly()) return;
    const safeDetails = {
      entity_id: String(entityId || "").slice(0, 100),
      actor_name: String(state.profile?.full_name || state.user?.email || "Usuário").slice(0, 160),
    };
    for (const key of ["changed_fields", "related_count", "status"])
      if (details[key] !== undefined) safeDetails[key] = details[key];
    await audit(String(action).slice(0, 50), String(entity).slice(0, 50), safeDetails);
  }
  async function listAuditLogs(limit = 200) {
    if (!state.schoolId || !isSchoolAdminRole() || state.preview) return [];
    const safeLimit = Math.min(500, Math.max(1, Number(limit) || 200));
    return rest("audit_logs", `select=id,action,entity,details,created_at,actor_user_id&school_id=eq.${encodeURIComponent(state.schoolId)}&order=created_at.desc&limit=${safeLimit}`);
  }
  function canOpenView(view) {
    if (view === "admin")
      return state.profile?.system_role === "master" && !state.preview;
    return true;
  }
  function isReadOnly() {
    return Boolean(state.preview) || isTaskViewerRole();
  }
  function isDemoUnit(school) {
    const text = [school?.name, school?.short_name]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("pt-BR");
    return /\bteste\b/.test(text);
  }
  function applyUI() {
    const r = effectiveRole();
    document.body.classList.remove(
      "role-master",
      "role-admin",
      "role-operator",
      "role-consulta",
      "role-director_admin",
      "role-tech_admin",
      "role-director_view",
      "role-tech_view",
      "preview-readonly",
    );
    document.body.classList.add("role-" + r);
    if (isReadOnly()) document.body.classList.add("preview-readonly");
    el("sessionUser").textContent =
      state.preview?.full_name ||
      (state.profile?.system_role === "master"
        ? "MASTER"
        : state.profile?.full_name || state.user?.email || "");
    el("sessionRole").textContent = roleLabel(r);
    const school =
      state.schools.find((s) => s.id === state.schoolId) ||
      state.preview?.school;
    el("headerSchoolName").textContent =
      school?.short_name || school?.name || "Unidade não selecionada";
    const demoUnit = isDemoUnit(school);
    document.body.classList.toggle("demo-unit", demoUnit);
    const demoBadge = el("demoModeBadge");
    if (demoBadge) {
      demoBadge.hidden = !demoUnit;
      demoBadge.style.display = demoUnit ? "" : "none";
    }
    el("previewAsBanner").classList.toggle("active", Boolean(state.preview));
    if (state.preview)
      el("previewAsText").textContent =
        `${state.preview.full_name} • ${school?.name || ""} • ${roleLabel(r)} • ${isTaskViewerRole(r) ? "tarefas liberadas" : "somente leitura"}`;
    el("aboutContactText").textContent =
      [
        cfg.supportEmail && cfg.supportEmail !== "SEU-EMAIL-DE-SUPORTE"
          ? cfg.supportEmail
          : "",
        cfg.supportWhatsApp ? "WhatsApp: " + cfg.supportWhatsApp : "",
      ]
        .filter(Boolean)
        .join(" • ") || "Contato de suporte não configurado.";
    document.querySelectorAll("nav button[data-view]").forEach((b) => {
      if (b.dataset.view === "admin")
        b.style.display =
          state.profile?.system_role === "master" && !state.preview
            ? ""
            : "none";
    });
    const masterSystemBackup = el("masterSystemBackup");
    if (masterSystemBackup)
      masterSystemBackup.hidden = !(
        state.profile?.system_role === "master" && !state.preview
      );
    window.GFP_APP.refreshStorageInfo();
    window.GFP_APP.refreshDashboard?.();
  }
  function populateSchoolSelector() {
    const s = el("schoolSelector");
    s.innerHTML = state.schools
      .map((x) => `<option value="${x.id}">${escapeHtml(x.name)}</option>`)
      .join("");
    if (state.schoolId) s.value = state.schoolId;
    s.disabled = Boolean(state.preview);
  }
  function escapeHtml(v = "") {
    return String(v).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }
  async function showApp() {
    el("authScreen").style.display = "none";
    el("onlineApp").hidden = false;
    document.documentElement.classList.remove("auth-pending");
    populateSchoolSelector();
    applyUI();
    if (state.profile.system_role === "master") await refreshAdmin();
  }
  function showAuthError(msg) {
    const e = el("authError");
    e.textContent = msg;
    e.style.display = "block";
  }
  function retryRestoredStartup() {
    const key = "gfp_restored_startup_retry_" + runtimeVersion;
    try {
      if (sessionStorage.getItem(key)) return false;
      sessionStorage.setItem(key, "1");
    } catch {
      return false;
    }
    setCloud("Atualizando a sessão salva...", "saving");
    setTimeout(() => location.reload(), 80);
    return true;
  }
  function clearRestoredStartupRetry() {
    try {
      sessionStorage.removeItem("gfp_restored_startup_retry_" + runtimeVersion);
    } catch {}
  }
  async function start() {
    document.documentElement.classList.add("auth-pending");
    if (recoveryFromUrl()) return;
    if (!configured()) {
      el("authSetup").style.display = "block";
      return;
    }
    if (restoreSession()) {
      let appShown = false;
      try {
        await validateRestoredSession();
        await loadIdentity();
        const last = localStorage.getItem("gfp_last_school");
        const first =
          last && state.schools.some((s) => s.id === last)
            ? last
            : state.schools[0]?.id;
        await showApp();
        appShown = true;
        if (first) await loadSchool(first);
        clearRestoredStartupRetry();
      } catch (e) {
        console.error(e);
        if (appShown) {
          if (!retryRestoredStartup()) showAppError(e);
        } else {
          clearSession();
          showAuthError(errorText(e));
        }
      }
    }
  }
  async function onLogin(e) {
    e.preventDefault();
    el("authError").style.display = "none";
    const fd = new FormData(e.target);
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    btn.textContent = "Entrando...";
    let appShown = false;
    try {
      await signIn(fd.get("email"), fd.get("password"));
      await loadIdentity();
      await showApp();
      appShown = true;
      const first = state.schools[0]?.id;
      if (first) await loadSchool(first);
      else if (state.profile.system_role === "master") {
        setCloud("Cadastre a primeira escola", "");
        window.GFP_APP.showView("admin");
      }
    } catch (err) {
      if (appShown) showAppError(err);
      else showAuthError(errorText(err));
    } finally {
      btn.disabled = false;
      btn.textContent = "Entrar";
    }
  }
  function schoolFormData(form) {
    const fd = Object.fromEntries(new FormData(form).entries()),
      name = String(fd.name || "").trim(),
      shortName = String(fd.short_name || "").trim(),
      code = String(fd.code || "").trim();
    if (name.length < 3)
      throw new Error("Informe o nome da unidade com pelo menos 3 caracteres.");
    if (shortName.length < 2)
      throw new Error("Informe o nome curto com pelo menos 2 caracteres.");
    return {
      id: String(fd.id || ""),
      name,
      short_name: shortName,
      code: code || null,
      active: fd.active !== "false",
    };
  }
  function resetSchoolForm() {
    const form = el("schoolAdminForm");
    form.reset();
    form.elements.id.value = "";
    el("schoolAdminTitle").textContent = "Nova escola";
    el("schoolAdminSubmit").textContent = "Cadastrar escola";
    el("schoolAdminCancel").hidden = true;
    el("schoolActiveField").hidden = true;
  }
  function editSchool(id) {
    const school = state.adminSchools.find((s) => s.id === id);
    if (!school) return;
    const form = el("schoolAdminForm");
    form.elements.id.value = school.id;
    form.elements.name.value = school.name || "";
    form.elements.short_name.value = school.short_name || "";
    form.elements.code.value = school.code || "";
    form.querySelector(
      `input[name="active"][value="${school.active ? "true" : "false"}"]`,
    ).checked = true;
    el("schoolAdminTitle").textContent = "Editar escola";
    el("schoolAdminSubmit").textContent = "Salvar alterações";
    el("schoolAdminCancel").hidden = false;
    el("schoolActiveField").hidden = false;
    message("schoolAdminMessage", "");
    form.scrollIntoView({ behavior: "smooth", block: "start" });
    form.elements.name.focus();
  }
  async function syncSchoolsAfterAdminChange(
    previousSchoolId = state.schoolId,
  ) {
    await loadIdentity();
    populateSchoolSelector();
    await refreshAdmin();
    if (
      previousSchoolId &&
      !state.schools.some((s) => s.id === previousSchoolId)
    ) {
      const next = state.schools[0];
      state.schoolId = "";
      state.actualSchoolId = "";
      state.ready = false;
      if (next) await loadSchool(next.id);
      else {
        localStorage.removeItem("gfp_last_school");
        applyUI();
        window.GFP_APP.refreshStorageInfo();
        setCloud("Nenhuma escola ativa", "");
      }
    } else {
      populateSchoolSelector();
      applyUI();
    }
  }
  async function saveSchool(e) {
    e.preventDefault();
    const button = e.submitter || e.target.querySelector("[type=submit]"),
      label = button.textContent;
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = "Salvando…";
    message("schoolAdminMessage", "Salvando...");
    try {
      const school = schoolFormData(e.target),
        editing = Boolean(school.id),
        previousSchoolId = state.schoolId;
      if (editing) {
        await rest("schools", `id=eq.${q(school.id)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: {
            name: school.name,
            short_name: school.short_name,
            code: school.code,
            active: school.active,
          },
        });
      } else {
        const rows = await rest("schools", "", {
            method: "POST",
            headers: { Prefer: "return=representation" },
            body: {
              name: school.name,
              short_name: school.short_name,
              code: school.code,
              active: true,
            },
          }),
          created = rows?.[0];
        if (!created)
          throw new Error(
            "A escola foi criada, mas o servidor não retornou o cadastro. Atualize a página.",
          );
        await rest("school_data", "", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: {
            school_id: created.id,
            payload: window.GFP_APP.createEmptyData(created),
          },
        });
      }
      resetSchoolForm();
      await syncSchoolsAfterAdminChange(previousSchoolId);
      message(
        "schoolAdminMessage",
        editing
          ? "Escola atualizada com sucesso."
          : "Escola cadastrada vazia com sucesso.",
        "ok",
      );
      notify(
        editing
          ? "Escola atualizada com sucesso."
          : "Escola cadastrada vazia com sucesso.",
        "success",
      );
    } catch (err) {
      message("schoolAdminMessage", errorText(err), "error");
      notify(err, "error");
    } finally {
      button.disabled = false;
      if (button.textContent === "Salvando…") button.textContent = label;
    }
  }
  async function deleteSchool(id) {
    const school = state.adminSchools.find((item) => item.id === id);
    if (!school) return;
    const confirmed = await window.GFP_APP?.promptTypedConfirmation?.({
      title: "Excluir escola permanentemente?",
      message: "A escola, seus dados e todos os vínculos serão removidos.",
      detail: "Esta ação não pode ser desfeita.",
      expected: school.name,
      label: `Digite o nome da unidade: ${school.name}`,
    });
    if (!confirmed) return;
    const previousSchoolId = state.schoolId;
    message("schoolAdminMessage", "Excluindo escola...");
    try {
      if (id === state.schoolId) {
        clearTimeout(state.saveTimer);
        state.pendingPayload = null;
        state.pendingBaseVersion = null;
        state.ready = false;
      }
      const deleted = await rest("schools", `id=eq.${q(id)}&select=id`, {
        method: "DELETE",
        headers: { Prefer: "return=representation" },
      });
      if (!deleted?.length)
        throw new Error(
          "A escola não foi excluída. Atualize a página e tente novamente.",
        );
      try {
        localStorage.removeItem("gfp_school_cache_" + id);
        localStorage.removeItem(pendingSaveKey(id));
      } catch {}
      resetSchoolForm();
      await syncSchoolsAfterAdminChange(previousSchoolId);
      message("schoolAdminMessage", "Escola excluída permanentemente.", "ok");
      notify("Escola excluída permanentemente.", "success");
    } catch (error) {
      message("schoolAdminMessage", errorText(error), "error");
      notify(error, "error");
    }
  }
  async function adminCall(body) {
    await ensureToken();
    return request("/functions/v1/admin-users", { method: "POST", body });
  }
  function systemBackupTimestamp() {
    return new Date().toISOString().replace(/[:.]/g, "-");
  }
  function downloadJsonFile(value, filename) {
    const blob = new Blob([JSON.stringify(value, null, 2)], {
        type: "application/json;charset=utf-8",
      }),
      link = document.createElement("a"),
      url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  function validateSystemBackupFile(backup) {
    if (!backup || typeof backup !== "object")
      throw new Error("O arquivo selecionado não contém um backup válido.");
    if (backup.format !== "gestao-funcionarios-ponto/system-backup")
      throw new Error("Este arquivo não é um backup geral deste sistema.");
    if (Number(backup.version) !== 1)
      throw new Error("A versão deste backup geral não é compatível.");
    for (const field of ["schools", "school_data", "users", "memberships"])
      if (!Array.isArray(backup[field]))
        throw new Error(`O backup está incompleto: campo ${field} ausente.`);
    if (!backup.schools.length)
      throw new Error("O backup geral não contém nenhuma escola.");
    return backup;
  }
  function clearSystemRestoreLocalState() {
    clearTimeout(state.saveTimer);
    state.pendingPayload = null;
    state.pendingBaseVersion = null;
    state.conflict = false;
    state.ready = false;
    try {
      const keys = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index) || "";
        if (
          key.startsWith("gfp_school_cache_") ||
          key.startsWith("gfp_pending_save_")
        )
          keys.push(key);
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch {}
  }
  async function requestSystemBackup() {
    const result = await adminCall({
      action: "export_system_backup",
      app_version: window.GFP_APP?.version || "2.0 Online",
    });
    return validateSystemBackupFile(result?.backup);
  }
  async function exportSystemBackup() {
    if (state.profile?.system_role !== "master" || state.preview) return;
    const button = el("exportSystemBackupBtn"),
      originalLabel = button.textContent;
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = "Gerando backup…";
    message("systemBackupMessage", "Reunindo todas as escolas e usuários...");
    try {
      const backup = await requestSystemBackup();
      downloadJsonFile(
        backup,
        `backup_geral_gestao_ponto_${systemBackupTimestamp()}.json`,
      );
      message(
        "systemBackupMessage",
        `Backup geral exportado: ${backup.schools.length} escola(s), ${backup.users.length} usuário(s) e ${backup.memberships.length} vínculo(s).`,
        "ok",
      );
      notify("Backup geral exportado com sucesso.", "success");
    } catch (error) {
      message("systemBackupMessage", errorText(error), "error");
      notify(error, "error");
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
  async function restoreSystemBackup(event) {
    const input = event.target,
      file = input.files?.[0];
    if (!file) return;
    if (state.profile?.system_role !== "master" || state.preview) {
      input.value = "";
      return;
    }
    const label = el("restoreSystemBackupLabel"),
      originalLabel = label.firstChild?.textContent || "Restaurar backup geral";
    try {
      if (file.size > 15 * 1024 * 1024)
        throw new Error("O arquivo excede o limite de 15 MB.");
      let backup;
      try {
        backup = JSON.parse(await file.text());
      } catch {
        throw new Error("O arquivo selecionado não contém um JSON válido.");
      }
      validateSystemBackupFile(backup);
      const confirmed = await window.GFP_APP?.promptTypedConfirmation?.({
        title: "Restaurar o sistema inteiro?",
        message: `O arquivo contém ${backup.schools.length} escola(s), ${backup.users.length} usuário(s) e ${backup.memberships.length} vínculo(s).`,
        detail:
          "Escolas, dados e vínculos atuais serão substituídos. Uma cópia automática do estado atual será baixada antes da alteração. Senhas e credenciais de login não serão modificadas.",
        expected: "RESTAURAR SISTEMA",
        label: "Digite RESTAURAR SISTEMA para confirmar",
      });
      if (!confirmed) return;
      input.disabled = true;
      label.style.pointerEvents = "none";
      label.style.opacity = ".65";
      if (label.firstChild) label.firstChild.textContent = "Restaurando…";
      message(
        "systemBackupMessage",
        "Criando a cópia automática de segurança...",
      );
      const currentBackup = await requestSystemBackup();
      downloadJsonFile(
        currentBackup,
        `backup_automatico_antes_restauracao_${systemBackupTimestamp()}.json`,
      );
      message("systemBackupMessage", "Restaurando os dados do sistema...");
      const result = await adminCall({
        action: "restore_system_backup",
        backup,
        mode: "replace",
      });
      const previousSchoolId = state.schoolId;
      clearSystemRestoreLocalState();
      await loadIdentity();
      state.schoolId = "";
      state.actualSchoolId = "";
      populateSchoolSelector();
      await refreshAdmin();
      const target =
        state.schools.find((school) => school.id === previousSchoolId) ||
        state.schools[0];
      if (target) await loadSchool(target.id);
      applyUI();
      const missingCount = result?.missing_users?.length || 0,
        summary = `Restauração concluída: ${result.schools_restored} escola(s), ${result.data_restored} conjunto(s) de dados e ${result.memberships_restored} vínculo(s).`;
      message(
        "systemBackupMessage",
        `${summary}${missingCount ? ` ${missingCount} usuário(s) do arquivo não possuem login atual e foram ignorados.` : ""}`,
        missingCount ? "" : "ok",
      );
      notify(
        missingCount
          ? `${summary} Revise os usuários que não puderam ser vinculados.`
          : summary,
        missingCount ? "warning" : "success",
      );
    } catch (error) {
      message("systemBackupMessage", errorText(error), "error");
      notify(error, "error", { sticky: true });
    } finally {
      input.disabled = false;
      input.value = "";
      label.style.pointerEvents = "";
      label.style.opacity = "";
      if (label.firstChild) label.firstChild.textContent = originalLabel;
    }
  }
  function resetUserForm() {
    const form = el("userAdminForm");
    form.reset();
    form.elements.user_id.value = "";
    form.elements.membership_id.value = "";
    form.elements.password.required = true;
    el("userAdminTitle").textContent = "Criar usuário";
    el("userAdminSubmit").textContent = "Criar usuário";
    el("userAdminCancel").hidden = true;
    el("userPasswordHint").textContent = "Obrigatória na criação.";
  }
  function editUser(userId, membershipId) {
    const user = state.adminUsers.find((item) => item.id === userId),
      membership = user?.memberships?.find((item) => item.id === membershipId);
    if (!user || user.system_role === "master") return;
    const form = el("userAdminForm");
    form.elements.user_id.value = user.id;
    form.elements.membership_id.value = membership?.id || "";
    form.elements.full_name.value = user.full_name || "";
    form.elements.email.value = user.email || "";
    form.elements.password.value = "";
    form.elements.password.required = false;
    if (membership) {
      form.elements.school_id.value = membership.school_id;
      form.elements.role.value =
        [...form.elements.role.options].some((option) => option.value === membership.role)
          ? membership.role
          : membership.role === "consulta"
            ? "director_view"
            : "admin";
    }
    form.querySelector(
      `input[name="active"][value="${user.active ? "true" : "false"}"]`,
    ).checked = true;
    el("userAdminTitle").textContent = "Editar usuário";
    el("userAdminSubmit").textContent = "Salvar alterações";
    el("userAdminCancel").hidden = false;
    el("userPasswordHint").textContent =
      "Deixe em branco para manter a senha atual.";
    message("userAdminMessage", "");
    form.scrollIntoView({ behavior: "smooth", block: "start" });
    form.elements.full_name.focus();
  }
  async function saveUser(e) {
    e.preventDefault();
    const button = e.submitter || e.target.querySelector("[type=submit]"),
      label = button.textContent;
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = "Salvando…";
    const fd = Object.fromEntries(new FormData(e.target).entries()),
      editing = Boolean(fd.user_id);
    message(
      "userAdminMessage",
      editing ? "Salvando alterações..." : "Criando usuário...",
    );
    try {
      await adminCall({
        action: editing ? "update_user_details" : "create",
        ...fd,
        active: fd.active === "true",
      });
      resetUserForm();
      await refreshAdmin();
      message(
        "userAdminMessage",
        editing
          ? "Usuário atualizado com sucesso."
          : "Usuário criado. Entregue a senha temporária e peça a troca no primeiro acesso.",
        "ok",
      );
      notify(
        editing
          ? "Usuário atualizado com sucesso."
          : "Usuário criado com sucesso.",
        "success",
      );
    } catch (err) {
      message("userAdminMessage", errorText(err), "error");
      notify(err, "error");
    } finally {
      button.disabled = false;
      if (button.textContent === "Salvando…") button.textContent = label;
    }
  }
  async function addMembership(e) {
    e.preventDefault();
    const button = e.submitter || e.target.querySelector("[type=submit]"),
      label = button.textContent;
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = "Salvando…";
    const fd = Object.fromEntries(new FormData(e.target).entries());
    message("membershipAdminMessage", "Salvando vínculo...");
    try {
      await adminCall({ action: "add_membership", ...fd });
      await refreshAdmin();
      message("membershipAdminMessage", "Vínculo salvo com sucesso.", "ok");
      notify("Vínculo salvo com sucesso.", "success");
    } catch (err) {
      message("membershipAdminMessage", errorText(err), "error");
      notify(err, "error");
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }
  async function deleteUser(userId) {
    const user = state.adminUsers.find((item) => item.id === userId);
    if (!user || user.system_role === "master") return;
    const label = user.email || user.full_name,
      confirmed = await window.GFP_APP?.promptTypedConfirmation?.({
        title: "Excluir usuário permanentemente?",
        message: "O login e todos os vínculos deste usuário serão removidos.",
        detail: "Esta ação não pode ser desfeita.",
        expected: label,
        label: `Digite o e-mail para confirmar: ${label}`,
      });
    if (!confirmed) return;
    message("userAdminMessage", "Excluindo usuário...");
    try {
      await adminCall({ action: "delete_user", user_id: user.id });
      resetUserForm();
      await refreshAdmin();
      message("userAdminMessage", "Usuário excluído permanentemente.", "ok");
      notify("Usuário excluído permanentemente.", "success");
    } catch (error) {
      message("userAdminMessage", errorText(error), "error");
      notify(error, "error");
    }
  }
  function message(id, text, type = "") {
    const x = el(id);
    x.textContent = errorText(
      text,
      type === "error" ? "Não foi possível concluir a operação." : "",
    );
    x.style.color =
      type === "error" ? "#b42318" : type === "ok" ? "#157347" : "#475467";
  }
  async function refreshAdmin() {
    if (state.profile?.system_role !== "master" || state.preview) return;
    try {
      const result = await adminCall({ action: "list" });
      state.adminUsers = result.users || [];
      state.adminSchools = result.schools || [];
      renderAdmin();
    } catch (e) {
      message("userAdminMessage", errorText(e), "error");
    }
  }
  function renderAdmin() {
    const schools = state.adminSchools,
      activeSchools = schools.filter((s) => s.active);
    el("adminUserSchool").innerHTML = activeSchools
      .map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`)
      .join("");
    el("adminMembershipSchool").innerHTML = el("adminUserSchool").innerHTML;
    el("adminExistingUser").innerHTML = state.adminUsers
      .filter((u) => u.system_role !== "master")
      .map(
        (u) =>
          `<option value="${u.id}">${escapeHtml(u.full_name || u.email)}</option>`,
      )
      .join("");
    el("adminSchoolsTable").innerHTML = schools.length
      ? `<div class="table-wrap"><table class="admin-table"><thead><tr><th>Escola</th><th>Nome curto</th><th>Código</th><th>Status</th><th>Ações</th></tr></thead><tbody>${schools.map((s) => `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.short_name || "")}</td><td>${escapeHtml(s.code || "")}</td><td><span class="${s.active ? "tag-active" : "tag-inactive"}">${s.active ? "Ativa" : "Inativa"}</span></td><td><button class="mini-btn edit admin-school-edit" data-school="${s.id}" type="button">Editar</button> <button class="mini-btn del admin-school-delete" data-school="${s.id}" type="button">Excluir</button></td></tr>`).join("")}</tbody></table></div>`
      : '<div class="empty">Nenhuma escola.</div>';
    const rows = [];
    for (const u of state.adminUsers) {
      const memberships = u.memberships || [];
      if (!memberships.length) rows.push({ u, m: null });
      else memberships.forEach((m) => rows.push({ u, m }));
    }
    el("adminUsersTable").innerHTML = rows.length
      ? `<div class="table-wrap"><table class="admin-table"><thead><tr><th>Usuário</th><th>Escola</th><th>Permissão</th><th>Status</th><th>Ações</th></tr></thead><tbody>${rows.map(({ u, m }) => `<tr><td>${escapeHtml(u.full_name || u.email)}<br><small>${escapeHtml(u.email || "")}</small></td><td>${escapeHtml(m?.school?.name || "Sem vínculo")}</td><td>${m ? escapeHtml(roleLabel(m.role)) : escapeHtml(roleLabel(u.system_role))}</td><td><span class="${u.active ? "tag-active" : "tag-inactive"}">${u.active ? "Ativo" : "Inativo"}</span></td><td>${u.system_role !== "master" && m ? `<button class="mini-btn edit admin-user-edit" data-user="${u.id}" data-membership="${m.id}" type="button">Editar</button> <button class="mini-btn edit admin-preview" data-user="${u.id}" data-school="${m.school_id}" type="button">Visualizar</button> <button class="mini-btn edit admin-reset" data-user="${u.id}" type="button">Nova senha</button> <button class="mini-btn del admin-user-delete" data-user="${u.id}" type="button">Excluir</button>` : "Conta mestre protegida"}</td></tr>`).join("")}</tbody></table></div>`
      : '<div class="empty">Nenhum usuário cadastrado.</div>';
    document
      .querySelectorAll(".admin-school-edit")
      .forEach((b) =>
        b.addEventListener("click", () => editSchool(b.dataset.school)),
      );
    document
      .querySelectorAll(".admin-school-delete")
      .forEach((b) =>
        b.addEventListener("click", () => deleteSchool(b.dataset.school)),
      );
    document
      .querySelectorAll(".admin-user-edit")
      .forEach((b) =>
        b.addEventListener("click", () =>
          editUser(b.dataset.user, b.dataset.membership),
        ),
      );
    document
      .querySelectorAll(".admin-user-delete")
      .forEach((b) =>
        b.addEventListener("click", () => deleteUser(b.dataset.user)),
      );
    document
      .querySelectorAll(".admin-preview")
      .forEach((b) =>
        b.addEventListener("click", () =>
          enterPreview(b.dataset.user, b.dataset.school),
        ),
      );
    document
      .querySelectorAll(".admin-reset")
      .forEach((b) =>
        b.addEventListener("click", () => resetUserPassword(b.dataset.user)),
      );
  }
  async function resetUserPassword(userId) {
    const password = await window.GFP_APP?.promptPassword?.();
    if (!password) return;
    try {
      await adminCall({ action: "reset_password", user_id: userId, password });
      notify("Senha temporária atualizada.", "success");
    } catch (e) {
      notify(e, "error");
    }
  }
  async function enterPreview(userId, schoolId) {
    const u = state.adminUsers.find((x) => x.id === userId),
      m = u?.memberships?.find((x) => x.school_id === schoolId);
    if (!u || !m) return;
    state.preview = {
      user_id: u.id,
      full_name: u.full_name || u.email,
      role: m.role,
      school: m.school,
    };
    state.actualSchoolId = state.schoolId;
    state.schools = await rest(
      "schools",
      "select=*&active=eq.true&order=name.asc",
    );
    populateSchoolSelector();
    await loadSchool(schoolId, { preserveActual: true });
    applyUI();
    window.GFP_APP.showView("inicio");
  }
  async function exitPreview() {
    const back = state.actualSchoolId;
    state.preview = null;
    await loadIdentity();
    populateSchoolSelector();
    if (back && state.schools.some((s) => s.id === back))
      await loadSchool(back);
    else if (state.schools[0]) await loadSchool(state.schools[0].id);
    applyUI();
    await refreshAdmin();
  }
  function blockPreviewMutations(e) {
    if (!state.preview) return;
    const target = e.target;
    const form = target.closest?.("form");
    const view = target.closest?.(".view")?.id || "";
    if (e.type === "submit" && form) {
      e.preventDefault();
      e.stopImmediatePropagation();
      notify("O modo de visualização é somente leitura.", "warning");
      return;
    }
    if (
      e.type === "click" &&
      (target.matches(".mini-btn.edit,.mini-btn.del,.btn.danger") ||
        ([
          "view-config",
          "view-funcionarios",
          "view-professores",
          "view-calendario",
          "view-afastamentos",
          "view-ocorrencias",
          "view-backup",
        ].includes(view) &&
          target.matches("button.btn")))
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      notify("O modo de visualização é somente leitura.", "warning");
    }
  }
  function bind() {
    el("loginForm").addEventListener("submit", onLogin);
    el("recoveryForm").addEventListener("submit", completeRecovery);
    el("forgotPasswordBtn").addEventListener("click", () =>
      resetPassword().catch((e) => showAuthError(errorText(e))),
    );
    el("logoutBtn").addEventListener("click", signOut);
    el("schoolSelector").addEventListener("change", (e) =>
      switchSchool(e.target.value).catch(() => {}),
    );
    el("cloudRetryButton")?.addEventListener("click", () =>
      state.retryAction?.(),
    );
    el("schoolAdminForm").addEventListener("submit", saveSchool);
    el("schoolAdminCancel").addEventListener("click", () => {
      resetSchoolForm();
      message("schoolAdminMessage", "");
    });
    el("userAdminForm").addEventListener("submit", saveUser);
    el("userAdminCancel").addEventListener("click", () => {
      resetUserForm();
      message("userAdminMessage", "");
    });
    el("membershipAdminForm").addEventListener("submit", addMembership);
    el("exportSystemBackupBtn")?.addEventListener("click", exportSystemBackup);
    el("systemBackupFile")?.addEventListener("change", restoreSystemBackup);
    el("exitPreviewBtn").addEventListener("click", exitPreview);
    document.addEventListener("submit", blockPreviewMutations, true);
    document.addEventListener("click", blockPreviewMutations, true);
  }
  bind();
  window.gfpOnline = {
    start,
    queueSave,
    saveNow,
    saveTasks,
    ensureSchoolReady,
    isReady: () => state.ready,
    isReadOnly,
    canEditTasks,
    canDeleteTasks,
    canOpenView,
    canPermanentlyDelete: canDeleteTasks,
    canViewAudit: () => isSchoolAdminRole() && !state.preview,
    auditChange,
    listAuditLogs,
    storageLabel: () =>
      state.schoolId
        ? "Banco online da unidade selecionada"
        : "Nenhuma unidade selecionada",
    currentSchool: () =>
      state.schools.find((item) => item.id === state.schoolId) ||
      state.preview?.school ||
      null,
    refreshAdmin,
    dashboardContext: () => {
      const school =
        state.schools.find((item) => item.id === state.schoolId) ||
        state.preview?.school;
      return {
        userName:
          state.preview?.full_name ||
          (state.profile?.system_role === "master" && !state.preview
            ? "MASTER"
            : "") ||
          state.profile?.full_name ||
          state.user?.email ||
          "",
        schoolName: school?.name || school?.short_name || "",
        cloudStatus: el("cloudStatus")?.textContent || "",
        isMaster: state.profile?.system_role === "master" && !state.preview,
        schoolCount: state.schools.length,
        userCount: state.adminUsers.filter(
          (item) => item.system_role !== "master",
        ).length,
      };
    },
  };
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) location.reload();
  });
  start();
})();
