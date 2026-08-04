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
const enhancementCss = await fs.readFile(
  path.join(project, "enhancements.css"),
  "utf8",
);
const onlineJs = await fs.readFile(path.join(project, "online.js"), "utf8");
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
  canOpenView: () => true,
  canPermanentlyDelete: () => true,
  dashboardContext: () => ({}),
};

const inline = [
  ...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi),
].map((match) => match[1]);
window.eval(`${inline.join("\n")}\n${enhancements}`);

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
assert.equal(window.formObj(employeeForm).plantao, "Sim");
assert.equal(window.formObj(employeeForm).estudante, "Sim");
assert.equal(window.formObj(employeeForm).status, "Inativo");
employeeForm.querySelector('input[name="docTipo"][value="RG"]').click();
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

const adminFunction = await fs.readFile(
  path.join(project, "supabase/functions/admin-users/index.ts"),
  "utf8",
);
assert.match(adminFunction, /body\.action === 'export_system_backup'/);
assert.match(adminFunction, /body\.action === 'restore_system_backup'/);
assert.match(adminFunction, /profile\.system_role !== 'master'/);
assert.match(adminFunction, /includes_passwords:\s*false/);
assert.match(
  onlineJs,
  /location\.origin\s*\+\s*location\.pathname/,
  "a recuperaÃ§Ã£o de senha deve preservar o caminho do app no GitHub Pages",
);
assert.doesNotMatch(
  onlineJs,
  /redirect_to="\s*\+\s*encodeURIComponent\(location\.origin\)/,
  "a recuperaÃ§Ã£o de senha nÃ£o pode usar apenas o domÃ­nio do GitHub Pages",
);

console.log("UI smoke test passed");
