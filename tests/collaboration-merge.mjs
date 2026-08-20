import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const project = path.resolve(import.meta.dirname, "..");
const source = await fs.readFile(path.join(project, "online.js"), "utf8");
const match = source.match(
  /function copyData\(value\)[\s\S]*?(?=\n  async function latestSchoolData)/,
);
assert.ok(match, "o mecanismo de união colaborativa deve existir");
const helpers = new Function(`${match[0]}; return { mergeSchoolPayload };`)();

const base = {
  settings: { escola: "Unidade", telefone: "1111" },
  employees: [{ id: "employee-1", nome: "Ana", telefone: "1111" }],
  absences: [],
};
const local = structuredClone(base);
local.employees[0].telefone = "2222";
const remote = structuredClone(base);
remote.absences.push({ id: "absence-1", personId: "employee-1", tipo: "Licença" });

const independentChanges = helpers.mergeSchoolPayload(base, local, remote);
assert.equal(independentChanges.ok, true, "alterações em cadastros diferentes devem ser unidas");
assert.equal(independentChanges.payload.employees[0].telefone, "2222");
assert.equal(independentChanges.payload.absences.length, 1);

const sameField = structuredClone(base);
sameField.employees[0].telefone = "3333";
const sameFieldConflict = helpers.mergeSchoolPayload(base, local, sameField);
assert.equal(sameFieldConflict.ok, false, "o mesmo campo alterado por duas pessoas deve pedir revisão");
assert.ok(sameFieldConflict.conflicts.some((item) => item.includes("telefone")));

console.log("Collaboration merge test passed");
