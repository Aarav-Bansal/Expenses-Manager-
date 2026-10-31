import { CATEGORIES, makeRow } from "./csv.js";
import { LABEL, STATUS } from "./report.js";

export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const BASE = "https://sheets.googleapis.com/v4/spreadsheets";
export const SHEET_ID_RE = /^[A-Za-z0-9_-]{20,80}$/;
export const TAB_RE = /^[A-Za-z0-9 _.-]{1,40}$/;
export const MAX_SHEET_ROWS = 501; // header + 500 expenses

export class SheetsError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

/** Accepts a full Google Sheets URL or a bare spreadsheet id; returns the id or null. */
export function extractSheetId(input) {
  const s = String(input ?? "").trim();
  const id = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(s)?.[1] ?? s;
  return SHEET_ID_RE.test(id) ? id : null;
}

export const colLetter = (i) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** Find the columns we care about from the header row (case-insensitive). */
export function findColumns(header) {
  const h = header.map((x) =>
    String(x ?? "")
      .trim()
      .toLowerCase(),
  );
  const at = (...names) => h.findIndex((x) => names.includes(x));
  const cols = {
    merchant: at("merchant", "vendor"),
    amount: at("amount", "total"),
    date: at("date"),
    note: at("note", "notes", "memo"),
    category: at("category"),
    status: at("status"),
    reviewedAt: at("reviewed at", "reviewed"),
  };
  const missing = ["merchant", "amount", "category", "status"].filter(
    (k) => cols[k] === -1,
  );
  if (missing.length)
    throw new SheetsError(
      `The sheet needs these header columns: ${missing.join(", ")}.`,
      400,
    );
  return cols;
}

/** Default credentials: an explicit service-account key (env) or Application Default Credentials (Cloud Run). */
export function googleToken(env = process.env) {
  let auth;
  const key = env.SHEETS_SA_KEY_JSON
    ? JSON.parse(env.SHEETS_SA_KEY_JSON)
    : null;
  const getToken = async () => {
    auth ??= new (await import("google-auth-library")).GoogleAuth({
      scopes: [SHEETS_SCOPE],
      ...(key && { credentials: key }),
    });
    const token = await auth.getAccessToken();
    if (!token) throw new Error("no token");
    return token;
  };
  return {
    getToken,
    serviceAccount: key?.client_email ?? env.SHEETS_SERVICE_ACCOUNT ?? null,
  };
}

/** Google Sheets as the "expense system": read unreviewed rows, write back the category and status. */
export function makeSheets({
  getToken,
  serviceAccount = null,
  fetchImpl = fetch,
  now = () => new Date(),
}) {
  const hint = serviceAccount
    ? ` Share it with ${serviceAccount} as Editor.`
    : "";

  async function request(path, init = {}) {
    let token;
    try {
      token = await getToken();
    } catch {
      throw new SheetsError(
        "The server has no Google credentials for Sheets.",
        503,
      );
    }
    const res = await fetchImpl(`${BASE}/${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
    });
    if (res.status === 403 || res.status === 404)
      throw new SheetsError(`Cannot open that sheet or tab.${hint}`, 400);
    if (res.status === 400)
      throw new SheetsError(
        "Google rejected the request. Check the tab name.",
        400,
      );
    if (res.status === 429)
      throw new SheetsError(
        "Google Sheets is busy. Try again in a minute.",
        429,
      );
    if (!res.ok)
      throw new SheetsError("Google Sheets request failed. Please try again.");
    return res.json();
  }

  const range = (tab, a1) => encodeURIComponent(`'${tab}'!${a1}`);

  return {
    serviceAccount,

    /** Unreviewed expenses (blank Status) from the tab, as game rows with their sheet row numbers. */
    async readLedger(id, tab) {
      const data = await request(
        `${encodeURIComponent(id)}/values/${range(tab, `A1:Z${MAX_SHEET_ROWS}`)}`,
      );
      const [header = [], ...body] = data.values ?? [];
      const c = findColumns(header);
      const rows = [];
      body.forEach((cells, i) => {
        if (String(cells[c.status] ?? "").trim()) return; // already reviewed
        const row = makeRow(
          {
            merchant: cells[c.merchant],
            amount: cells[c.amount],
            date: c.date === -1 ? "" : cells[c.date],
            note: c.note === -1 ? "" : cells[c.note],
          },
          rows.length + 1,
          i + 2,
        );
        if (row) rows.push(row);
      });
      if (!rows.length)
        throw new SheetsError(
          "No unreviewed expenses found. Rows need a merchant, an amount and a blank Status.",
          400,
        );
      return rows;
    },

    /** Write Category + Status (+ Reviewed At if that column exists) for each tagged row, in one batch. */
    async tag(id, tab, tags) {
      const head = await request(
        `${encodeURIComponent(id)}/values/${range(tab, "1:1")}`,
      );
      const c = findColumns(head.values?.[0] ?? []);
      const stamp = now().toISOString().slice(0, 10);
      const data = tags.flatMap(({ row, category }) => [
        {
          range: `'${tab}'!${colLetter(c.category)}${row}`,
          values: [[LABEL[category]]],
        },
        {
          range: `'${tab}'!${colLetter(c.status)}${row}`,
          values: [[STATUS[category]]],
        },
        ...(c.reviewedAt === -1
          ? []
          : [
              {
                range: `'${tab}'!${colLetter(c.reviewedAt)}${row}`,
                values: [[stamp]],
              },
            ]),
      ]);
      await request(`${encodeURIComponent(id)}/values:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({ valueInputOption: "RAW", data }),
      });
      return tags.length;
    },
  };
}

/** Validate untrusted tag requests from the client. */
export function validateTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0 || tags.length > 100)
    throw new RangeError("Send between 1 and 100 tags.");
  return tags.map((t) => {
    if (
      !t ||
      !Number.isInteger(t.row) ||
      t.row < 2 ||
      t.row > MAX_SHEET_ROWS ||
      !CATEGORIES.includes(t.category)
    )
      throw new RangeError("One of the tags is malformed.");
    return { row: t.row, category: t.category };
  });
}

export const makeSheetsFromEnv = (env = process.env) => {
  if (env.SHEETS_DISABLED === "1") return null;
  try {
    return makeSheets(googleToken(env));
  } catch {
    return null;
  }
};
