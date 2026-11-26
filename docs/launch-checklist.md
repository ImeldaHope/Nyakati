# Launch checklist

The plan's checklist, with how each item was checked. Status as of 2026-11-22.

- [x] **Every shown event has a source link that opens the right page.** `make checklinks` fetched all 381 distinct source links: every one answered 200. Two were Wikipedia redirects to differently named articles (Order of the Burning Spear → Orders, decorations, and medals of Kenya; Party of Development and Reforms → United Democratic Alliance), and both cards now cite the article they were written from.
- [x] **Every image shows author and licence.** Images without a stated author or a free licence are never stored. Against the production build, every image shown on the year and lens pages has an author link and a licence link under it (see Phase 4 in the README; re-run on the full build before launch).
- [x] **The guide's eval score and date are on `/sources`.** Run on 2026-11-22 with llama3.2:1b: 27 of 40 correct, 8 of 10 declined, 64 of 70 sentences backed by their passage. Its answer times were withdrawn: they came from Ollama's prompt cache. `/sources` shows it with the model and how it was marked.
- [x] **Keyboard-only walk-through from the river into a year and back.** Arrow keys move a year, Page Up and Page Down a decade, `+` and `-` zoom, digits type a year, Enter opens it and Escape leaves it; focus returns to the year left. Checked in the browser pane.
- [~] **Reduced-motion walk-through.** Checked by forcing the setting in the page: zooms are instant, entering and leaving a year cross-fade in 150 ms, the river's current stands still, and CSS animations collapse to 150 ms. Still to do on a real device with the setting on.
- [x] **Phone walk-through on a mid-range Android.** Walked through by the owner on a real Android phone, 2026-11-22.
- [x] **`/list` loads without JavaScript.** It is a static, server-rendered page of every event with its source; so are the year rooms' cards.
- [x] **"Report an error" reaches you.** Every card links to the address in `NEXT_PUBLIC_REPORT_URL`, with the event id in the subject (set at build time).
- [ ] **A case study on ihope.dev.** Drafted in `docs/case-study.md`, to be added to the Portfolio site.
