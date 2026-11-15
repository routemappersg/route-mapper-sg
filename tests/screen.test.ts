import { describe, expect, it } from 'vitest';
import { screenFeedback, screenNote } from '../src/shared/screen';

describe('note screening (public, rejects personal-looking text)', () => {
  it.each([
    ['Use the side gate near the bin centre', true],
    ['Guardhouse at the main gate, register there then drive to Blk 3', true],
    ['Postal 677723 drop-off at lobby B, 6 floors up', true],
    ['Call 9123 4567 on arrival', false],
    ['Call +65 8123-4567', false],
    ['ask for Mr Tan', false],
    ['Aunty Joyce at #12-345', false],
    ['unit 12-345 is at the end', false],
    ['mail me a@b.com', false],
    ['see www.example.com/x', false],
    ['NRIC S1234567D', false],
    ['order number 12345678901', false],
  ])('%s', (text, ok) => {
    expect(screenNote(text).ok).toBe(ok);
  });

  it('keeps six-digit postal codes, and strips markup and control characters', () => {
    const r = screenNote('Gate for 677723 <b>only</b>\u0007');
    expect(r.ok).toBe(true);
    expect(r.text).toBe('Gate for 677723 bonly/b');
  });

  it('rejects empty and over-long notes', () => {
    expect(screenNote('   ').reasons).toContain('empty');
    const long = screenNote('a'.repeat(200));
    expect(long.ok).toBe(false);
    expect(long.reasons).toContain('too-long');
  });

  it('reports why, so the app can tell the driver', () => {
    expect(screenNote('call 91234567').reasons).toContain('phone');
    expect(screenNote('#03-18 lobby').reasons).toContain('unit');
  });
});

describe('feedback screening (private, redacts personal-looking parts)', () => {
  it('keeps the message and replaces what looks personal', () => {
    const r = screenFeedback('Route was wrong for Mdm Lim at #03-18, phone 9123 4567, mail x@y.com');
    expect(r.ok).toBe(true);
    expect(r.text).not.toMatch(/Lim|03-18|9123|x@y/);
    expect(r.text).toContain('[name]');
    expect(r.text).toContain('[unit]');
    expect(r.text).toContain('[phone]');
    expect(r.text).toContain('[email]');
  });

  it('plain feedback is untouched', () => {
    expect(screenFeedback('Gate was on the wrong side').text).toBe('Gate was on the wrong side');
  });

  it('truncates to 1000 characters instead of rejecting', () => {
    const r = screenFeedback('x '.repeat(800));
    expect(r.ok).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(1000);
  });
});
