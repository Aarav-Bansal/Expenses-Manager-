const TIERS = ['imp', 'specter', 'wraith', 'arch-fiend'];

/** Bigger charges raise bigger demons. Tiers come from the ledger's own amounts, so any currency works. */
export function assignDemons(rows) {
  const sorted = rows.map((r) => r.amount).sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const cuts = [at(0.4), at(0.75), at(0.92)];
  return rows.map((r) => ({ ...r, demon: TIERS[cuts.filter((c) => r.amount >= c).length] ?? 'imp' }));
}

const TALES = {
  work: [
    'It clutches a lanyard and a briefcase stuffed with unsigned forms.',
    'Its voice is a conference-call echo: "Per my last email... per my last email..."',
    'It wears a name badge that reads only "Reimburse Me".',
  ],
  personal: [
    'It smells of midnight impulse and a promise you made yourself last Tuesday.',
    'It grins with a thousand tiny shopping bags rattling behind it.',
    'It hums a tune you only play when nobody is listening.',
  ],
  unknown: [
    'It has no face, only a smudged receipt where a face should be.',
    'It flickers between a suit and a hoodie, refusing to say which it is.',
    'It whispers: "You remember me. You just do not remember why."',
  ],
};

export const fallbackTale = (hint, id) => TALES[hint][id % TALES[hint].length];
