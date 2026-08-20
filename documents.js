(function () {
  "use strict";

  const typeConfig = {
    memorandum: { singular: "Memorando", listId: "memorandumList", countId: "memorandumCount" },
    official_letter: { singular: "Ofício", listId: "officialLetterList", countId: "officialLetterCount" },
  };

  function installView() {
    const reportsButton = document.querySelector('nav button[data-view="relatorios"]');
    if (reportsButton && !document.querySelector('nav button[data-view="documentos"]')) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.view = "documentos";
      button.textContent = "Memorandos | Ofícios";
      reportsButton.parentNode.insertBefore(button, reportsButton);
      button.addEventListener("click", () => window.GFP_APP.showView("documentos"));
    }
    if (document.getElementById("view-documentos")) return;
    const section = document.createElement("section");
    section.id = "view-documentos";
    section.className = "view";
    section.innerHTML = `<div class="card"><div class="documents-heading"><div><h2>Memorandos | Ofícios</h2><p>Controle a numeração e o histórico dos documentos administrativos da unidade.</p></div></div><form id="documentForm"><input type="hidden" name="id"><div class="grid cols-3"><label>Tipo<select name="type" required><option value="memorandum">Memorando</option><option value="official_letter">Ofício</option></select></label><label>Número<input name="number" required placeholder="001/2026" maxlength="10"></label><label>Data<input type="date" name="date" required></label><label>Solicitante<input name="requester" required maxlength="160"></label><label>Destinatário<input name="recipient" required maxlength="160"></label><label>Status<select name="status"><option>Rascunho</option><option>Enviado</option><option>Respondido</option><option>Arquivado</option></select></label></div><label class="documents-subject">Assunto<input name="subject" required maxlength="240"></label><label>Observações<textarea name="notes" maxlength="1000" placeholder="Informações complementares opcionais"></textarea></label><div id="documentFormError" class="documents-error" role="alert"></div><div class="actions"><button class="btn" type="submit">Salvar documento</button><button id="documentCancelEdit" class="btn light" type="button">Limpar</button></div></form></div><div class="card"><div class="documents-filters"><label>Busca<input id="documentSearch" type="search" placeholder="Número, destinatário ou assunto"></label><label>Ano<select id="documentYearFilter"><option value="all">Todos os anos</option></select></label></div></div><div class="documents-columns"><div class="card"><div class="documents-list-head"><div><h3>Memorandos</h3><span id="memorandumCount"></span></div></div><div id="memorandumList"></div></div><div class="card"><div class="documents-list-head"><div><h3>Ofícios</h3><span id="officialLetterCount"></span></div></div><div id="officialLetterList"></div></div></div>`;
    document.querySelector("main").appendChild(section);
    const requesterLabel = section.querySelector('[name="requester"]')?.closest("label");
    if (requesterLabel?.firstChild) requesterLabel.firstChild.nodeValue = "Remetente";
    for (const id of ["memorandumList", "officialLetterList"])
      Object.assign(section.querySelector(`#${id}`).style, {
        maxHeight: "560px",
        overflowY: "auto",
        overscrollBehavior: "contain",
        paddingRight: "6px",
        scrollbarGutter: "stable",
      });
  }

  installView();
  const form = document.getElementById("documentForm");
  const search = document.getElementById("documentSearch");
  const yearFilter = document.getElementById("documentYearFilter");
  let lastSuggestion = "";

  function ensureDocuments(value = data) {
    if (!Array.isArray(value.documents)) value.documents = [];
    return value.documents;
  }
  function clean(value) {
    return String(value || "").trim();
  }
  function fold(value) {
    return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  }
  function localDate() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }
  function numberParts(value) {
    const match = clean(value).match(/^(\d{1,5})\/(\d{4})$/);
    return match ? { sequence: Number(match[1]), year: Number(match[2]) } : null;
  }
  function formatNumber(sequence, year) {
    return `${String(sequence).padStart(3, "0")}/${year}`;
  }
  function nextNumber(type, year, ignoredId = "") {
    const max = ensureDocuments()
      .filter((item) => item.type === type && item.id !== ignoredId)
      .map((item) => numberParts(item.number))
      .filter((parts) => parts?.year === Number(year))
      .reduce((value, parts) => Math.max(value, parts.sequence), 0);
    return formatNumber(max + 1, year);
  }
  function suggestNumber(force = false) {
    const year = Number((form.elements.date.value || localDate()).slice(0, 4));
    const suggestion = nextNumber(form.elements.type.value, year, form.elements.id.value);
    if (force || !form.elements.number.value || form.elements.number.value === lastSuggestion)
      form.elements.number.value = suggestion;
    lastSuggestion = suggestion;
  }
  function resetForm() {
    form.reset();
    form.elements.id.value = "";
    form.elements.date.value = localDate();
    form.elements.status.value = "Rascunho";
    document.getElementById("documentFormError").textContent = "";
    form.querySelector('[type="submit"]').textContent = "Salvar documento";
    suggestNumber(true);
  }
  function refreshSuggestedNumber() {
    if (!form.elements.id.value) suggestNumber();
  }
  function normalizeNumber(value, date) {
    const year = Number(date.slice(0, 4));
    if (/^\d{1,5}$/.test(clean(value))) return formatNumber(Number(value), year);
    const parts = numberParts(value);
    return parts ? formatNumber(parts.sequence, parts.year) : "";
  }
  function validate(record) {
    if (!record.date || !record.requester || !record.recipient || !record.subject)
      return "Preencha data, solicitante, destinatário e assunto.";
    record.number = normalizeNumber(record.number, record.date);
    const parts = numberParts(record.number);
    if (!parts) return "Informe o número no formato 001/2026.";
    if (parts.year !== Number(record.date.slice(0, 4)))
      return "O ano do número deve ser o mesmo da data do documento.";
    if (ensureDocuments().some((item) => item.id !== record.id && item.type === record.type && clean(item.number) === record.number))
      return `${typeConfig[record.type].singular} ${record.number} já está cadastrado.`;
    return "";
  }
  function filtered(type) {
    const query = fold(search.value);
    const year = yearFilter.value;
    return ensureDocuments()
      .filter((item) => item.type === type)
      .filter((item) => year === "all" || item.date?.startsWith(year))
      .filter((item) => !query || [item.number, item.requester, item.recipient, item.subject, item.status].some((value) => fold(value).includes(query)))
      .sort((a, b) => {
        const aNumber = numberParts(a.number);
        const bNumber = numberParts(b.number);
        return (
          (bNumber?.year || 0) - (aNumber?.year || 0) ||
          (bNumber?.sequence || 0) - (aNumber?.sequence || 0) ||
          clean(b.date).localeCompare(clean(a.date))
        );
      });
  }
  function statusClass(status) {
    return `status-${fold(status).replace(/[^a-z0-9]+/g, "-")}`;
  }
  function itemHtml(item) {
    return `<article class="document-item"><div class="document-item-top"><div><div class="document-number">${esc(item.number)}</div><div class="document-date">${esc(formatDatePt(item.date))}</div></div><span class="document-status ${statusClass(item.status)}">${esc(item.status)}</span></div><div class="document-subject">${esc(item.subject)}</div><div class="document-route"><strong>Remetente:</strong> ${esc(item.requester)}<br><strong>Destinatário:</strong> ${esc(item.recipient)}</div>${item.notes ? `<div class="document-notes">${esc(item.notes)}</div>` : ""}<div class="document-actions"><button class="mini-btn edit" type="button" data-document-edit="${esc(item.id)}">Editar</button><button class="mini-btn del" type="button" data-document-delete="${esc(item.id)}">Excluir</button></div></article>`;
  }
  function populateYears() {
    const current = yearFilter.value || "all";
    const years = [...new Set(ensureDocuments().map((item) => clean(item.date).slice(0, 4)).filter(Boolean))].sort((a, b) => b.localeCompare(a));
    yearFilter.innerHTML = '<option value="all">Todos os anos</option>' + years.map((year) => `<option value="${esc(year)}">${esc(year)}</option>`).join("");
    yearFilter.value = years.includes(current) ? current : "all";
  }
  function render() {
    populateYears();
    for (const [type, cfg] of Object.entries(typeConfig)) {
      const items = filtered(type);
      document.getElementById(cfg.countId).textContent = `${items.length} registro${items.length === 1 ? "" : "s"}`;
      document.getElementById(cfg.listId).innerHTML = items.length ? `<div class="document-list">${items.map(itemHtml).join("")}</div>` : `<div class="empty">Nenhum ${cfg.singular.toLocaleLowerCase("pt-BR")} encontrado.</div>`;
    }
  }
  function editDocument(id) {
    const item = ensureDocuments().find((record) => record.id === id);
    if (!item) return;
    for (const [name, value] of Object.entries(item)) if (form.elements[name]) form.elements[name].value = value ?? "";
    lastSuggestion = item.number;
    form.querySelector('[type="submit"]').textContent = "Salvar alterações";
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function deleteDocument(id) {
    if (window.gfpOnline?.isReadOnly?.()) return;
    const item = ensureDocuments().find((record) => record.id === id);
    if (!item) return;
    const confirmed = await window.GFP_APP.confirmAction({ title: `Excluir ${typeConfig[item.type].singular.toLocaleLowerCase("pt-BR")} ${item.number}?`, message: "O registro será removido do controle documental.", confirmLabel: "Excluir", danger: true });
    if (!confirmed) return;
    data.documents = ensureDocuments().filter((record) => record.id !== id);
    saveData();
    window.DIB_AUDIT?.record("delete", "document", id);
    resetForm();
    render();
    window.GFP_APP.notify("Documento excluído.", "success");
  }

  const baseSetData = window.GFP_APP.setData;
  window.GFP_APP.setData = (value) => {
    ensureDocuments(value || {});
    baseSetData(value);
    refreshSuggestedNumber();
    render();
  };
  ensureDocuments();
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (window.gfpOnline?.isReadOnly?.()) return;
    const record = Object.fromEntries(new FormData(form).entries());
    for (const key of ["number", "requester", "recipient", "subject", "notes"]) record[key] = clean(record[key]);
    const error = validate(record);
    document.getElementById("documentFormError").textContent = error;
    if (error) return;
    const action = record.id ? "update" : "create";
    const entityId = record.id || uid();
    if (record.id) Object.assign(ensureDocuments().find((item) => item.id === record.id), record);
    else ensureDocuments().push({ ...record, id: entityId });
    saveData();
    window.DIB_AUDIT?.record(action, "document", entityId, { status: record.type });
    resetForm();
    render();
    window.GFP_APP.notify("Documento salvo com sucesso.", "success");
  });
  form.elements.type.addEventListener("change", refreshSuggestedNumber);
  form.elements.date.addEventListener("change", refreshSuggestedNumber);
  document.getElementById("documentCancelEdit").addEventListener("click", resetForm);
  search.addEventListener("input", render);
  yearFilter.addEventListener("change", render);
  document.getElementById("view-documentos").addEventListener("click", (event) => {
    const edit = event.target.closest("[data-document-edit]");
    const remove = event.target.closest("[data-document-delete]");
    if (edit) editDocument(edit.dataset.documentEdit);
    if (remove) deleteDocument(remove.dataset.documentDelete);
  });

  const baseShowViewDocuments = showView;
  showView = function (name) {
    baseShowViewDocuments(name);
    if (name === "documentos") refreshSuggestedNumber();
  };

  window.DIB_DOCUMENTS = { render, reset: resetForm, nextNumber, refreshSuggestedNumber };
  resetForm();
  render();
})();
