# Smartvie — Stitch design brief

Paste the section under **Prompt** into Stitch (fill in its Brand section first). The rest is context for you.

## Prompt

Design the application frame (sidebar, top bar, page shell) and three sample screens for **Smartvie**, a web tool a small sustainability and innovation organisation uses for two separate jobs:

1. **Projects**: milestones, tasks, a Gantt chart, funding pipeline, resources, living labs. Everything here follows a *selected project*.
2. **Accounting**: invoices, credit notes, payments, bank statements and reconciliation, journals, trial balance, balance sheet. This is *company-wide*, ignores the selected project, and is for finance users only.

The two areas must feel like parts of one product that you can tell apart at a glance, without a loud mode switch.

**Users and context.** A project manager, a bookkeeper, contributors who log task spend, an admin. Desktop first, used for hours at a time, then tablet. Dense tables are normal. People read numbers all day, so legibility beats decoration.

**Feel.** Friendly, calm and precise, built on **Material Design 3**: rounded shapes, tonal colour surfaces, clear state layers, generous touch targets. Warm and earthy rather than corporate blue, and trustworthy with money. Round, approachable letterforms, but still plainly legible in a dense table.

### Deliverables
Design **light and dark** versions of everything below. Dark is a designed theme, not an inverted one, and is contrast-checked separately.

**Frame**
- **Sidebar** with two labelled groups. *Projects* (project switcher at its top; says it follows the selected project): Dashboard, Milestones, Tasks, Gantt, Funding, Resources, Living Labs, Reports. *Accounting* (finance users only; says it is company-wide): Overview, Invoices, Credit notes, Payments, Bank, Journals, Contacts, Products, then a smaller Reports run: Aged debtors, Trial balance, Balance sheet. Bottom: Settings, Admin (admins only), Support.
- Collapsible to icons on tablet, a drawer on mobile.
- **Top bar**: breadcrumb, page title, subtitle, page actions on the right, account menu (sign out inside the menu, not a lone icon).
- **Accounting sub-navigation** inside the section, so people can move invoice, payments, bank without returning to the overview.

**Screens**
1. **Accounting overview**: a "what needs attention today" view covering overdue invoices, drafts waiting for approval, unreconciled bank lines, the lock date, and whether the trial balance balances. Not a grid of identical tiles.
2. **Invoices list**: search, filter by status and customer, dense table, status chips with words, total owed in the header, a clear empty state.
3. **Tasks** for the selected project: table with status, priority, owner and spend, and a way to change the project that is obvious but not noisy.

**States to show** (at least on the screens above, in both themes)
- **Loading**: skeleton rows that keep the table's column widths, not a spinner.
- **Error**: a page-level message in plain words with a retry action, and a field-level error pattern (text beside the field plus a summary at the top of the form).
- **Empty**: what the list is for and the single next action.
- **Archived project (read-only)**: a persistent banner saying the project is archived, with editing controls disabled and still readable, plus how to restore it.
- **Non-finance user**: the sidebar with no Accounting group at all, and no hint that it exists.
- **Destructive confirmation**: a styled dialog, not a browser confirm, that says what will happen ("Voiding keeps invoice INV-0042 on record and reverses its entry").

### Brand (fill in before pasting)
Anything given here overrides the proposed palette below.
- Logo: *(attach, or "none yet")*
- Brand colours: *(hex values, or "none, use the proposal")*
- Preferred typefaces: *(names, or "none, use the proposal")*
- Tone words the organisation already uses: *(optional)*

### Proposed palette
These are proposals, not brand guidelines. If the Brand section above is filled in, adapt them to it and re-check contrast; otherwise keep to the spirit (warm, green, grounded) and feel free to improve on the values. All light-theme pairs below meet WCAG 2.2 AA.

| Role | Value | Notes |
|---|---|---|
| Paper (page background) | `#F6F3EC` | warm off-white, not pure white |
| Surface (cards, inputs) | `#FFFFFF` | |
| Ink (text) | `#14201B` | 15:1 on paper |
| Primary (moss green) | `#1F5E45` | 6.9:1 on paper, white on it 7.7:1 |
| Sidebar | `#12201A` | deep green-black |
| Sidebar text | `#B9C8BF` | 9.7:1 on sidebar |
| Sidebar active | `#E9D98B` (marker and text) | 11.8:1 on sidebar |
| Danger | `#B4472B` | 4.9:1 text on paper, white on it 5.4:1 |
| Warning text | `#8A5A00` | 5.4:1 on paper |
| Control border | `#76847C` | 3.5:1 on paper; inputs and buttons need 3:1 minimum |
| Hairline (decorative dividers only) | `#DDE3DC` | never the only edge of an input |

