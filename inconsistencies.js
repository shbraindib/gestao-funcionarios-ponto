(function () {
  "use strict";

  function person(type, id) {
    const list = type === "teacher" ? data.teachers : data.employees;
    return list.find((item) => item.id === id) || null;
  }
  function personName(type, id) {
    return person(type, id)?.nome || "Cadastro não encontrado";
  }
  function range(item) {
    return item.indefinite
      ? { start: "0000-01-01", end: "9999-12-31" }
      : { start: item.start || "", end: item.end || item.start || "" };
  }
  function overlaps(first, second) {
    const a = range(first), b = range(second);
    return Boolean(a.start && a.end && b.start && b.end && a.start <= b.end && b.start <= a.end);
  }
  function period(item) {
    if (item.indefinite) return "tempo indeterminado";
    if (!item.start) return "período sem data";
    return item.start === item.end || !item.end
      ? formatDatePt(item.start)
      : `${formatDatePt(item.start)} a ${formatDatePt(item.end)}`;
  }
  function issue(kind, severity, title, detail, view, personValue = "") {
    return { id: `${kind}-${Math.random().toString(36).slice(2)}`, kind, severity, title, detail, view, person: personValue };
  }
  function analyze() {
    const issues = [], absences = Array.isArray(data.absences) ? data.absences : [], occurrences = Array.isArray(data.occurrences) ? data.occurrences : [];
    for (const item of absences) {
      const name = personName(item.personType, item.personId);
      if (!person(item.personType, item.personId))
        issues.push(issue("missing-person", "high", "Afastamento sem cadastro vinculado", `${item.tipo || "Afastamento"} de ${period(item)}.`, "afastamentos", name));
      if (!item.indefinite && item.start && item.end && item.end < item.start)
        issues.push(issue("invalid-period", "high", `Período invertido para ${name}`, `${formatDatePt(item.start)} a ${formatDatePt(item.end)}.`, "afastamentos", name));
    }
    for (let first = 0; first < absences.length; first += 1)
      for (let second = first + 1; second < absences.length; second += 1) {
        const a = absences[first], b = absences[second];
        if (a.personType === b.personType && a.personId === b.personId && overlaps(a, b)) {
          const name = personName(a.personType, a.personId);
          issues.push(issue("absence-overlap", "high", `Afastamentos sobrepostos para ${name}`, `${a.tipo || "Afastamento"} (${period(a)}) coincide com ${b.tipo || "afastamento"} (${period(b)}).`, "afastamentos", name));
        }
      }
    for (const occurrence of occurrences) {
      const name = personName(occurrence.personType, occurrence.personId);
      if (!person(occurrence.personType, occurrence.personId))
        issues.push(issue("missing-person", "high", "Ocorrência sem cadastro vinculado", `${occurrence.tipo || "Ocorrência"} em ${period(occurrence)}.`, "ocorrencias", name));
      if (occurrence.start && occurrence.end && occurrence.end < occurrence.start)
        issues.push(issue("invalid-period", "high", `Ocorrência com período invertido para ${name}`, `${formatDatePt(occurrence.start)} a ${formatDatePt(occurrence.end)}.`, "ocorrencias", name));
      for (const absence of absences)
        if (absence.personType === occurrence.personType && absence.personId === occurrence.personId && overlaps(absence, occurrence))
          issues.push(issue("occurrence-during-absence", "medium", `Ocorrência durante afastamento de ${name}`, `${occurrence.tipo || "Ocorrência"} (${period(occurrence)}) coincide com ${absence.tipo || "afastamento"} (${period(absence)}).`, "ocorrencias", name));
    }
    for (const entry of Array.isArray(data.timeBank) ? data.timeBank : []) {
      const name = personName(entry.personType, entry.personId);
      if (!person(entry.personType, entry.personId))
        issues.push(issue("missing-person", "high", "Banco de horas sem cadastro vinculado", `Lançamento de ${entry.date ? formatDatePt(entry.date) : "data não informada"}.`, "banco-horas", name));
      if (!entry.date || !Number.isFinite(Number(entry.hours)) || Number(entry.hours) === 0)
        issues.push(issue("invalid-timebank", "medium", `Lançamento inválido no banco de horas de ${name}`, "Confira a data e a quantidade de horas.", "banco-horas", name));
    }
    const documentKeys = new Map();
    for (const documentItem of Array.isArray(data.documents) ? data.documents : []) {
      const key = `${documentItem.type}:${String(documentItem.number || "").trim()}`;
      if (documentKeys.has(key))
        issues.push(issue("duplicate-document", "high", `Número documental duplicado: ${documentItem.number}`, "Há mais de um registro do mesmo tipo com esta numeração.", "documentos"));
      else documentKeys.set(key, true);
    }
    return issues;
  }
  function itemHtml(item) {
    return `<button class="inconsistency-item severity-${item.severity}" type="button" data-inconsistency-view="${esc(item.view)}" data-inconsistency-person="${esc(item.person)}"><span class="inconsistency-dot"></span><span><span class="inconsistency-title">${esc(item.title)}</span><span class="inconsistency-detail">${esc(item.detail)}</span></span><span class="inconsistency-open">Ver cadastro</span></button>`;
  }
  function render() {
    const host = document.getElementById("homeDashboard");
    if (!host) return;
    host.querySelector(".inconsistency-card")?.remove();
    const issues = analyze(), card = document.createElement("div");
    card.className = `card inconsistency-card${issues.length ? "" : " is-clear"}`;
    if (!issues.length)
      card.innerHTML = '<div class="inconsistency-head"><div><h3>Consistência dos dados</h3><p>Nenhum conflito foi encontrado nos cadastros da unidade.</p></div><span class="inconsistency-count">✓</span></div>';
    else {
      const visible = issues.slice(0, 5), hidden = issues.slice(5);
      card.innerHTML = `<div class="inconsistency-head"><div><h3>Possíveis inconsistências</h3><p>São avisos para conferência; nenhum cadastro foi bloqueado.</p></div><span class="inconsistency-count">${issues.length}</span></div><div class="inconsistency-list">${visible.map(itemHtml).join("")}</div>${hidden.length ? `<details class="inconsistency-more"><summary>Ver mais ${hidden.length}</summary><div class="inconsistency-list">${hidden.map(itemHtml).join("")}</div></details>` : ""}`;
    }
    host.appendChild(card);
  }
  function openIssue(button) {
    const view = button.dataset.inconsistencyView;
    window.GFP_APP.showView(view);
    const name = button.dataset.inconsistencyPerson;
    const searchIds = view === "afastamentos" ? ["absenceSearch"] : view === "ocorrencias" ? ["occurrenceSearch"] : view === "banco-horas" ? ["timeBankSearch"] : [];
    for (const id of searchIds) {
      const input = document.getElementById(id);
      if (!input || !name || name === "Cadastro não encontrado") continue;
      input.value = name;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  const baseRefreshDashboard = window.GFP_APP.refreshDashboard;
  window.GFP_APP.refreshDashboard = () => { baseRefreshDashboard(); render(); };
  const baseSetData = window.GFP_APP.setData;
  window.GFP_APP.setData = (value) => { baseSetData(value); render(); };
  document.getElementById("homeDashboard")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-inconsistency-view]");
    if (button) openIssue(button);
  });
  window.DIB_INCONSISTENCIES = { analyze, render };
  render();
})();
