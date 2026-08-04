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
employeeForm.elements.nome.value = "Teste Um";
employeeForm.elements.cargo.value = "Auxiliar";
employeeForm.elements.matricula.value = "MAT-001";
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

employeeSection.querySelector(".registry-toolbar .btn").click();
employeeForm.elements.nome.value = "Teste Dois";
employeeForm.elements.cargo.value = "Auxiliar";
employeeForm.elements.matricula.value = "MAT-001";
employeeForm.dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.match(
  employeeForm.querySelector(".field-error-text")?.textContent || "",
  /matrícula já pertence/i,
  "a matrícula duplicada deve ser indicada ao lado do campo",
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

console.log("UI smoke test passed");