The **Accounting** section gets its own accent (a deep ink-blue or aubergine that is *not* the primary), used only for its sidebar marker, page header rule and section label, so a user always knows which side they are on.

**Dark theme.** Propose dark values for every role above: a deep green-black page, a slightly lifted surface, ink at about 12:1 or better, the primary lightened so it still reads as moss, the Accounting accent lightened to keep 4.5:1 for text, and control borders still at 3:1 against their surface. State the values and the contrast ratios in your output.

**Money.** Tabular figures, right-aligned, negatives in parentheses with a minus-sign alternative, never red alone.

### Accessibility requirements (non-negotiable)
- WCAG 2.2 AA throughout: 4.5:1 for text, 3:1 for icons and control edges, 24 px minimum target size (44 px on touch).
- Visible focus on every interactive element: 2 px ring, 3:1 against both the element and its background, not removed on dark surfaces.
- Minimum 12 px text anywhere, 14 px for table body. No 10 px uppercase labels.
- Keyboard: a "Skip to content" link first; a logical tab order; the sidebar groups are labelled landmarks; the current page is marked, not only coloured.
- Respect `prefers-reduced-motion` and `prefers-color-scheme`.
- Icon-only buttons always have a text label (tooltip and accessible name): sign out, filters, row actions.
- Forms: visible labels (not placeholder-as-label), errors in text next to the field and in a summary, never colour alone.
- No colour-only meaning. Every status needs a word or shape as well as a colour.

### Typography and shape
- **Typeface: Nunito** (Google Fonts), a rounded sans, for the whole interface: Material 3 type scale (display, headline, title, body, label) with Nunito in every role. Headings at weight 700, body at 400, labels at 600. If Nunito does not suit a screen, use another *rounded* sans such as Quicksand or Varela Round, not a geometric or neutral grotesque.
- **Numbers.** Turn on tabular figures (`font-variant-numeric: tabular-nums`) for every money amount, table number and date, so columns line up. Check they render as tabular in the chosen face.
- **Icons: Material Symbols Rounded**, outlined by default, filled for the active item. Every icon-only control still needs a text label.
- **Shape.** Material 3 corner scale: 12 px on cards and inputs, 16 to 28 px on dialogs and sheets, fully rounded on buttons and chips. The sidebar's active item is a rounded tonal indicator, not a sharp bar.
- **Elevation.** Use tonal surface colours (surface, surface-container, surface-container-high) rather than shadows. Shadows only on menus and dialogs.
- **Components.** Use Material 3 patterns: filled, tonal and outlined buttons; navigation rail on tablet, navigation drawer on desktop, modal drawer on mobile; filter chips; snackbar for confirmations; segmented control for view switches.

### Tone for microcopy
Plain British English, short, specific. "Locked up to 31 March" rather than "Period closed".

### Avoid the generic AI look
- No purple or blue-to-purple gradients, glassmorphism or glow effects.
- No default blue-on-slate palette, and no near-black navy sidebar with a blue active pill.
- No cards inside cards inside cards and no drop shadow on everything. Group with tonal surfaces, spacing and type weight, and keep dense tables flat and ruled, not boxed row by row.
- No emoji, no decorative illustrations, no stock icon in a coloured square.

## What I changed in the live frame already
- Group labels and hints raised from slate-500/600 (4.2:1 and 2.7:1 on the sidebar) to slate-400 (7.9:1), and from 10 px to 11–12 px.
- `aria-label="Main"` on the nav, `aria-current="page"` on the active link, and a visible focus ring on sidebar links.
- The sign-out icon button now has an accessible name.

## Known gaps in the live app (for the redesign to fix)
- Control borders are 1.2:1 (`--border`/`--input` at `220 20% 92%`); WCAG wants 3:1.
- White text on the destructive red (`0 84% 60%`) is 3.8:1; needs about 4.5:1.
- Badges and some table labels use 10–11 px uppercase text.
- No skip link, no `loading.tsx`/`error.tsx`, no `prefers-color-scheme` theme.
- 21 places use the browser's `confirm()`, which cannot be styled or described accessibly.
- The sidebar has no responsive behaviour.
- The Select component uses hard-coded `gray`/`blue` classes instead of the theme tokens.
