# Design

Minimal and restrained, because these are working screens. The tool should disappear into the task.

## Light, because of where it is used

Supervisors read this under factory tube lights and merchandisers in a bright office. There is no dark theme.

## Colour

Indigo is the shell and every action. Neutrals are cool and lean towards the indigo. Red, amber and green only ever mean order status, and always come with a word, so colour is never the only signal.

| Token | Value | Job |
| --- | --- | --- |
| `--indigo-900` | `#23266b` | Top bar, selected filter |
| `--indigo-700` | `#3a3f9e` | Primary action, links, focus ring |
| `--ground` | `#f4f5fa` | Page |
| `--panel` | `#ffffff` | Tables, forms |
| `--ink` / `--ink-2` | `#191c30` / `#4c5270` | Text / secondary text |
| `--red` on `--red-soft` | `#a8201a` on `#fbe9e7` | Delayed |
| `--amber` on `--amber-soft` | `#7d5200` on `#fdf1d6` | At risk |
| `--green` on `--green-soft` | `#17663a` on `#e3f3e9` | On track |

## Type

One family, Noto Sans Tamil, self-hosted, because its Latin and Tamil letters are drawn to match. English and Tamil sit side by side on the review screen and on the supervisor's cards. Numbers are tabular so columns of figures line up.

## The pace gap

The product's one signature element, used wherever an order's pace is shown. The bar's full length is the pieces a day the plan needs, the fill is the pieces a day being made, and the hatched part is the shortfall. Colour follows the stage's status. It says in one glance what the risk engine worked out.

## Density by person

- **Merchandiser:** a table with many columns, most urgent order first.
- **Supervisor:** one column of cards with buttons at least 48px tall, for one hand on a cheap phone.
- **Buyer:** a calm list of stages with no internal figures.

## Conventions

- Forms open in place, not in modals.
- Skeleton rows while loading, never a spinner over content.
- Destructive actions ask inline, such as "Yes, revoke" beside "Keep".
- An empty state says what will appear and what to do.
- Errors name the problem and the way out.
