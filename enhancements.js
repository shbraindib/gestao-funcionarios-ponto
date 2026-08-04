(function () {
  "use strict";

  const registryState = {
    employee: { search: "", dirty: false, snapshot: "", open: false },
    teacher: { search: "", dirty: false, snapshot: "", open: false },
  };
  const labels = {
    employee: {
      one: "funcionário",
      many: "Funcionários",
      view: "funcionarios",
    },
    teacher: { one: "professor", many: "Professores", view: "professores" },
  };

  function readableError(
    value,
    fallback = "Não foi possível concluir a operação.",
  ) {
    if (value instanceof Error) return readableError(value.message, fallback);
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
        const text = readableError(value[key], "");
        if (text) return text;
      }
      try {
        const text = JSON.stringify(value);
        if (text && text !== "{}") return text;
      } catch {}
    }
    return fallback;
  }

  function ensureToastRegion() {
    let host = document.getElementById("toastRegion");
    if (!host) {
      host = document.createElement("div");
      host.id = "toastRegion";
      host.className = "toast-region";
      host.setAttribute("role", "region");
      host.setAttribute("aria-label", "Notificações");
      document.body.appendChild(host);
    }
    return host;
  }
  function notify(message, type = "info", options = {}) {
    const host = ensureToastRegion(),
      toast = document.createElement("div");
    toast.className = `app-toast ${type}`;
    toast.setAttribute("role", type === "error" ? "alert" : "status");
    const body = document.createElement("span");
    body.textContent = readableError(message);
    const actions = document.createElement("span");
    actions.className = "app-toast-actions";
    if (options.actionLabel && typeof options.onAction === "function") {
      const action = document.createElement("button");
      action.type = "button";
      action.textContent = options.actionLabel;
      action.addEventListener("click", () => {
        toast.remove();
        options.onAction();
      });
      actions.appendChild(action);
    }
    const close = document.createElement("button");
    close.type = "button";
    close.className = "toast-close";
    close.setAttribute("aria-label", "Fechar");
    close.textContent = "×";
    close.addEventListener("click", () => toast.remove());
    actions.appendChild(close);
    toast.append(body, actions);
    host.appendChild(toast);
    if (!options.sticky)
      setTimeout(() => toast.remove(), options.duration || 5000);
    return toast;
  }

  function openDialog({
    title,
    message = "",
    detail = "",
    confirmLabel = "Confirmar",
    cancelLabel = "Cancelar",
    danger = false,
    input = null,
    validate = null,
  }) {
    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      backdrop.className = "dialog-backdrop";
      const dialog = document.createElement("div");
      dialog.className = "app-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.innerHTML = `<h2></h2><p class="dialog-message"></p>${detail ? '<p class="dialog-detail"></p>' : ""}<div class="dialog-fields"></div><div class="dialog-error" role="alert"></div><div class="app-dialog-actions"><button class="btn light dialog-cancel" type="button"></button><button class="btn dialog-confirm" type="button"></button></div>`;
      dialog.querySelector("h2").textContent = title;
      dialog.querySelector(".dialog-message").textContent = message;
      dialog.querySelector(".dialog-cancel").textContent = cancelLabel;
      const confirm = dialog.querySelector(".dialog-confirm");
      confirm.textContent = confirmLabel;
      if (danger) confirm.classList.add("danger");
      if (detail) dialog.querySelector(".dialog-detail").textContent = detail;
      const fields = dialog.querySelector(".dialog-fields"),
        controls = {};
      for (const field of input || []) {
        const label = document.createElement("label");
        label.textContent = field.label;
        const control = document.createElement("input");
        control.name = field.name;
        control.type = field.type || "text";
        control.autocomplete = field.autocomplete || "off";
        control.placeholder = field.placeholder || "";
        label.appendChild(control);
        fields.appendChild(label);
        controls[field.name] = control;
      }
      backdrop.appendChild(dialog);
      document.body.appendChild(backdrop);
      const finish = (value) => {
        backdrop.remove();
        resolve(value);
      };
      dialog
        .querySelector(".dialog-cancel")
        .addEventListener("click", () => finish(null));
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) finish(null);
      });
      dialog.addEventListener("keydown", (e) => {
        if (e.key === "Escape") finish(null);
      });
      confirm.addEventListener("click", () => {
        const values = Object.fromEntries(
          Object.entries(controls).map(([key, control]) => [
            key,
            control.value,
          ]),
        );
        const error = validate?.(values);
        if (error) {
          dialog.querySelector(".dialog-error").textContent = error;
          Object.values(controls)[0]?.focus();
          return;
        }
        finish(input ? values : true);
      });
      setTimeout(
        () => Object.values(controls)[0]?.focus() || confirm.focus(),
        0,
      );
    });
  }
  function confirmAction(options) {
    return openDialog(options).then(Boolean);
  }
  function promptEmail() {
    return openDialog({
      title: "Recuperar senha",
      message:
        "Informe o e-mail da conta para receber as instruções de recuperação.",
      confirmLabel: "Enviar instruções",
      input: [{ name: "email", label: "E-mail", autocomplete: "email" }],
      validate: (v) => (v.email.trim() ? "" : "Informe o e-mail da conta."),
    }).then((v) => v?.email.trim() || null);
  }
  function promptPassword() {
    return openDialog({
      title: "Definir senha temporária",
      message: "Crie uma senha temporária com pelo menos 8 caracteres.",
      confirmLabel: "Atualizar senha",
      input: [
        {
          name: "password",
          label: "Nova senha",
          type: "password",
          autocomplete: "new-password",
        },
        {
          name: "confirm",
          label: "Confirmar nova senha",
          type: "password",
          autocomplete: "new-password",
        },
      ],
      validate: (v) =>
        v.password.length < 8
          ? "A senha precisa ter pelo menos 8 caracteres."
          : v.password !== v.confirm
            ? "As senhas não coincidem."
            : "",
    }).then((v) => v?.password || null);
  }
  function promptTypedConfirmation({
    title,
    message,
    detail,
    expected,
    label = "Digite para confirmar",
    confirmLabel = "Excluir permanentemente",
  }) {
    return openDialog({
      title,
      message,
      detail,
      confirmLabel,
      danger: true,
      input: [{ name: "typed", label }],
      validate: (v) =>
        v.typed.trim().toLocaleLowerCase("pt-BR") ===
        String(expected).trim().toLocaleLowerCase("pt-BR")
          ? ""
          : `Digite exatamente: ${expected}`,
    }).then(Boolean);
  }

  function registryConfig(type) {
    return type === "employee"
      ? {
          formId: "employeeForm",
          tableId: "employeeTable",
          sectionId: "view-funcionarios",
          array: "employees",
        }
      : {
          formId: "teacherForm",
          tableId: "teacherTable",
          sectionId: "view-professores",
          array: "teachers",
        };
  }
  function formSnapshot(form) {
    return JSON.stringify([...new FormData(form).entries()]);
  }
  function fieldContainer(form, name) {
    const control = form.elements[name];
    const node = control instanceof RadioNodeList ? control[0] : control;
    return node?.closest("label,.field-block") || null;
  }
  function addFieldError(form, name, message) {
    const container = fieldContainer(form, name);
    if (!container) return;
    container.classList.add("field-invalid");
    let error = container.querySelector(":scope > .field-error-text");
    if (!error) {
      error = document.createElement("span");
      error.className = "field-error-text";
      container.appendChild(error);
    }
    error.textContent = message;
  }
  function clearFieldErrors(form) {
    form
      .querySelectorAll(".field-invalid")
      .forEach((node) => node.classList.remove("field-invalid"));
    form.querySelectorAll(".field-error-text").forEach((node) => node.remove());
  }
  function addObservations(form) {
    if (form.elements.observacoes) return;
    const label = document.createElement("label");
    label.textContent = "Observações internas";
    const area = document.createElement("textarea");
    area.name = "observacoes";
    area.placeholder =
      "Informações internas que não serão impressas automaticamente";
    label.appendChild(area);
    form.querySelector(".grid")?.appendChild(label);
  }
  function groupForm(form, groups) {
    const grid = form.querySelector(".grid"),
      used = new Set();
    for (const group of groups) {
      const fieldset = document.createElement("fieldset");
      fieldset.className = "registry-form-group";
      const legend = document.createElement("legend");
      legend.textContent = group.title;
      const fields = document.createElement("div");
      fields.className = "registry-form-fields";
      fieldset.append(legend, fields);
      for (const name of group.names) {
        const container = fieldContainer(form, name);
        if (container && !used.has(container)) {
          used.add(container);
          fields.appendChild(container);
        }
      }
      if (fields.children.length) grid.appendChild(fieldset);
    }
  }
  function toggleSubstitution(form) {
    const show = form.elements.substituto?.value === "Sim";
    form.querySelectorAll("[data-substitution-field]").forEach((node) => {
      node.hidden = !show;
      node.classList.toggle("substitution-fields", true);
    });
    if (!show)
      for (const name of [
        "substituicaoFuncao",
        "substituicaoCH",
        "substituicaoUnidade",
      ])
        if (form.elements[name]) form.elements[name].value = "";
  }
  function setupRegistry(type) {
    const cfg = registryConfig(type),
      section = document.getElementById(cfg.sectionId),
      form = document.getElementById(cfg.formId);
    if (!section || !form) return;
    const formCard = form.closest(".card"),
      listCard = document.getElementById(cfg.tableId).closest(".card");
    section.insertBefore(listCard, formCard);
    formCard.classList.add("registry-editor-card");
    const backdrop = document.createElement("div");
    backdrop.className = "registry-backdrop";
    backdrop.dataset.registry = type;
    document.body.appendChild(backdrop);
    const originalHeading = formCard.querySelector("h2");
    const head = document.createElement("div");
    head.className = "registry-editor-head";
    head.innerHTML = `<div><h2>${originalHeading.textContent}</h2><p>Preencha os campos e confirme para salvar no banco online.</p></div><button class="registry-editor-close" type="button" aria-label="Fechar">×</button>`;
    originalHeading.replaceWith(head);
    addObservations(form);
    const groups =
      type === "employee"
        ? [
            { title: "Dados pessoais", names: ["nome", "nascimento"] },
            {
              title: "Vínculo funcional",
              names: [
                "matricula",
                "cargo",
                "situacaoFuncional",
                "setor",
                "status",
              ],
            },
            {
              title: "Jornada de trabalho",
              names: [
                "jornada",
                "horario",
                "intervalo",
                "plantao",
                "estudante",
              ],
            },
            {
              title: "Contatos",
              names: ["telefone", "contatoEmergencia", "telefoneEmergencia"],
            },
            { title: "Documentos", names: ["docTipo", "rg"] },
            {
              title: "Informações para impressão",
              names: ["observacaoCadastro"],
            },
            { title: "Observações", names: ["observacoes"] },
          ]
        : [
            { title: "Dados pessoais", names: ["nome", "nascimento"] },
            {
              title: "Vínculo funcional",
              names: [
                "matricula",
                "situacao",
                "categoria",
                "disciplina",
                "setor",
                "status",
              ],
            },
            {
              title: "Jornada de trabalho",
              names: [
                "jornada",
                "cargaSuplementar",
                "cargaHoraria",
                "horario",
                "intervalo",
              ],
            },
            {
              title: "Contatos",
              names: ["telefone", "contatoEmergencia", "telefoneEmergencia"],
            },
            { title: "Documentos", names: ["docTipo", "rg", "fn"] },
            {
              title: "Substituição",
              names: [
                "substituto",
                "substituicaoFuncao",
                "substituicaoCH",
                "substituicaoUnidade",
              ],
            },
            {
              title: "Informações para impressão",
              names: [
                "sede",
                "sedeLocal",
                "atn5",
                "atn20",
                "observacaoFrequencia",
                "observacaoCadastro",
              ],
            },
            { title: "Observações", names: ["observacoes"] },
          ];
    groupForm(form, groups);
    if (type === "teacher") {
      const substitute = fieldContainer(form, "substituto");
      if (substitute)
        substitute.childNodes[0].textContent = "Professor substituto";
      for (const name of [
        "substituicaoFuncao",
        "substituicaoCH",
        "substituicaoUnidade",
      ])
        fieldContainer(form, name)?.setAttribute("data-substitution-field", "");
      form.elements.substituto?.addEventListener("change", () =>
        toggleSubstitution(form),
      );
      toggleSubstitution(form);
    }
    const actions = form.querySelector(".actions"),
      submit = actions.querySelector("[type=submit]"),
      cancel = actions.querySelector("[type=button]");
    cancel.textContent = "Cancelar";
    cancel.removeAttribute("onclick");
    cancel.addEventListener("click", () => closeEditor(type));
    head
      .querySelector("button")
      .addEventListener("click", () => closeEditor(type));
    backdrop.addEventListener("click", () => closeEditor(type));
    form.addEventListener("input", () => {
      registryState[type].dirty =
        formSnapshot(form) !== registryState[type].snapshot;
    });
    form.addEventListener("change", () => {
      registryState[type].dirty =
        formSnapshot(form) !== registryState[type].snapshot;
    });
    form.addEventListener(
      "submit",
      (event) => handleRegistrySubmit(event, type, submit),
      true,
    );
    const toolbar = document.createElement("div");
    toolbar.className = "registry-toolbar";
    toolbar.innerHTML = `<div class="registry-search"><input type="search" aria-label="Pesquisar ${labels[type].many.toLocaleLowerCase("pt-BR")}" placeholder="Pesquisar por nome, matrícula ou função"></div><button class="btn" type="button">Novo ${labels[type].one}</button>`;
    listCard.insertBefore(
      toolbar,
      listCard.querySelector(".card-subtitle")?.nextSibling ||
        document.getElementById(cfg.tableId),
    );
    toolbar.querySelector("input").addEventListener("input", (e) => {
      registryState[type].search = e.target.value;
      registryPrefs(type).page = 1;
      renderRegistryList(type);
    });
    toolbar
      .querySelector("button")
      .addEventListener("click", () => openEditor(type));
  }
  function openEditor(type, item = null) {
    const cfg = registryConfig(type),
      form = document.getElementById(cfg.formId),
      card = form.closest(".registry-editor-card");
    resetForm(cfg.formId);
    clearFieldErrors(form);
    if (item) setForm(cfg.formId, item);
    if (type === "teacher") toggleSubstitution(form);
    const editing = Boolean(item);
    card.querySelector(".registry-editor-head h2").textContent = editing
      ? `Editando: ${item.nome || labels[type].one}`
      : `Novo ${labels[type].one}`;
    card.querySelector(".registry-editor-head p").textContent = editing
      ? "Altere os campos necessários e salve as alterações."
      : "Preencha os dados do novo cadastro.";
    form.querySelector("[type=submit]").textContent = editing
      ? "Salvar alterações"
      : `Cadastrar ${labels[type].one}`;
    form.querySelector(".actions [type=button]").textContent = editing
      ? "Cancelar edição"
      : "Cancelar";
    card.classList.add("open");
    document
      .querySelector(`.registry-backdrop[data-registry="${type}"]`)
      ?.classList.add("open");
    registryState[type].open = true;
    registryState[type].snapshot = formSnapshot(form);
    registryState[type].dirty = false;
    setTimeout(() => form.elements.nome?.focus(), 220);
  }
  async function closeEditor(type, force = false) {
    const cfg = registryConfig(type),
      form = document.getElementById(cfg.formId);
    if (!force && registryState[type].dirty) {
      const discard = await confirmAction({
        title: "Descartar alterações?",
        message: "Existem alterações que ainda não foram salvas.",
        detail:
          "Ao sair agora, as informações digitadas neste formulário serão perdidas.",
        confirmLabel: "Descartar alterações",
        danger: true,
      });
      if (!discard) return false;
    }
    form.closest(".registry-editor-card").classList.remove("open");
    document
      .querySelector(`.registry-backdrop[data-registry="${type}"]`)
      ?.classList.remove("open");
    registryState[type].open = false;
    registryState[type].dirty = false;
    clearFieldErrors(form);
    resetForm(cfg.formId);
    return true;
  }
  function validateRegistry(type, form, obj) {
    clearFieldErrors(form);
    let valid = true;
    if (!String(obj.nome || "").trim()) {
      addFieldError(form, "nome", "Informe o nome completo.");
      valid = false;
    }
    if (type === "employee" && !String(obj.cargo || "").trim()) {
      addFieldError(form, "cargo", "Informe o cargo ou a função.");
      valid = false;
    }
    const matricula = String(obj.matricula || "")
      .trim()
      .toLocaleLowerCase("pt-BR");
    if (matricula) {
      const duplicate = [
        ...data.employees.map((p) => ({ ...p, _type: "employee" })),
        ...data.teachers.map((p) => ({ ...p, _type: "teacher" })),
      ].find(
        (p) =>
          p.id !== obj.id &&
          String(p.matricula || "")
            .trim()
            .toLocaleLowerCase("pt-BR") === matricula,
      );
      if (duplicate) {
        addFieldError(
          form,
          "matricula",
          `Esta matrícula já pertence a ${duplicate.nome || "outro cadastro"}.`,
        );
        valid = false;
      }
    }
    if (!valid)
      form
        .querySelector(
          ".field-invalid input,.field-invalid select,.field-invalid textarea",
        )
        ?.focus();
    return valid;
  }
  async function handleRegistrySubmit(event, type, button) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (button.disabled) return;
    const cfg = registryConfig(type),
      form = event.currentTarget,
      obj = formObj(form);
    if (type === "teacher" && !obj.setor) obj.setor = "DOCENTES";
    if (!validateRegistry(type, form, obj)) return;
    button.disabled = true;
    const original = button.textContent;
    button.textContent = "Salvando…";
    try {
      const list = data[cfg.array];
      if (obj.id) {
        const target = list.find((item) => item.id === obj.id);
        if (!target)
          throw new Error(
            "O cadastro que estava sendo editado não foi encontrado.",
          );
        Object.assign(target, obj);
      } else list.push({ ...obj, id: uid() });
      data = normalizeData(data);
      persistDataOnly(data);
      renderAll();
      if (window.gfpOnline?.saveNow) await window.gfpOnline.saveNow(data);
      registryState[type].snapshot = formSnapshot(form);
      registryState[type].dirty = false;
      await closeEditor(type, true);
      notify(
        `${labels[type].one[0].toLocaleUpperCase("pt-BR") + labels[type].one.slice(1)} ${obj.id ? "atualizado" : "cadastrado"} com sucesso.`,
        "success",
      );
    } catch (error) {
      notify(readableError(error), "error", {
        sticky: true,
        actionLabel: "Tentar novamente",
        onAction: () => form.requestSubmit(),
      });
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  async function archivePerson(type, id) {
    const cfg = registryConfig(type),
      person = data[cfg.array].find((item) => item.id === id);
    if (!person) return;
    const wasActive =
      String(person.status || "Ativo").toLocaleLowerCase("pt-BR") !== "inativo";
    person.status = wasActive ? "Inativo" : "Ativo";
    saveData();
    try {
      if (window.gfpOnline?.saveNow) await window.gfpOnline.saveNow(data);
      notify(
        `${person.nome} foi ${wasActive ? "arquivado" : "reativado"}.`,
        "success",
        { actionLabel: "Desfazer", onAction: () => archivePerson(type, id) },
      );
    } catch (error) {
      notify(readableError(error), "error", {
        sticky: true,
        actionLabel: "Tentar novamente",
        onAction: () => window.gfpOnline?.saveNow(data),
      });
    }
  }
  async function permanentlyDeletePerson(type, id) {
    const cfg = registryConfig(type),
      person = data[cfg.array].find((item) => item.id === id);
    if (!person) return;
    const absences = data.absences.filter(
        (a) => a.personType === type && a.personId === id,
      ).length,
      occurrences = (data.occurrences || []).filter(
        (o) =>
          (o.personType === type && o.personId === id) ||
          (Array.isArray(o.people) &&
            o.people.some((p) => p.personType === type && p.personId === id)),
      ).length;
    const confirmed = await confirmAction({
      title: `Excluir ${labels[type].one} permanentemente?`,
      message: `${person.nome} será removido de forma definitiva.`,
      detail: `Também serão removidos ${absences} afastamento(s) e ${occurrences} ocorrência(s) relacionados. Esta ação não pode ser desfeita.`,
      confirmLabel: "Excluir permanentemente",
      danger: true,
    });
    if (!confirmed) return;
    data[cfg.array] = data[cfg.array].filter((item) => item.id !== id);
    data.absences = data.absences.filter(
      (a) => !(a.personType === type && a.personId === id),
    );
    data.occurrences = (data.occurrences || []).filter(
      (o) =>
        !(
          (o.personType === type && o.personId === id) ||
          (Array.isArray(o.people) &&
            o.people.some((p) => p.personType === type && p.personId === id))
        ),
    );
    saveData();
    try {
      if (window.gfpOnline?.saveNow) await window.gfpOnline.saveNow(data);
      notify(
        "Cadastro e dados relacionados excluídos permanentemente.",
        "success",
      );
    } catch (error) {
      notify(readableError(error), "error", {
        sticky: true,
        actionLabel: "Tentar novamente",
        onAction: () => window.gfpOnline?.saveNow(data),
      });
    }
  }

  const baseSortedRegistryItems = window.sortedRegistryItems;
  window.sortedRegistryItems = function (type) {
    let items = baseSortedRegistryItems(type),
      search = registryState[type]?.search.trim().toLocaleLowerCase("pt-BR");
    if (!search) return items;
    return items.filter((item) =>
      [
        item.nome,
        item.matricula,
        item.cargo,
        item.disciplina,
        item.situacao,
        item.setor,
      ].some((value) =>
        String(value || "")
          .toLocaleLowerCase("pt-BR")
          .includes(search),
      ),
    );
  };
  const baseRenderRegistryList = window.renderRegistryList;
  window.renderRegistryList = function (type, keepPickerOpen = false) {
    baseRenderRegistryList(type, keepPickerOpen);
    const table = document.getElementById(
      type === "employee" ? "employeeTable" : "teacherTable",
    );
    table?.querySelectorAll("tbody tr").forEach((row) => {
      const edit = row.querySelector(".mini-btn.edit"),
        remove = row.querySelector(".mini-btn.del");
      if (!edit || !remove) return;
      const match = edit
          .getAttribute("onclick")
          ?.match(/editItem\('[^']+','([^']+)'\)/),
        id = match?.[1];
      if (!id) return;
      const person = registryArray(type).find((item) => item.id === id),
        active =
          String(person?.status || "Ativo").toLocaleLowerCase("pt-BR") !==
          "inativo";
      row.classList.toggle("registry-row-inactive", !active);
      remove.removeAttribute("onclick");
      remove.className = `mini-btn ${active ? "archive" : "restore"}`;
      remove.textContent = active ? "Arquivar" : "Reativar";
      remove.addEventListener("click", () => archivePerson(type, id));
      if (window.gfpOnline?.canPermanentlyDelete?.()) {
        const permanent = document.createElement("button");
        permanent.type = "button";
        permanent.className = "mini-btn permanent";
        permanent.textContent = "Excluir definitivamente";
        permanent.addEventListener("click", () =>
          permanentlyDeletePerson(type, id),
        );
        remove.after(document.createTextNode(" "), permanent);
      }
    });
  };
  const baseEditItem = window.editItem;
  window.editItem = function (type, id) {
    if (type === "employee" || type === "teacher") {
      const cfg = registryConfig(type),
        person = data[cfg.array].find((item) => item.id === id);
      if (person) openEditor(type, person);
      return;
    }
    return baseEditItem(type, id);
  };

  document.addEventListener(
    "click",
    (event) => {
      const nav = event.target.closest("nav button[data-view]");
      if (!nav) return;
      const openType = ["employee", "teacher"].find(
        (type) => registryState[type].open && registryState[type].dirty,
      );
      if (!openType) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      confirmAction({
        title: "Sair sem salvar?",
        message: "O formulário aberto possui alterações não salvas.",
        confirmLabel: "Sair e descartar",
        danger: true,
      }).then((ok) => {
        if (ok) {
          closeEditor(openType, true);
          window.GFP_APP?.showView(nav.dataset.view);
        }
      });
    },
    true,
  );
  window.addEventListener("beforeunload", (event) => {
    if (Object.values(registryState).some((item) => item.open && item.dirty)) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  setupRegistry("employee");
  setupRegistry("teacher");
  renderRegistryList("employee");
  renderRegistryList("teacher");
  Object.assign(window.GFP_APP, {
    notify,
    readableError,
    confirmAction,
    promptEmail,
    promptPassword,
    promptTypedConfirmation,
    openRegistryEditor: openEditor,
  });
  window.alert = (message) => notify(message, "info");
})();
