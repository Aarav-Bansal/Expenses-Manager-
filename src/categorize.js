import { CATEGORIES } from './csv.js';
import { assignDemons, fallbackTale } from './story.js';

// The "omen": a best guess the player can consult. The player's own choice is what gets recorded.
const WORK = /aws|amazon web|google cloud|github|gitlab|slack|zoom|notion|figma|adobe|atlassian|jira|digitalocean|linkedin|staples|office depot|fedex|ups store|docusign|canva|openai|anthropic|vercel|cloudflare|coworking|wework|conference|airline|airways|hotel|marriott|hilton/i;
const PERSONAL = /netflix|spotify|hulu|disney|steam|playstation|xbox|nintendo|zomato|swiggy|doordash|uber eats|grubhub|bar |pub |brewery|casino|sephora|zara|h&m|myntra|nykaa|gym|cinema|pvr|tinder|bumble|onlyfans|twitch/i;

export const ruleHint = (merchant, note = '') => {
  const text = `${merchant} ${note}`;
  if (/personal|gift|birthday/i.test(note)) return 'personal';
  if (WORK.test(text)) return 'work';
  if (PERSONAL.test(text)) return 'personal';
  return 'unknown';
};

const validTale = (t) => (typeof t === 'string' && t.trim() && t.length <= 300 ? t.trim().replace(/[\u0000-\u001f]/g, ' ') : null);

/**
 * Attach omen + story to each expense. `aiLookup(items)` (optional, Gemini) wins when it returns valid values;
 * otherwise rules and templates apply, so the game works with no API key.
 */
export async function summon(rows, aiLookup) {
  let ai = {};
  if (aiLookup) {
    try { ai = (await aiLookup(rows.slice(0, 100).map(({ id, merchant, amount, note }) => ({ id, merchant, amount, note })))) ?? {}; }
    catch { /* fall back to rules */ }
  }
  return assignDemons(rows).map((r) => {
    const a = ai[r.id] ?? {};
    const hint = CATEGORIES.includes(a.hint) ? a.hint : ruleHint(r.merchant, r.note);
    return { ...r, hint, tale: validTale(a.tale) ?? fallbackTale(hint, r.id) };
  });
}
