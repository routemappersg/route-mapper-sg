/** Singapore address abbreviations, expanded before the street is stored or geocoded. */
const WORDS: Record<string, string> = {
  rd: 'Road',
  st: 'Street',
  ave: 'Avenue',
  av: 'Avenue',
  dr: 'Drive',
  cres: 'Crescent',
  gdns: 'Gardens',
  ln: 'Lane',
  cl: 'Close',
  ctrl: 'Central',
  cntl: 'Central',
  nth: 'North',
  sth: 'South',
  bt: 'Bukit',
  jln: 'Jalan',
  lor: 'Lorong',
  tg: 'Tanjong',
  upp: 'Upper',
  cck: 'Choa Chu Kang',
  amk: 'Ang Mo Kio',
  tpy: 'Toa Payoh',
  bb: 'Bukit Batok',
  bm: 'Bukit Merah',
  bp: 'Bukit Panjang',
  sbw: 'Sembawang',
  ykk: 'Yio Chu Kang',
};

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Expand abbreviations and title-case a street string. Block letters are handled elsewhere. */
export function expandStreet(raw: string): string {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => WORDS[w.toLowerCase()] ?? (/^\d/.test(w) ? w : capitalise(w)))
    .join(' ');
}
