(function () {
  "use strict";

  const encoder = new TextEncoder();
  const definitions = {
    employees: {
      label: "Funcionários",
      filename: "funcionarios",
      rows: () => sortedRegistryItems("employee"),
      columns: [["Nome", "nome"], ["Documento", (p) => `${p.docTipo || "RG"} ${p.rg || ""}`.trim()], ["Matrícula", "matricula"], ["Cargo/Função", "cargo"], ["Situação funcional", "situacaoFuncional"], ["Setor", "setor"], ["Telefone", "telefone"], ["Contato de emergência", "contatoEmergencia"], ["Telefone de emergência", "telefoneEmergencia"], ["Nascimento", "nascimento"], ["Jornada", "jornada"], ["Horário", "horario"], ["Intervalo", "intervalo"], ["Status", "status"]],
    },
    teachers: {
      label: "Professores",
      filename: "professores",
      rows: () => sortedRegistryItems("teacher"),
      columns: [["Nome", "nome"], ["Documento", (p) => `${p.docTipo || "RG"} ${p.rg || ""}`.trim()], ["F/N", "fn"], ["Matrícula", "matricula"], ["Situação", "situacao"], ["Categoria", "categoria"], ["Disciplina/Função", "disciplina"], ["Setor", "setor"], ["Telefone", "telefone"], ["Contato de emergência", "contatoEmergencia"], ["Telefone de emergência", "telefoneEmergencia"], ["Nascimento", "nascimento"], ["Jornada", "jornada"], ["Carga suplementar", "cargaSuplementar"], ["Carga horária", "cargaHoraria"], ["Horário", "horario"], ["Intervalo", "intervalo"], ["Sede", "sede"], ["Sede local", "sedeLocal"], ["Substituto", "substituto"], ["Status", "status"]],
    },
    timebank: {
      label: "Banco de horas",
      filename: () => `banco_de_horas_${timeBankSelectedYear()}`,
      rows: () => timeBankPeople("all"),
      columns: [["Nome", "nome"], ["Vínculo", (p) => p._type === "employee" ? "Funcionário" : "Professor"], ["Cargo/Função", (p) => timeBankRoleLabel(p)], ["Matrícula", "matricula"], ["Ano", () => timeBankSelectedYear()], ["Saldo", (p) => formatBankHours(timeBankTotal(p._type, p.id))], ["Equivalência", (p) => formatBankEquivalent(timeBankTotal(p._type, p.id), p._type)], ["Lançamentos", (p) => timeBankEntriesFor(p._type, p.id, timeBankSelectedYear()).length]],
    },
    occurrences: {
      label: "Ocorrências",
      filename: "ocorrencias",
      rows: occurrenceRows,
      columns: [["Nome", (o) => serverName(o.personType, o.personId)], ["Vínculo", (o) => o.personType === "employee" ? "Funcionário" : "Professor"], ["Data inicial", "start"], ["Data final", "end"], ["Tipo/Texto", (o) => occurrenceText(o)], ["Duração", "duracao"], ["Comprovante", "comprovante"], ["C.H. BO", (o) => isBOOccurrence(o) ? numberPt(o.boHoras) : ""], ["Unidade BO", "boUnidade"], ["Observação", "observacao"]],
    },
  };

  function fold(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
  }
  function occurrenceRows() {
    const query = fold(document.getElementById("occurrenceSearch")?.value);
    const type = document.getElementById("occurrenceTypeFilter")?.value || "all";
    const year = document.getElementById("occurrenceYearFilter")?.value || "all";
    return [...data.occurrences]
      .filter((item) => type === "all" || item.personType === type)
      .filter((item) => year === "all" || item.start?.startsWith(year))
      .filter((item) => !query || fold(serverName(item.personType, item.personId)).includes(query))
      .sort((a, b) => String(b.start || "").localeCompare(String(a.start || "")) || nameCollator.compare(serverName(a.personType, a.personId), serverName(b.personType, b.personId)));
  }
  function tableFor(key) {
    const definition = definitions[key];
    const headers = definition.columns.map(([header]) => header);
    const rows = definition.rows().map((item) => definition.columns.map(([, accessor]) => {
      const value = typeof accessor === "function" ? accessor(item) : item[accessor];
      return value === null || value === undefined ? "" : String(value);
    }));
    return { definition, headers, rows };
  }
  function safeCsvCell(value) {
    let text = String(value ?? "").replace(/\r?\n/g, " ");
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }
  function buildCsv(table) {
    return `\uFEFF${[table.headers, ...table.rows].map((row) => row.map(safeCsvCell).join(";")).join("\r\n")}`;
  }
  function xml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
  }
  function columnName(index) {
    let value = index + 1, name = "";
    while (value) { value -= 1; name = String.fromCharCode(65 + (value % 26)) + name; value = Math.floor(value / 26); }
    return name;
  }
  function sheetXml(table) {
    const rows = [table.headers, ...table.rows];
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => `<c r="${columnName(columnIndex)}${rowIndex + 1}" t="inlineStr"${rowIndex === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${xml(String(value).slice(0, 32767))}</t></is></c>`).join("")}</row>`).join("")}</sheetData><autoFilter ref="A1:${columnName(Math.max(0, table.headers.length - 1))}${Math.max(1, rows.length)}"/></worksheet>`;
  }
  function crc32(bytes) {
    let crc = -1;
    for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    return (crc ^ -1) >>> 0;
  }
  function little(value, size) {
    const bytes = new Uint8Array(size);
    for (let index = 0; index < size; index += 1) bytes[index] = (value >>> (index * 8)) & 255;
    return bytes;
  }
  function join(parts) {
    const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
    let offset = 0;
    for (const part of parts) { result.set(part, offset); offset += part.length; }
    return result;
  }
  function zip(files) {
    const locals = [], centrals = [];
    let offset = 0;
    for (const [name, content] of Object.entries(files)) {
      const nameBytes = encoder.encode(name), dataBytes = encoder.encode(content), crc = crc32(dataBytes);
      const local = join([little(0x04034b50, 4), little(20, 2), little(0x0800, 2), little(0, 2), little(0, 2), little(0, 2), little(crc, 4), little(dataBytes.length, 4), little(dataBytes.length, 4), little(nameBytes.length, 2), little(0, 2), nameBytes, dataBytes]);
      const central = join([little(0x02014b50, 4), little(20, 2), little(20, 2), little(0x0800, 2), little(0, 2), little(0, 2), little(0, 2), little(crc, 4), little(dataBytes.length, 4), little(dataBytes.length, 4), little(nameBytes.length, 2), little(0, 2), little(0, 2), little(0, 2), little(0, 2), little(0, 4), little(offset, 4), nameBytes]);
      locals.push(local); centrals.push(central); offset += local.length;
    }
    const centralData = join(centrals);
    return join([...locals, centralData, little(0x06054b50, 4), little(0, 2), little(0, 2), little(centrals.length, 2), little(centrals.length, 2), little(centralData.length, 4), little(offset, 4), little(0, 2)]);
  }
  function buildXlsx(table) {
    const sheetName = table.definition.label.slice(0, 31);
    return zip({
      "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
      "_rels/.rels": '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
      "xl/styles.xml": '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
      "xl/worksheets/sheet1.xml": sheetXml(table),
    });
  }
  function fileBase(definition) {
    const base = typeof definition.filename === "function" ? definition.filename() : definition.filename;
    return `${base}_${new Date().toISOString().slice(0, 10)}`;
  }
  function download(content, type, filename) {
    const blob = new Blob([content], { type }), link = document.createElement("a"), url = URL.createObjectURL(blob);
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  function exportTable(key, format) {
    const table = tableFor(key);
    if (!table.rows.length) { window.GFP_APP.notify("Não há registros no filtro atual para exportar.", "warning"); return; }
    const base = fileBase(table.definition);
    if (format === "csv") download(buildCsv(table), "text/csv;charset=utf-8", `${base}.csv`);
    else download(buildXlsx(table), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", `${base}.xlsx`);
  }
  function toolbar(key) {
    const host = document.createElement("div");
    host.className = "export-toolbar";
    host.innerHTML = `<button class="mini-btn export-csv" type="button">Exportar CSV</button><button class="mini-btn export-xlsx" type="button">Exportar Excel</button>`;
    host.querySelector(".export-csv").addEventListener("click", () => exportTable(key, "csv"));
    host.querySelector(".export-xlsx").addEventListener("click", () => exportTable(key, "xlsx"));
    return host;
  }
  function install() {
    for (const [key, target] of [["employees", "employeeTable"], ["teachers", "teacherTable"], ["occurrences", "occurrenceTable"], ["timebank", "timeBankTable"]]) {
      const element = document.getElementById(target), card = element?.closest(".card");
      if (!element || !card || card.querySelector(`[data-export-for="${key}"]`)) continue;
      const controls = toolbar(key); controls.dataset.exportFor = key; card.insertBefore(controls, element);
    }
  }

  install();
  window.DIB_EXPORTS = { tableFor, buildCsv, buildXlsx, exportTable };
})();
