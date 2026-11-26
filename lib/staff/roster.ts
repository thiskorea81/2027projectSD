// 교직원 명렬표(hwpx 또는 csv) → 교직원 목록
// 표에서 '부서/소속' 과 '담당자/성명/이름' 머리글이 있는 줄을 찾아, 그 아래 줄들을 읽습니다.
// 한 표 안에 머리글이 여러 번 나오면(교무·학년·행정실 묶음) 각 묶음의 열 위치를 따로 씁니다.
import { normalizeName } from "../auth/login-id.ts";
import { readZipEntries } from "./zip.ts";

export type RosterRow = {
  order: number; // 파일 안 등장 순서 (같은 이름이면 이 순서로 아이디를 붙입니다)
  name: string;
  department: string;
  position: string | null;
};

export type RosterResult = {
  rows: RosterRow[];
  skippedPlaceholders: number; // '시간강사1' 처럼 실제 이름이 아닌 칸
};

type Cell = { col: number; span: number; text: string };

const DEPT_HEADER = /^(부서|소속|부서명)$/;
const NAME_HEADER = /^(담당자|성명|이름|교사명|교직원명)$/;
const POSITION_HEADER = /^(직책|직위|직명|담당업무|업무)$/;

export function parseRoster(file: Buffer, filename: string): RosterResult {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".hwpx")) return rosterFromTables(hwpxTables(file));
  if (lower.endsWith(".csv")) return rosterFromTables([csvTable(file)]);
  throw new Error("명렬표는 .hwpx 또는 .csv(UTF-8) 파일만 읽을 수 있습니다. 엑셀은 CSV(UTF-8)로 저장해 주세요.");
}

// ---------- hwpx ----------
function hwpxTables(file: Buffer): Cell[][][] {
  const entries = readZipEntries(file);
  const sections = [...entries.keys()]
    .filter((k) => /^Contents\/section\d+\.xml$/.test(k))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (sections.length === 0) throw new Error("hwpx 안에 본문(section)이 없습니다.");
  const tables: Cell[][][] = [];
  for (const key of sections) {
    const xml = entries.get(key)!.toString("utf8");
    for (const tbl of xml.match(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/g) ?? []) {
      const rows = new Map<number, Cell[]>();
      for (const tc of tbl.match(/<hp:tc\b[\s\S]*?<\/hp:tc>/g) ?? []) {
        const addr = tc.match(/<hp:cellAddr\b[^>]*colAddr="(\d+)"[^>]*rowAddr="(\d+)"/);
        if (!addr) continue;
        const span = Number(tc.match(/<hp:cellSpan\b[^>]*colSpan="(\d+)"/)?.[1] ?? "1");
        const text = [...tc.matchAll(/<hp:t>([\s\S]*?)<\/hp:t>/g)]
          .map((m) => decodeXml(m[1].replace(/<[^>]+>/g, " ")))
          .join("");
        const row = Number(addr[2]);
        if (!rows.has(row)) rows.set(row, []);
        rows.get(row)!.push({ col: Number(addr[1]), span, text: text.trim() });
      }
      tables.push([...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, cells]) => cells.sort((a, b) => a.col - b.col)));
    }
  }
  return tables;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

// ---------- csv ----------
function csvTable(file: Buffer): Cell[][] {
  const text = file.toString("utf8").replace(/^﻿/, "");
  const rows: Cell[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const pushRow = () => {
    row.push(field);
    rows.push(row.map((t, col) => ({ col, span: 1, text: t.trim() })));
    row = [];
    field = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") pushRow();
    else if (ch !== "\r") field += ch;
  }
  if (field || row.length) pushRow();
  return rows;
}

// ---------- 공통: 표 → 교직원 목록 ----------
type Columns = { dept: number; name: number; position: number | null };

function cellAt(cells: Cell[], col: number): string {
  return cells.find((c) => c.col <= col && col < c.col + c.span)?.text ?? "";
}

function headerColumns(cells: Cell[]): Columns | null {
  const squash = (t: string) => t.replace(/\s+/g, "");
  const dept = cells.find((c) => DEPT_HEADER.test(squash(c.text)));
  const name = cells.find((c) => NAME_HEADER.test(squash(c.text)));
  if (!dept || !name) return null;
  const position = cells.find((c) => POSITION_HEADER.test(squash(c.text)));
  return { dept: dept.col, name: name.col, position: position?.col ?? null };
}

// 실제 사람 이름으로 볼 수 있는지: 괄호 메모(예: "(기간제)")를 뺀 뒤 글자만 2~20자.
// '시간강사1', '순회교사3' 처럼 숫자가 붙은 자리표시는 건너뜁니다.
export function cleanPersonName(raw: string): string | null {
  const name = normalizeName(raw.replace(/\(.*?\)|（.*?）/g, ""));
  return /^\p{L}{2,20}$/u.test(name) ? name : null;
}

export function rosterFromTables(tables: Cell[][][]): RosterResult {
  const rows: RosterRow[] = [];
  let skippedPlaceholders = 0;
  for (const table of tables) {
    let cols: Columns | null = null;
    for (const cells of table) {
      const header = headerColumns(cells);
      if (header) {
        cols = header;
        continue;
      }
      if (!cols) continue;
      const rawName = cellAt(cells, cols.name);
      if (!rawName) continue;
      const name = cleanPersonName(rawName);
      if (!name) {
        skippedPlaceholders++;
        continue;
      }
      const department = cellAt(cells, cols.dept).replace(/\s+/g, "");
      const position = cols.position === null ? "" : cellAt(cells, cols.position).replace(/\s+/g, "");
      rows.push({ order: rows.length + 1, name, department, position: position || null });
    }
  }
  if (rows.length === 0) {
    throw new Error("명렬표에서 교직원을 찾지 못했습니다. 표에 '부서'와 '담당자(또는 성명)' 머리글이 있는지 확인하세요.");
  }
  return { rows, skippedPlaceholders };
}
