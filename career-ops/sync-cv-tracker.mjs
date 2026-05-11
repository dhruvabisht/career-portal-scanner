#!/usr/bin/env node
// Syncs roles scoring ≥ 4.0/5 from data/applications.md into output/cv-tracker.csv
// Run automatically via Stop hook at end of each session.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRACKER_MD = resolve(__dirname, 'data/applications.md');
const CSV_PATH = resolve(__dirname, 'output/cv-tracker.csv');
const SCORE_THRESHOLD = 4.0;

function parseScore(scoreStr) {
  const m = scoreStr.trim().match(/^([\d.]+)\//);
  return m ? parseFloat(m[1]) : 0;
}

function parseApplicationsMd(content) {
  const rows = [];
  for (const line of content.split('\n')) {
    if (!line.startsWith('|') || line.startsWith('| #') || line.startsWith('|---')) continue;
    const cols = line.split('|').map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
    if (cols.length < 9) continue;
    const [num, date, company, role, score, status, pdf, report, ...notesParts] = cols;
    rows.push({ num, date, company, role, score, status, pdf, report, notes: notesParts.join('|') });
  }
  return rows;
}

function readCsv(path) {
  if (!existsSync(path)) return { header: null, rows: [] };
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  if (lines.length === 0) return { header: null, rows: [] };
  const header = lines[0];
  const rows = lines.slice(1);
  return { header, rows };
}

function csvEscape(val) {
  const s = String(val ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

const mdContent = readFileSync(TRACKER_MD, 'utf8');
const allRoles = parseApplicationsMd(mdContent);
const suitable = allRoles.filter(r => parseScore(r.score) >= SCORE_THRESHOLD);

const { header, rows: existingRows } = readCsv(CSV_PATH);

// Build a set of existing keys (company+role) for dedup
const existingKeys = new Set();
for (const row of existingRows) {
  const cols = row.split(',');
  if (cols.length >= 4) {
    const company = cols[2]?.replace(/^"|"$/g, '').trim();
    const role = cols[3]?.replace(/^"|"$/g, '').trim();
    existingKeys.add(`${company}||${role}`);
  }
}

const CSV_HEADER = '#,Date,Company,Role,Score,Status,CV_Path,Job_URL,Report,Applied';

// Extract job URL from report markdown link or use N/A
function extractReportPath(reportCol) {
  const m = reportCol.match(/\[.*?\]\((.*?)\)/);
  return m ? m[1] : (reportCol || 'N/A');
}

const newRows = [];
for (const r of suitable) {
  const key = `${r.company}||${r.role}`;
  if (existingKeys.has(key)) continue;
  const reportPath = extractReportPath(r.report);
  // CV_Path and Job_URL not available from applications.md — mark as N/A
  newRows.push([r.num, r.date, r.company, r.role, r.score, r.status, 'N/A', 'N/A', reportPath, 'No']
    .map(csvEscape).join(','));
}

if (newRows.length === 0) {
  process.exit(0);
}

const currentHeader = header ?? CSV_HEADER;
const allRows = [currentHeader, ...existingRows, ...newRows];
writeFileSync(CSV_PATH, allRows.join('\n') + '\n', 'utf8');

console.log(JSON.stringify({ systemMessage: `cv-tracker: added ${newRows.length} new role(s) ≥ 4.0/5` }));
