import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const project = path.resolve(import.meta.dirname, "..");
const happyDomEntry =
  process.argv[2] || path.join(project, "node_modules/happy-dom/lib/index.js");
const { Window } = await import(pathToFileURL(path.resolve(happyDomEntry)));
const html = await fs.readFile(path.join(project, "index.html"), "utf8");
const enhancements = await fs.readFile(
  path.join(project, "enhancements.js"),
  "utf8",
);
const documentsJs = await fs.readFile(
  path.join(project, "documents.js"),
  "utf8",
);
const exportsJs = await fs.readFile(path.join(project, "exports.js"), "utf8");
const inconsistenciesJs = await fs.readFile(
  path.join(project, "inconsistencies.js"),
  "utf8",
);
const auditJs = await fs.readFile(path.join(project, "audit.js"), "utf8");
const timebankJs = await fs.readFile(path.join(project, "timebank.js"), "utf8");
const frequencyJs = await fs.readFile(path.join(project, "frequency.js"), "utf8");
const enhancementCss = await fs.readFile(
  path.join(project, "enhancements.css"),
  "utf8",
);
const onlineJs = await fs.readFile(path.join(project, "online.js"), "utf8");
const auditCalls = [];
const window = new Window({ url: "https://local.test/" });
window.document.write(html.replace(/<script[\s\S]*?<\/script>/gi, ""));
window.structuredClone = globalThis.structuredClone;
window.Option = function (text = "", value = "") {
  const option = window.document.createElement("option");
  option.textContent = text;
  option.value = value;
  return option;
};
window.gfpOnline = {
  isReadOnly: () => false,
  isReady: () => true,
  storageLabel: () => "",
  queueSave: () => {},
  saveNow: async () => {},
  saveTasks: async (tasks) => {
    window.GFP_APP.getData().tasks = tasks;
  },
  canOpenView: () => true,
  canEditTasks: () => true,
  canDeleteTasks: () => true,
  canPermanentlyDelete: () => true,
  canViewAudit: () => true,
  auditChange: async (...args) => auditCalls.push(args),
  listAuditLogs: async () => [{ id: "log-1", action: "update", entity: "employee", details: { actor_name: "Administradora" }, created_at: "2026-08-13T12:00:00Z" }],
  dashboardContext: () => ({}),
};

const inline = [
  ...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi),
].map((match) => match[1]);
window.eval(
  `${inline.join("\n")}\n${frequencyJs}\n${timebankJs}\n${enhancements}\n${documentsJs}\n${exportsJs}\n${inconsistenciesJs}\n${auditJs}`,
);

