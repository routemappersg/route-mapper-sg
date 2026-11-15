# Route Mapper SG

**Many stops. One smart route.**

A free, community-driven web app (PWA) for Singapore delivery drivers. It collects stops from WhatsApp, delivery notes and spreadsheets, plans and optimizes up to 50 stops, then guides the run one stop at a time. Built to fill the gaps in Google Maps multi-stop routing. Made by SAMO.

> Status: Phase 1a done (Inbox paste + CSV parsing). Next: XLSX, share target, saved inbox. Design and test plan are in `docs/`.

## Why
Google Maps limits routes to 10 stops, loses your plan when closed, drops pins on the road beside condos, and can't hold unit numbers, deadlines or contacts. Route Mapper keeps the parts Google does well (durations, leg times, easy reordering) and fixes the rest.

## Principles
- **Free to use, free to run.** No login, no ads.
- **Privacy by design (PDPA).** Names, units and phone numbers never leave your phone.
- **Gated condos done right.** Routes to the main guarded vehicle gate, with community-confirmed gates.
- **Warn, never block.** Unmeetable deadlines are flagged; you still get a plan.

## Docs
- [Build plan and architecture](docs/BUILD_PLAN.md)
- [Test fixture D4-01 (WhatsApp list)](docs/fixtures/D4-01.md)
- [Instructions for Claude Code sessions](CLAUDE.md)

## Contributing
Issues and pull requests are welcome, especially gate and drop-off corrections, translations and bug reports. Do not include customer names, phone numbers or unit numbers in issues or fixtures.

## Licence
Code: [GNU AGPL v3](LICENSE). Community gate data will have its own open-data licence, to be set before launch. Map data © OpenStreetMap contributors; addresses via OneMap (Singapore Land Authority).

## Develop
```
npm install
npm run dev        # local dev server
npm run lint && npm run typecheck && npm test && npm run build
```
