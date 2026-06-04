"use client";

import { useState, useCallback, useRef } from "react";

// ─────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────
interface VacancyRow {
  url: string;
  company_slug: string;
  company_name: string;
  source_name: "Work.ua" | "Robota.ua" | "";
  note: string;
}

type SourceFilter = "all" | "work" | "robota";

// ─────────────────────────────────────────────
//  Patterns
// ─────────────────────────────────────────────
const WORK_PATTERN =
  /https?:\/\/(?:www\.)?work\.ua\/jobs\/(\d+)\/?/gi;

const ROBOTA_PATTERN =
  /https?:\/\/(?:www\.)?robota\.ua\/(?:ua\/)?company\d+\/vacancy\d+(?:\?[^\s"<>]*)*/gi;

const ROBOTA_PATTERN_LEGACY =
  /https?:\/\/(?:www\.)?robota\.ua\/company\d+\/vacancy\d+(?:\?[^\s"<>]*)*/gi;

function detectSource(url: string): VacancyRow["source_name"] {
  if (/work\.ua/i.test(url)) return "Work.ua";
  if (/robota\.ua/i.test(url)) return "Robota.ua";
  return "";
}

function cleanUrl(raw: string): string {
  // strip query/fragment, normalise trailing slash for work.ua
  const base = raw.split("?")[0].split("#")[0];
  if (/work\.ua\/jobs\/\d+/.test(base)) {
    return base.replace(/\/?$/, "/");
  }
  return base;
}

function extractUrls(input: string): VacancyRow[] {
  const combined =
    WORK_PATTERN.source + "|" + ROBOTA_PATTERN.source + "|" + ROBOTA_PATTERN_LEGACY.source;
  const allPattern = new RegExp(combined, "gi");

  const seen = new Set<string>();
  const rows: VacancyRow[] = [];

  let match: RegExpExecArray | null;
  while ((match = allPattern.exec(input)) !== null) {
    const url = cleanUrl(match[0]);
    if (seen.has(url)) continue;
    seen.add(url);
    rows.push({
      url,
      company_slug: "",
      company_name: "",
      source_name: detectSource(url),
      note: "",
    });
  }
  return rows;
}

function rowsToCsv(rows: VacancyRow[]): string {
  const header = "url,company_slug,company_name,source_name,note";
  const lines = rows.map((r) => {
    const fields = [r.url, r.company_slug, r.company_name, r.source_name, r.note];
    return fields
      .map((f) => (f.includes(",") || f.includes('"') ? `"${f.replace(/"/g, '""')}"` : f))
      .join(",");
  });
  return [header, ...lines].join("\n");
}

function rowsToTxt(rows: VacancyRow[]): string {
  return rows.map((r) => r.url).join("\n");
}

// ─────────────────────────────────────────────
//  UI helpers
// ─────────────────────────────────────────────
function CopyButton({ text, label = "Копіювати" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }, [text]);

  return (
    <button
      onClick={copy}
      className={`copy-btn ${copied ? "copied" : ""}`}
      type="button"
      aria-label={label}
    >
      {copied ? "✓ Скопійовано" : label}
    </button>
  );
}

// ─────────────────────────────────────────────
//  Main page
// ─────────────────────────────────────────────
export default function VacancyUrlToolsPage() {
  const [input, setInput] = useState("");
  const [rows, setRows] = useState<VacancyRow[]>([]);
  const [filter, setFilter] = useState<SourceFilter>("all");
  const [tab, setTab] = useState<"csv" | "txt">("csv");
  const [processed, setProcessed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleExtract = useCallback(() => {
    const extracted = extractUrls(input);
    setRows(extracted);
    setProcessed(true);
  }, [input]);

  const handleClear = useCallback(() => {
    setInput("");
    setRows([]);
    setProcessed(false);
  }, []);

  const filtered = rows.filter((r) => {
    if (filter === "work") return r.source_name === "Work.ua";
    if (filter === "robota") return r.source_name === "Robota.ua";
    return true;
  });

  const csvOutput = rowsToCsv(filtered);
  const txtOutput = rowsToTxt(filtered);

  const workCount = rows.filter((r) => r.source_name === "Work.ua").length;
  const robotaCount = rows.filter((r) => r.source_name === "Robota.ua").length;

  return (
    <>
      <style>{`
        :root {
          --bg: #0d0f14;
          --surface: #161921;
          --surface2: #1e2230;
          --border: #2a2f3e;
          --border-focus: #4a6fa5;
          --text: #e8eaf0;
          --text-muted: #7a8099;
          --accent: #4a90d9;
          --accent-hover: #5fa8f0;
          --success: #3ecf72;
          --work: #e8734a;
          --robota: #5b8dd9;
          --radius: 8px;
          --mono: "JetBrains Mono", "Fira Code", "Cascadia Code", monospace;
          --sans: "Inter", "DM Sans", system-ui, sans-serif;
        }
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          background: var(--bg);
          color: var(--text);
          font-family: var(--sans);
          min-height: 100vh;
        }

        .page {
          max-width: 900px;
          margin: 0 auto;
          padding: 2.5rem 1.5rem 4rem;
        }

        .header {
          margin-bottom: 2.5rem;
        }
        .header-tag {
          font-size: 0.7rem;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--text-muted);
          margin-bottom: 0.6rem;
        }
        .header h1 {
          font-size: 1.75rem;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: var(--text);
          line-height: 1.2;
        }
        .header p {
          margin-top: 0.6rem;
          color: var(--text-muted);
          font-size: 0.9rem;
          line-height: 1.5;
        }

        .card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 1.25rem;
          margin-bottom: 1.25rem;
        }

        .label {
          font-size: 0.75rem;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--text-muted);
          margin-bottom: 0.65rem;
          display: block;
        }

        textarea {
          width: 100%;
          min-height: 160px;
          background: var(--surface2);
          border: 1px solid var(--border);
          border-radius: calc(var(--radius) - 2px);
          color: var(--text);
          font-family: var(--mono);
          font-size: 0.78rem;
          line-height: 1.6;
          padding: 0.85rem 1rem;
          resize: vertical;
          outline: none;
          transition: border-color 0.15s;
        }
        textarea:focus {
          border-color: var(--border-focus);
        }
        textarea::placeholder {
          color: var(--text-muted);
          opacity: 0.6;
        }

        .actions {
          display: flex;
          gap: 0.75rem;
          margin-top: 0.85rem;
          flex-wrap: wrap;
          align-items: center;
        }

        .btn-primary {
          background: var(--accent);
          color: #fff;
          border: none;
          border-radius: var(--radius);
          padding: 0.55rem 1.2rem;
          font-size: 0.875rem;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s;
        }
        .btn-primary:hover { background: var(--accent-hover); }

        .btn-ghost {
          background: transparent;
          color: var(--text-muted);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 0.55rem 1rem;
          font-size: 0.875rem;
          cursor: pointer;
          transition: color 0.15s, border-color 0.15s;
        }
        .btn-ghost:hover {
          color: var(--text);
          border-color: var(--text-muted);
        }

        .stats {
          display: flex;
          gap: 1.5rem;
          flex-wrap: wrap;
          margin-bottom: 1.25rem;
        }
        .stat {
          display: flex;
          align-items: baseline;
          gap: 0.4rem;
        }
        .stat-num {
          font-size: 1.5rem;
          font-weight: 700;
          font-family: var(--mono);
          line-height: 1;
        }
        .stat-num.total { color: var(--text); }
        .stat-num.work { color: var(--work); }
        .stat-num.robota { color: var(--robota); }
        .stat-label {
          font-size: 0.75rem;
          color: var(--text-muted);
          letter-spacing: 0.05em;
        }

        .filter-row {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1.1rem;
          flex-wrap: wrap;
        }
        .filter-btn {
          padding: 0.3rem 0.85rem;
          font-size: 0.78rem;
          font-weight: 600;
          border-radius: 99px;
          border: 1px solid var(--border);
          background: transparent;
          color: var(--text-muted);
          cursor: pointer;
          transition: all 0.15s;
        }
        .filter-btn:hover {
          border-color: var(--text-muted);
          color: var(--text);
        }
        .filter-btn.active-all {
          background: var(--surface2);
          border-color: var(--border-focus);
          color: var(--text);
        }
        .filter-btn.active-work {
          background: rgba(232, 115, 74, 0.12);
          border-color: var(--work);
          color: var(--work);
        }
        .filter-btn.active-robota {
          background: rgba(91, 141, 217, 0.12);
          border-color: var(--robota);
          color: var(--robota);
        }

        .tabs {
          display: flex;
          gap: 0;
          border-bottom: 1px solid var(--border);
          margin-bottom: 1rem;
        }
        .tab {
          padding: 0.55rem 1.1rem;
          font-size: 0.8rem;
          font-weight: 600;
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          border-bottom: 2px solid transparent;
          margin-bottom: -1px;
          transition: color 0.15s, border-color 0.15s;
        }
        .tab.active {
          color: var(--accent);
          border-bottom-color: var(--accent);
        }

        .output-area {
          position: relative;
        }
        .output-area textarea {
          min-height: 220px;
          padding-top: 0.85rem;
          padding-right: 7rem;
          font-size: 0.73rem;
        }
        .output-copy {
          position: absolute;
          top: 0.65rem;
          right: 0.65rem;
        }

        .copy-btn {
          background: var(--surface2);
          border: 1px solid var(--border);
          color: var(--text-muted);
          border-radius: calc(var(--radius) - 2px);
          padding: 0.3rem 0.75rem;
          font-size: 0.75rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
          white-space: nowrap;
        }
        .copy-btn:hover {
          color: var(--text);
          border-color: var(--text-muted);
        }
        .copy-btn.copied {
          color: var(--success);
          border-color: var(--success);
          background: rgba(62, 207, 114, 0.08);
        }

        .empty-state {
          text-align: center;
          padding: 3rem 1rem;
          color: var(--text-muted);
          font-size: 0.875rem;
        }
        .empty-state-icon {
          font-size: 2.5rem;
          margin-bottom: 0.75rem;
          display: block;
          opacity: 0.4;
        }

        .no-results {
          padding: 1.5rem;
          text-align: center;
          color: var(--text-muted);
          font-size: 0.875rem;
        }

        .hint {
          font-size: 0.75rem;
          color: var(--text-muted);
          line-height: 1.5;
          margin-top: 0.5rem;
        }
        .hint code {
          font-family: var(--mono);
          font-size: 0.7rem;
          background: var(--surface2);
          border: 1px solid var(--border);
          border-radius: 3px;
          padding: 0.05em 0.35em;
          color: var(--accent);
        }

        .cmd-block {
          background: var(--surface2);
          border: 1px solid var(--border);
          border-radius: calc(var(--radius) - 2px);
          padding: 0.7rem 1rem;
          font-family: var(--mono);
          font-size: 0.75rem;
          color: var(--success);
          margin-top: 0.5rem;
          user-select: all;
        }

        .section-title {
          font-size: 0.75rem;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--text-muted);
          margin-bottom: 0.5rem;
        }
      `}</style>

      <div className="page">
        {/* Header */}
        <div className="header">
          <p className="header-tag">Admin Tools / Прозора Робота</p>
          <h1>Vacancy URL Extractor</h1>
          <p>
            Вставте HTML або список посилань, скопійований зі сторінки Work.ua / Robota.ua —
            і отримайте готовий CSV для importer. Жодних fetch-запитів, жодного обходу захисту.
          </p>
        </div>

        {/* Input card */}
        <div className="card">
          <label className="label" htmlFor="url-input">
            Вставити HTML або список посилань
          </label>
          <textarea
            id="url-input"
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Вставте сюди:\n• Скопійований HTML сторінки (Ctrl+U → Ctrl+A → Ctrl+C)\n• Або просто список URL, по одному на рядок\n• Або вивід console-snippet із docs/vacancy-url-collection.md\n\nПриклад:\nhttps://www.work.ua/jobs/8140419/\nhttps://robota.ua/company562625/vacancy9100001`}
          />
          <div className="actions">
            <button className="btn-primary" onClick={handleExtract} type="button">
              Витягнути URL вакансій
            </button>
            {processed && (
              <button className="btn-ghost" onClick={handleClear} type="button">
                Очистити
              </button>
            )}
          </div>
          <p className="hint">
            Підтримувані формати: <code>work.ua/jobs/NNNNN/</code> та{" "}
            <code>robota.ua/companyNNN/vacancyNNN</code>.
            Дублікати видаляються автоматично.
          </p>
        </div>

        {/* Results */}
        {processed && rows.length === 0 && (
          <div className="card">
            <div className="no-results">
              Вакансій не знайдено. Перевірте, що вставлений текст містить посилання Work.ua або Robota.ua.
            </div>
          </div>
        )}

        {rows.length > 0 && (
          <>
            {/* Stats */}
            <div className="stats">
              <div className="stat">
                <span className="stat-num total">{rows.length}</span>
                <span className="stat-label">всього</span>
              </div>
              {workCount > 0 && (
                <div className="stat">
                  <span className="stat-num work">{workCount}</span>
                  <span className="stat-label">Work.ua</span>
                </div>
              )}
              {robotaCount > 0 && (
                <div className="stat">
                  <span className="stat-num robota">{robotaCount}</span>
                  <span className="stat-label">Robota.ua</span>
                </div>
              )}
            </div>

            {/* Output card */}
            <div className="card">
              {/* Filter */}
              <div className="filter-row">
                <button
                  className={`filter-btn ${filter === "all" ? "active-all" : ""}`}
                  onClick={() => setFilter("all")}
                  type="button"
                >
                  Всі ({rows.length})
                </button>
                {workCount > 0 && (
                  <button
                    className={`filter-btn ${filter === "work" ? "active-work" : ""}`}
                    onClick={() => setFilter("work")}
                    type="button"
                  >
                    Work.ua ({workCount})
                  </button>
                )}
                {robotaCount > 0 && (
                  <button
                    className={`filter-btn ${filter === "robota" ? "active-robota" : ""}`}
                    onClick={() => setFilter("robota")}
                    type="button"
                  >
                    Robota.ua ({robotaCount})
                  </button>
                )}
              </div>

              {/* Tabs */}
              <div className="tabs">
                <button
                  className={`tab ${tab === "csv" ? "active" : ""}`}
                  onClick={() => setTab("csv")}
                  type="button"
                >
                  CSV
                </button>
                <button
                  className={`tab ${tab === "txt" ? "active" : ""}`}
                  onClick={() => setTab("txt")}
                  type="button"
                >
                  TXT (тільки URL)
                </button>
              </div>

              {/* Output */}
              <div className="output-area">
                <textarea
                  readOnly
                  value={tab === "csv" ? csvOutput : txtOutput}
                  aria-label={tab === "csv" ? "CSV output" : "TXT output"}
                />
                <div className="output-copy">
                  <CopyButton
                    text={tab === "csv" ? csvOutput : txtOutput}
                    label={tab === "csv" ? "Копіювати CSV" : "Копіювати TXT"}
                  />
                </div>
              </div>

              {/* Import commands */}
              <div style={{ marginTop: "1.25rem" }}>
                <p className="section-title">Запуск importer</p>
                <p className="hint" style={{ marginBottom: "0.4rem" }}>
                  Збережіть CSV у <code>data/vacancy-urls-import.csv</code>, потім:
                </p>
                <div className="cmd-block">
                  npm run import:vacancy-urls -- --file=data/vacancy-urls-import.csv --dry-run
                </div>
                <div className="cmd-block" style={{ marginTop: "0.4rem" }}>
                  npm run import:vacancy-urls -- --file=data/vacancy-urls-import.csv
                </div>
              </div>
            </div>
          </>
        )}

        {!processed && (
          <div className="empty-state">
            <span className="empty-state-icon">⬆</span>
            Вставте HTML або URL у поле вище і натисніть «Витягнути URL вакансій»
          </div>
        )}
      </div>
    </>
  );
}