assert.doesNotMatch(html, /Banco de horas da unidade[\s\S]*function parseTimeBankHours/, "o banco de horas não deve permanecer embutido no HTML");
assert.match(html, /timebank\.js\?v=20260821-1/, "deve carregar o módulo de banco de horas");
assert.doesNotMatch(html, /Versão 1\.18[\s\S]*function canonicalOccurrence/, "ocorrências e frequência não devem permanecer embutidas no HTML");
assert.match(html, /frequency\.js\?v=20260820-2/, "deve carregar o módulo de frequência");
assert.match(html, /online\.js\?v=20260820-3/, "deve carregar a sincronização colaborativa atualizada");
assert.equal(window.document.getElementById("frequencyStart").value, "", "a data inicial da frequência deve começar em branco");
assert.equal(window.document.getElementById("frequencyEnd").value, "", "a data final da frequência deve começar em branco");
assert.equal(window.document.getElementById("frequencyIssueDate").value, "", "a data de emissão da frequência deve começar em branco");
assert.equal((html.match(/renderDashboard\s*=\s*function/g) || []).length, 1, "deve manter somente a versão ativa do painel inicial");
assert.doesNotMatch(html, /function renderDashboard\s*\(/, "não deve manter uma implementação antiga do painel");
assert.ok(window.document.getElementById("desktopNavToggle"), "deve oferecer controle para recolher o menu lateral");
window.document.getElementById("desktopNavToggle").click();
assert.ok(window.document.body.classList.contains("nav-collapsed"), "deve recolher o menu lateral");
window.document.getElementById("desktopNavToggle").click();
assert.ok(!window.document.body.classList.contains("nav-collapsed"), "deve reexibir o menu lateral");
assert.ok(window.document.getElementById("deleteEventBtn"), "deve oferecer exclusão de datas do calendário");
assert.match(timebankJs, /closeTimeBankExtract\(\);const ok=await/, "deve fechar o extrato antes de abrir a confirmação");
assert.match(html, /activeTeachers=data\.teachers\.filter\(t=>isActive\(t\)&&!isSubstitute\(t\)\)/, "o card deve desconsiderar professores substitutos");
assert.match(timebankJs, /Memorandos e Ofícios/, "deve exibir as novidades atuais do sistema");
assert.equal(window.document.querySelector('#documentForm [name="requester"]').closest("label").firstChild.nodeValue, "Remetente", "o cadastro de documentos deve usar Remetente");
for (const id of ["memorandumList", "officialLetterList"]) {
  const list = window.document.getElementById(id);
  assert.equal(list.style.overflowY, "auto", `${id} deve ter rolagem interna`);
  assert.equal(list.style.maxHeight, "560px", `${id} deve limitar a altura do card`);
}

assert.ok(window.document.getElementById("view-historico"), "deve criar a tela de histórico");
assert.match(onlineJs, /async function auditChange/, "deve expor o registro seguro de auditoria");
assert.match(onlineJs, /async function listAuditLogs/, "deve permitir consultar o histórico da unidade");
assert.match(onlineJs, /function officialEventTemplate/, "novas escolas devem receber o calendário oficial como modelo");
assert.match(onlineJs, /newSchoolDataWithOfficialCalendar\(created\)/, "o cadastro de nova escola deve usar o calendário oficial");
assert.doesNotMatch(onlineJs, /safeDetails\.(cpf|rg|telefone|notes|observacao)/i, "a auditoria não deve copiar dados pessoais");
window.DIB_AUDIT.record("update", "employee", "employee-1", { status: "Ativo" });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(auditCalls[0], ["update", "employee", "employee-1", { status: "Ativo" }]);

for (const key of ["employees", "teachers", "occurrences", "timebank"])
  assert.ok(
    window.document.querySelector(`[data-export-for="${key}"]`),
    `${key} deve oferecer exportação CSV e Excel`,
  );
const safeCsv = window.DIB_EXPORTS.buildCsv({
  headers: ["Nome", "Conteúdo"],
  rows: [["Teste", "=2+2"]],
});
assert.equal(safeCsv.charCodeAt(0), 0xfeff, "o CSV deve começar com BOM UTF-8");
assert.match(safeCsv, /"'=2\+2"/, "o CSV deve neutralizar fórmulas em células de texto");
const xlsxBytes = window.DIB_EXPORTS.buildXlsx({
  definition: { label: "Teste" },
  headers: ["Nome"],
  rows: [["Álvaro"]],
});
assert.deepEqual(
  [...xlsxBytes.slice(0, 4)],
  [0x50, 0x4b, 0x03, 0x04],
  "o arquivo Excel deve ser um pacote XLSX/ZIP válido",
);
assert.match(new TextDecoder().decode(xlsxBytes), /xl\/worksheets\/sheet1\.xml/);

const documentsView = window.document.getElementById("view-documentos");
const documentForm = window.document.getElementById("documentForm");
assert.ok(documentsView, "a tela de memorandos e ofícios deve ser criada");
assert.ok(
  window.document.querySelector('nav button[data-view="documentos"]'),
  "a tela documental deve aparecer na navegação",
);
documentForm.elements.date.value = "2026-08-13";
documentForm.elements.date.dispatchEvent(new window.Event("change", { bubbles: true }));
assert.equal(documentForm.elements.number.value, "001/2026");
documentForm.elements.requester.value = "Direção";
documentForm.elements.recipient.value = "Secretaria";
documentForm.elements.subject.value = "Solicitação de material";
documentForm.elements.status.value = "Enviado";
documentForm.dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
assert.equal(window.GFP_APP.getData().documents.length, 1);
assert.equal(window.GFP_APP.getData().documents[0].number, "001/2026");
assert.equal(documentForm.elements.number.value, "002/2026");
documentForm.elements.type.value = "official_letter";
documentForm.elements.type.dispatchEvent(new window.Event("change", { bubbles: true }));
assert.equal(
  documentForm.elements.number.value,
  "001/2026",
  "memorandos e ofícios devem ter sequências independentes",
);
documentForm.elements.requester.value = "Direção";
documentForm.elements.recipient.value = "SME";
documentForm.elements.subject.value = "Resposta institucional";
documentForm.dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
assert.equal(window.GFP_APP.getData().documents.length, 2);
assert.match(window.document.getElementById("memorandumList").textContent, /Solicitação de material/);
assert.match(window.document.getElementById("officialLetterList").textContent, /Resposta institucional/);
window.document.querySelector("#memorandumList [data-document-edit]").click();
assert.ok(documentForm.elements.id.value, "editar deve carregar o identificador do documento");
documentForm.elements.subject.value = "Solicitação de material revisada";
documentForm.dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
assert.equal(window.GFP_APP.getData().documents.length, 2);
assert.match(window.document.getElementById("memorandumList").textContent, /material revisada/);
const documentSearch = window.document.getElementById("documentSearch");
documentSearch.value = "material";
documentSearch.dispatchEvent(new window.Event("input", { bubbles: true }));
assert.match(window.document.getElementById("memorandumList").textContent, /Solicitação de material/);
assert.doesNotMatch(window.document.getElementById("officialLetterList").textContent, /Resposta institucional/);
documentSearch.value = "";
documentSearch.dispatchEvent(new window.Event("input", { bubbles: true }));
documentForm.elements.type.value = "memorandum";
documentForm.elements.type.dispatchEvent(new window.Event("change", { bubbles: true }));
documentForm.elements.number.value = "001/2026";
documentForm.elements.requester.value = "Teste";
documentForm.elements.recipient.value = "Teste";
documentForm.elements.subject.value = "Número duplicado";
documentForm.dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
assert.match(
  window.document.getElementById("documentFormError").textContent,
  /já está cadastrado/i,
  "a sequência não deve aceitar números duplicados do mesmo tipo",
);
window.DIB_DOCUMENTS.reset();
documentForm.elements.number.value = "";
window.GFP_APP.setData(window.GFP_APP.getData());
assert.equal(
  documentForm.elements.number.value,
  "002/2026",
  "o próximo memorando deve ser sugerido assim que os dados da unidade terminarem de carregar",
);
window.GFP_APP.getData().documents.push({
  id: "memorandum-order-test",
  type: "memorandum",
  number: "010/2026",
  date: "2026-01-01",
  requester: "Direção",
  recipient: "Secretaria",
  subject: "Memorando de maior número",
  status: "Rascunho",
  notes: "",
});
window.DIB_DOCUMENTS.render();
assert.equal(
  window.document.querySelector("#memorandumList .document-number").textContent,
  "010/2026",
  "os memorandos devem ser listados pelo maior número, independentemente da data",
);

const employeeSection = window.document.getElementById("view-funcionarios");
assert.equal(
  employeeSection.firstElementChild.querySelector("#employeeTable") !== null,
  true,
  "a lista deve aparecer antes do formulário",
);
assert.equal(
  employeeSection.querySelectorAll(".registry-toolbar").length,
  1,
  "deve existir uma barra de pesquisa e inclusão",
);

employeeSection.querySelector(".registry-toolbar .btn").click();
const employeeForm = window.document.getElementById("employeeForm");
assert.equal(
  employeeForm.closest(".registry-editor-card").classList.contains("open"),
  true,
  "o cadastro deve abrir no painel lateral",
);
assert.equal(
  employeeForm.querySelectorAll(".registry-form-group").length,
  7,
  "o formulário deve estar dividido em sete blocos",
);
for (const [name, count] of [
  ["docTipo", 2],
  ["plantao", 2],
  ["estudante", 2],
  ["status", 2],
]) {
  assert.equal(
    employeeForm.querySelectorAll(`.registry-form-group input[name="${name}"]`)
      .length,
    count,
    `todas as opções de ${name} devem permanecer juntas dentro do bloco correto`,
  );
}
assert.equal(
  employeeForm.querySelectorAll(":scope > .grid > .field-block").length,
  0,
  "nenhum seletor segmentado pode ficar solto no topo do formulário",
);
employeeForm.querySelector('input[name="docTipo"][value="CPF"]').click();
employeeForm.querySelector('input[name="plantao"][value="Sim"]').click();
employeeForm.querySelector('input[name="estudante"][value="Sim"]').click();
employeeForm.querySelector('input[name="status"][value="Inativo"]').click();
assert.equal(window.formObj(employeeForm).docTipo, "CPF");
employeeForm.elements.rg.value = "52998224725";
employeeForm.elements.rg.dispatchEvent(new window.Event("input", { bubbles: true }));
assert.equal(employeeForm.elements.rg.value, "529.982.247-25");
employeeForm.elements.telefone.value = "12999998888";
employeeForm.elements.telefone.dispatchEvent(
  new window.Event("input", { bubbles: true }),
);
assert.equal(employeeForm.elements.telefone.value, "(12) 99999-8888");
employeeForm.elements.horario.value = "08001730";
employeeForm.elements.horario.dispatchEvent(
  new window.FocusEvent("blur", { bubbles: true }),
);
assert.equal(employeeForm.elements.horario.value, "08h00 às 17h30");
employeeForm.elements.rg.value = "11111111111";
employeeForm.elements.rg.dispatchEvent(new window.Event("input", { bubbles: true }));
employeeForm.dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.match(
  employeeForm.elements.rg.closest("label")?.querySelector(".field-error-text")
    ?.textContent || "",
  /CPF válido/i,
  "um CPF inválido deve ser indicado junto ao campo",
);
assert.equal(window.formObj(employeeForm).plantao, "Sim");
assert.equal(window.formObj(employeeForm).estudante, "Sim");
assert.equal(window.formObj(employeeForm).status, "Inativo");
employeeForm.querySelector('input[name="docTipo"][value="RG"]').click();
employeeForm.elements.rg.value = "";
employeeForm.querySelector('input[name="plantao"][value="Não"]').click();
employeeForm.querySelector('input[name="estudante"][value="Não"]').click();
employeeForm.querySelector('input[name="status"][value="Ativo"]').click();
employeeForm.elements.nome.value = "Teste Um";
employeeForm.elements.cargo.value = "Auxiliar";
employeeForm.elements.matricula.value = "MAT-001";
employeeForm.elements.nascimento.value = "2000-08-01";
employeeForm.dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(
  window.GFP_APP.getData().employees.some(
    (item) => item.matricula === "MAT-001",
  ),
  true,
  "o cadastro válido deve ser salvo",
);
assert.equal(
  employeeSection.querySelectorAll(".mini-btn.archive").length > 0,
  true,
  "arquivar deve ser a ação principal",
);
assert.equal(
  employeeSection.querySelectorAll(".mini-btn.permanent").length > 0,
  true,
  "administradores devem ver a exclusão definitiva",
);
const archiveButton = employeeSection.querySelector(".mini-btn.archive");
const permanentButton = employeeSection.querySelector(".mini-btn.permanent");
assert.match(archiveButton.dataset.tooltip, /permanece no histórico/i);
assert.match(permanentButton.dataset.tooltip, /não pode ser desfeita/i);
assert.match(archiveButton.getAttribute("aria-label"), /Arquivar Teste Um/i);
archiveButton.dispatchEvent(
  new window.FocusEvent("focusin", { bubbles: true }),
);
assert.match(
  window.document.querySelector(".action-tooltip").textContent,
  /permanece no histórico/i,
  "a explicação deve aparecer ao passar o mouse ou focar o botão",
);
archiveButton.dispatchEvent(
  new window.FocusEvent("focusout", { bubbles: true }),
);

const savedEmployee = window.GFP_APP.getData().employees.find(
  (item) => item.matricula === "MAT-001",
);
savedEmployee.jornada = "30";
const absenceForm = window.document.getElementById("absenceForm");
absenceForm.elements.personKey.value = `employee:${savedEmployee.id}`;
absenceForm.elements.tipo.value = "LICENÇA";
absenceForm.querySelector('input[name="indefinite"][value="Sim"]').click();
assert.equal(absenceForm.elements.start.required, false);
assert.equal(absenceForm.elements.end.required, false);
assert.equal(absenceForm.elements.start.disabled, true);
assert.equal(
  [...absenceForm.querySelectorAll(".absence-date-field")].every(
    (field) => field.hidden,
  ),
  true,
  "as datas devem ser dispensadas para afastamento por tempo indeterminado",
);
absenceForm.dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await new Promise((resolve) => setTimeout(resolve, 0));
const indefiniteAbsence = window.GFP_APP.getData().absences.find(
  (item) => item.personId === savedEmployee.id && item.indefinite,
);
assert.ok(indefiniteAbsence, "o afastamento sem data deve ser salvo");
assert.equal(indefiniteAbsence.start, "");
assert.equal(indefiniteAbsence.end, "");
assert.match(
  window.document.getElementById("absenceTable").textContent,
  /Tempo indeterminado/,
);
window.GFP_APP.getData().absences.push(
  {
    id: "absence-overlap-one",
    personType: "employee",
    personId: savedEmployee.id,
    tipo: "FÉRIAS",
    rotulo: "",
    indefinite: false,
    start: "2026-08-01",
    end: "2026-08-15",
  },
  {
    id: "absence-overlap-two",
    personType: "employee",
    personId: savedEmployee.id,
    tipo: "LICENÇA",
    rotulo: "",
    indefinite: false,
    start: "2026-08-10",
    end: "2026-08-20",
  },
);
window.GFP_APP.getData().occurrences.push({
  id: "occurrence-during-absence",
  personType: "employee",
  personId: savedEmployee.id,
  start: "2026-08-12",
  end: "2026-08-12",
  tipo: "Atestado Médico",
});
const consistencyIssues = window.DIB_INCONSISTENCIES.analyze();
assert.ok(
  consistencyIssues.some((item) => item.kind === "absence-overlap"),
  "afastamentos sobrepostos devem gerar aviso",
);
assert.ok(
  consistencyIssues.some((item) => item.kind === "occurrence-during-absence"),
  "ocorrências durante afastamentos devem gerar aviso",
);
window.DIB_INCONSISTENCIES.render();
assert.match(
  window.document.querySelector(".inconsistency-card").textContent,
  /Possíveis inconsistências/,
);
window.document.querySelector("[data-inconsistency-view]").click();
assert.equal(
  window.document.getElementById("view-afastamentos").classList.contains("active") ||
    window.document.getElementById("view-ocorrencias").classList.contains("active"),
  true,
  "um aviso deve abrir a tela relacionada",
);
window.GFP_APP.getData().absences = window.GFP_APP.getData().absences.filter(
  (item) => !item.id.startsWith("absence-overlap-"),
);
window.GFP_APP.getData().occurrences = window.GFP_APP.getData().occurrences.filter(
  (item) => item.id !== "occurrence-during-absence",
);
const todayForDashboard = new Date();
const todayKey = `${todayForDashboard.getFullYear()}-${String(
  todayForDashboard.getMonth() + 1,
).padStart(2, "0")}-${String(todayForDashboard.getDate()).padStart(2, "0")}`;
window.GFP_APP.getData().occurrences.push({
  id: "occ-dashboard-today",
  personType: "employee",
  personId: savedEmployee.id,
  start: todayKey,
  end: todayKey,
  tipo: "Atestado Médico",
  duracao: "",
  comprovante: "",
  rotulo: "",
  complemento: "",
  observacao: "",
});
window.GFP_APP.renderAll();
const dashboard = window.document.getElementById("homeDashboard");
assert.match(
  dashboard.textContent,
  /Afastamentos hoje/,
  "o card da tela inicial deve usar o rótulo amplo de afastamentos",
);
assert.doesNotMatch(
  dashboard.textContent,
  /afastados hoje/,
  "o rótulo antigo não deve aparecer na tela inicial",
);
assert.equal(
  dashboard.querySelector(".home-summary-button .home-summary-value")
    .textContent,
  "2",
  "férias/licenças e ocorrências de hoje devem ser somadas no card",
);
assert.doesNotMatch(
  dashboard.textContent,
  /Avisos/,
  "o card de avisos foi removido da tela inicial",
);
assert.match(
  dashboard.querySelector(".home-summary-button").getAttribute("onclick") || "",
  /showTodayMovements\(\)/,
  "o card de afastamentos deve abrir a lista rápida do dia",
);
window.GFP_APP.getData().occurrences = window.GFP_APP.getData().occurrences.filter(
  (item) => item.id !== "occ-dashboard-today",
);

employeeSection.querySelector(".registry-toolbar .btn").click();
employeeForm.elements.nome.value = "Teste Dois";
employeeForm.elements.cargo.value = "Auxiliar";
employeeForm.elements.matricula.value = "MAT-001";
employeeForm.elements.matricula.dispatchEvent(
  new window.Event("input", { bubbles: true }),
);
employeeForm.dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.match(
  employeeForm.querySelector(".field-error-text")?.textContent || "",
  /matrícula já pertence/i,
  "a matrícula duplicada deve ser indicada ao lado do campo",
);
employeeForm
  .closest(".registry-editor-card")
  .querySelector(".registry-editor-close")
  .click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(
  window.document.querySelectorAll(".dialog-backdrop").length,
  1,
  "a confirmação deve abrir acima do painel quando houver alterações não salvas",
);
assert.match(enhancementCss, /\.dialog-backdrop\s*\{[^}]*z-index:\s*12000/s);
assert.match(enhancementCss, /\.registry-backdrop\s*\{[^}]*z-index:\s*9050/s);
window.document.querySelector(".dialog-cancel").click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(window.document.querySelectorAll(".dialog-backdrop").length, 0);
assert.equal(
  employeeForm.closest(".registry-editor-card").classList.contains("open"),
  true,
  "cancelar a confirmação deve manter o cadastro aberto",
);
employeeForm
  .closest(".registry-editor-card")
  .querySelector(".registry-editor-close")
  .click();
await new Promise((resolve) => setTimeout(resolve, 0));
window.document.querySelector(".dialog-confirm").click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(
  employeeForm.closest(".registry-editor-card").classList.contains("open"),
  false,
  "confirmar o descarte deve fechar o cadastro sem bloquear a tela",
);

const teacherForm = window.document.getElementById("teacherForm");
assert.equal(
  [...teacherForm.querySelectorAll("[data-substitution-field]")].every(
    (node) => node.hidden,
  ),
  true,
  "campos de substituição devem começar ocultos",
);
teacherForm.elements.substituto.value = "Sim";
teacherForm.elements.substituto.dispatchEvent(
  new window.Event("change", { bubbles: true }),
);
assert.equal(
  [...teacherForm.querySelectorAll("[data-substitution-field]")].every(
    (node) => !node.hidden,
  ),
  true,
  "campos de substituição devem aparecer para professor substituto",
);

window.GFP_APP.notify({ message: "Erro legível" }, "error");
assert.equal(
  window.document
    .querySelector(".app-toast")
    ?.textContent.includes("[object Object]"),
  false,
  "erros em objeto devem ser convertidos em texto legível",
);

assert.doesNotMatch(
  html,
  /\.view\{display:block!important\}/,
  "a impressão não pode tornar todas as telas visíveis",
);
assert.match(
  html,
  /body\.print-points #view-gerar[\s\S]*body\.print-frequency #view-frequencia/,
  "cada modo de impressão deve exibir somente a sua própria tela",
);

window.showView("gerar");
window.document.getElementById("genType").value = "employee";
window.document.getElementById("genMonth").value = "8";
window.document.getElementById("genYear").value = "2026";
window.renderSelection();
window.generatePreview();
assert.equal(window.document.body.classList.contains("print-points"), true);
assert.equal(
  window.document.querySelectorAll("#printArea .sheet").length > 0,
  true,
);
const employeePointSheet = [
  ...window.document.querySelectorAll("#printArea .employee-sheet"),
].find((sheet) => sheet.textContent.includes("Teste Um"));
assert.ok(employeePointSheet);
assert.doesNotMatch(
  employeePointSheet.textContent,
  /LICENÇA/,
  "o período indeterminado não deve preencher todos os dias da folha de ponto",
);

window.generateSectorReport();
assert.equal(window.document.body.classList.contains("print-sector"), true);
assert.equal(
  window.document.querySelectorAll("#reportPrintArea .sector-report").length >
    0,
  true,
);

window.document.getElementById("birthdayMonth").value = "8";
window.generateBirthdayReport();
assert.equal(window.document.body.classList.contains("print-birthday"), true);
assert.equal(
  window.document.querySelectorAll("#reportPrintArea .birthday-report").length >
    0,
  true,
);

window.printCompleteRegistry("employee");
assert.equal(window.document.body.classList.contains("print-registry"), true);
assert.equal(
  window.document.querySelectorAll("#reportPrintArea .registry-report").length >
    0,
  true,
);

window.document.getElementById("frequencyStart").value = "2026-08-01";
window.document.getElementById("frequencyEnd").value = "2026-08-31";
window.document.getElementById("frequencyIssueDate").value = "2026-08-31";
window.generateFrequencyReport();
assert.equal(window.document.body.classList.contains("print-frequency"), true);
assert.equal(
  window.document.querySelectorAll("#frequencyPrintArea .frequency-sheet")
    .length > 0,
  true,
);
const indefiniteFrequencyRow = [
  ...window.document.querySelectorAll(
    "#frequencyPrintArea .employee-frequency tbody tr",
  ),
].find((row) => row.textContent.includes("Teste Um"));
assert.ok(indefiniteFrequencyRow);
assert.equal(
  indefiniteFrequencyRow.querySelector(".freq-cell").textContent.trim(),
  "Licença",
  "o relatório de frequência deve exibir somente Licença, sem datas",
);
const frequencyPerson = window.document.getElementById("frequencyPerson");
window.document.getElementById("frequencySource").value = "all";
window.renderFrequencyPeople();
frequencyPerson.value = `employee:${savedEmployee.id}`;
window.generateFrequencyReport();
assert.equal(
  window.document.querySelectorAll("#frequencyPrintArea .employee-frequency tbody tr")
    .length,
  1,
  "o relatório deve permitir emitir a frequência de uma única pessoa",
);
assert.equal(
  window.document.querySelectorAll("#frequencyPrintArea .teacher-frequency").length,
  0,
  "ao escolher uma pessoa, o relatório não deve trazer outro grupo",
);

window.GFP_APP.getData().timeBank.push({
  id: "timebank-search-entry",
  personType: "employee",
  personId: savedEmployee.id,
  date: "2026-08-15",
  hours: 1.5,
  note: "Teste de busca",
});
window.GFP_APP.getData().timeBank.push({
  id: "timebank-day-equivalent",
  personType: "employee",
  personId: savedEmployee.id,
  date: "2026-08-16",
  hours: 6,
  note: "Teste de equivalência",
});
window.GFP_APP.renderAll();
const timeBankSearch = window.document.getElementById("timeBankSearch");
timeBankSearch.value = "teste um";
timeBankSearch.dispatchEvent(new window.Event("input", { bubbles: true }));
assert.match(
  window.document.getElementById("timeBankTable").textContent,
  /Teste Um/,
  "a busca do banco de horas deve filtrar a lista imediatamente",
);
timeBankSearch.value = "inexistente";
timeBankSearch.dispatchEvent(new window.Event("input", { bubbles: true }));
assert.match(
  window.document.getElementById("timeBankTable").textContent,
  /Nenhum lançamento encontrado/,
  "a busca do banco de horas deve ocultar nomes fora do filtro",
);
timeBankSearch.value = "";
timeBankSearch.dispatchEvent(new window.Event("input", { bubbles: true }));
window.openTimeBankExtract("employee", savedEmployee.id);
assert.match(
  window.document.getElementById("timeBankExtractSummary").textContent,
  /1 dia equivale a 6h \(jornada de 30h semanais\)/,
  "a equivalência deve usar a jornada semanal individual",
);
assert.match(
  window.document.getElementById("timeBankExtractContent").textContent,
  /1 dia e 1h30/,
  "6h devem corresponder a um dia para jornada semanal de 30h",
);
window.closeTimeBankExtract();

const systemBackupCard = window.document.getElementById("masterSystemBackup");
assert.ok(systemBackupCard, "deve existir uma área de backup geral");
assert.equal(
  systemBackupCard.hidden,
  true,
  "o backup geral deve começar oculto até a validação do usuário mestre",
);
assert.ok(
  systemBackupCard.querySelector("#exportSystemBackupBtn"),
  "o usuário mestre deve poder exportar o backup geral",
);
assert.ok(
  systemBackupCard.querySelector("#systemBackupFile"),
  "o usuário mestre deve poder selecionar um backup geral para restaurar",
);
assert.match(systemBackupCard.textContent, /senhas nunca entram no arquivo/i);
assert.match(systemBackupCard.textContent, /RESTAURAR SISTEMA/);

assert.match(html, /Secretário \/ Oficial/);
assert.match(html, /Diretor \/ Coordenador administrador/);
assert.match(html, /Coordenador Técnico visualização/);
assert.doesNotMatch(
  html,
  /body\.role-consulta nav button/,
  "usuários de visualização devem conseguir navegar por todas as telas",
);

window.GFP_APP.getData().tasks = [
  {
    id: "task-viewer",
    title: "Conferir pendências",
    priority: "baixa",
    due: "",
    done: false,
    createdAt: new Date().toISOString(),
    createdBy: "Teste",
    completedAt: "",
    completedBy: "",
  },
];
window.gfpOnline.isReadOnly = () => true;
window.gfpOnline.canEditTasks = () => true;
window.gfpOnline.canDeleteTasks = () => false;
window.GFP_APP.renderAll();
const viewerDashboard = window.document.getElementById("homeDashboard");
assert.ok(
  viewerDashboard.querySelector(".home-task-form"),
  "perfis de visualização devem poder incluir tarefas",
);
assert.equal(
  viewerDashboard.querySelector(".task-delete"),
  null,
  "perfis de visualização não devem excluir tarefas",
);
assert.equal(
  viewerDashboard.querySelector('.home-task input[type="checkbox"]').disabled,
  false,
  "perfis de visualização devem poder concluir tarefas",
);
window.gfpOnline.isReadOnly = () => false;
window.gfpOnline.canDeleteTasks = () => true;

const adminFunction = await fs.readFile(
  path.join(project, "supabase/functions/admin-users/index.ts"),
  "utf8",
);
assert.match(adminFunction, /body\.action === 'export_system_backup'/);
assert.match(adminFunction, /body\.action === 'restore_system_backup'/);
assert.match(adminFunction, /profile\.system_role !== 'master'/);
assert.match(adminFunction, /includes_passwords:\s*false/);
assert.match(adminFunction, /director_admin/);
assert.match(adminFunction, /tech_view/);
assert.match(adminFunction, /normalizeRole\(body\.role\)/);

const roleMigration = await fs.readFile(
  path.join(
    project,
    "supabase/migrations/20260811132500_add_task_viewer_roles.sql",
  ),
  "utf8",
);
assert.match(roleMigration, /create or replace function public\.update_school_tasks/);
assert.match(roleMigration, /grant execute on function public\.update_school_tasks/);
assert.match(roleMigration, /'director_view'/);
assert.match(roleMigration, /'tech_view'/);
assert.match(
  roleMigration,
  /create policy school_data_update[\s\S]*'director_admin'[\s\S]*'tech_admin'/,
);
assert.doesNotMatch(
  roleMigration,
  /create policy school_data_update[\s\S]*'director_view'/,
  "visualização não deve receber update direto no bloco completo da escola",
);
assert.match(
  onlineJs,
  /location\.origin\s*\+\s*location\.pathname/,
  "a recuperação de senha deve preservar o caminho do app no GitHub Pages",
);
assert.doesNotMatch(
  onlineJs,
  /redirect_to="\s*\+\s*encodeURIComponent\(location\.origin\)/,
  "a recuperação de senha não pode usar apenas o domínio do GitHub Pages",
);
const employeeSearch = employeeSection.querySelector(".registry-search input");
window.GFP_APP.getData().employees.push({
  id: "accent-search",
  nome: "Álvaro Busca",
  cargo: "Auxiliar",
  matricula: "BUSCA-1",
  status: "Ativo",
});
window.GFP_APP.renderAll();
employeeSearch.value = "alvaro";
employeeSearch.dispatchEvent(new window.Event("input", { bubbles: true }));
assert.match(
  window.document.getElementById("employeeTable").textContent,
  /Álvaro Busca/,
  "a busca deve ignorar acentos",
);
window.GFP_APP.getData().employees = window.GFP_APP.getData().employees.filter(
  (item) => item.id !== "accent-search",
);
employeeSearch.value = "";
employeeSearch.dispatchEvent(new window.Event("input", { bubbles: true }));
assert.doesNotMatch(
  html,
  /localStorage\.setItem\(STORAGE_KEY/,
  "a aplicação não deve manter uma segunda cópia global dos dados da escola",
);
assert.match(
  html,
  /localStorage\.removeItem\(LEGACY_STORAGE_KEY\)/,
  "a cópia global antiga deve ser removida depois da migração",
);
assert.match(
  onlineJs,
  /function clearSyncedLocalData\(\)[\s\S]*key\.startsWith\("gfp_school_cache_"\)[\s\S]*clearLegacyLocalData/,
  "o logout deve limpar caches sincronizados e a cópia global antiga",
);
const logoutCleanup = onlineJs.match(
  /function clearSyncedLocalData\(\)\s*\{([\s\S]*?)\n  \}/,
)?.[1] || "";
assert.doesNotMatch(
  logoutCleanup,
  /gfp_pending_save_/,
  "o logout não pode descartar alterações locais ainda pendentes",
);
assert.match(html, /online\.js\?v=20260820-3/);
assert.match(html, /sw\.js\?v=20260820-2/);
assert.match(
  await fs.readFile(path.join(project, "sw.js"), "utf8"),
  /online\.js\?v=20260820-3/,
  "a página e o service worker devem usar a mesma versão do módulo online",
);

console.log("UI smoke test passed");
