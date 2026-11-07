# Design

The client is a knitwear exporter in Tiruppur, so the look comes from their world rather than from software conventions. Layout and controls stay familiar, because these are working screens. The character lives in colour, type and one signature element.

## Light, because of where it is used

Supervisors read this under factory tube lights and merchandisers in a bright office. There is no dark theme.

## Colour

Peacock and rani pink are the classic pairing on Kanchipuram silk, set on greige, the unbleached cotton the factory starts from. Red, amber and green only ever mean order status, and always come with a word, so colour is never the only signal.

| Token | Value | Job |
| --- | --- | --- |
| `--peacock-900` | `#0a3a45` | Side rail, top bars, selected filter |
| `--peacock-700` | `#0f6472` | Primary action, finished thread |
| `--rani` | `#c2116f` | Today's marker, review count, focus ring, text selection |
| `--turmeric` | `#f0b429` | Stitches on the rail, focus ring on dark backgrounds |
| `--ground` | `#eef0e9` | Page, in greige |
| `--panel` | `#ffffff` | Tables, forms |
| `--ink` / `--ink-2` | `#11242a` / `#47585c` | Text / secondary text |
| `--red` on `--red-soft` | `#a61e1a` on `#fbe6e2` | Delayed |
| `--amber` on `--amber-soft` | `#7a4f00` on `#fdefc8` | At risk |
| `--green` on `--green-soft` | `#12643c` on `#dbf2e3` | On track |

## Type

One family, Anek Tamil, self-hosted. It comes from an Indian type foundry, and its Tamil and Latin letters are drawn to match, so English and Tamil sit together naturally. Only the weight axis ships, at about 93 KB, because supervisors use low-memory phones on weak networks. Inputs are 16px so a phone never zooms the page.

## Thread, the signature element

Progress is drawn as thread: solid for work done, dashed stitches for work left.

- **Pace bar:** the full length is the pieces a day the plan needs, the solid part is the pieces a day being made, the stitches are the shortfall, and the bar at the end is the target. Colour follows the stage's status.
- **Seam:** every stage of an order, in order, ending in garment buttons that fill as stages finish. Stages are evenly spaced so close dates stay readable, so it shows sequence rather than a true time scale. It runs across the page on a desktop and down it on a phone.
- **Rail:** a line of stitches runs down the merchandiser's side rail, and across the top bar on smaller screens.

## Density by person

- **Merchandiser:** a table with many columns, most urgent order first. The page title states the position, such as "1 order delayed and 1 at risk", and filters look like a dye shade card.
- **Supervisor:** one column of cards with buttons at least 44px tall, for one hand on a cheap phone.
- **Buyer:** a calm seam for each order, with no internal figures. Status stays neutral unless a merchandiser has confirmed a warning.

## Motion

Quick and only where it means something. Buttons press in on touch, and the seam sews itself in once when an order opens on a larger screen. Everything respects reduced-motion settings, and hover styles apply only to devices that can really hover.

## Conventions

- Forms open in place, not in modals.
- Skeleton rows while loading, never a spinner over content.
- Actions that are hard to undo ask inline, such as "Yes, mark shipped" beside "Keep open".
- An empty state says what will appear and what to do.
- Errors name the problem and the way out.
