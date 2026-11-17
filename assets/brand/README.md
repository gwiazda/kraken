# Krak brand assets

Provided by the owner on 2026-11-06. Use these for the Kraken UI. Do not redraw or recolour the logo.

## Logos
| File | What it is | Use for |
|---|---|---|
| `logo-horizontal-lime-on-black.png` | "KRAK" wordmark + cracked bean, lime on black, 2722×756 | Header / sign-in screen on a black background |
| `logo-stacked-lime.png` | Bean above wordmark, lime, transparent background, 303×285 | Dark backgrounds, splash, favicon source |
| `logo-stacked-black.png` | Bean above wordmark, black, transparent background, 303×285 | Light backgrounds, printouts |
| `logo-stacked-black-wide.png` | Wider variant of the black stacked logo, transparent, 384×255 | Light backgrounds where more width is available |
| `crack-yellow.png` | The crack shape on its own, yellow, transparent, 342×568 | Decorative accent (dividers, empty states) |
| `bean-lime.png` | The cracked bean on its own, lime, transparent, 220×207 (added 2026-11-17) | Product icon on the offer |
| `bean-black.png` | The cracked bean on its own, black, transparent, 220×207 (added 2026-11-17) | Light backgrounds |

## Colours
| Token | Hex | Where it comes from |
|---|---|---|
| Lime | `#CAD401` | Logo colour |
| Yellow | `#F3E838` | Crack graphic; matches the text and frame colour on the product labels |
| Black | `#000000` | Background of the logo and labels |
| White | `#FFFFFF` | Text on black where yellow would be too loud |

The look is high-contrast: black backgrounds with lime or yellow, uppercase headings.

## Fonts
- **Erbaum** (Light and Medium) is used on the product labels. It is a commercial font:
  font files are **not** in this repo and must not be committed without a web licence.
  Until a licence is sorted, use a free fallback with a similar wide, geometric feel
  (for example a system font stack, or an open-licence font from Google Fonts).
- **Adriana** is used for the Instagram / website line on the banner (made in Canva).

## Source files (`source/`)
- `labels-40x80-print.pdf`: print-ready 40×80 mm bag labels (with bleed and crop marks) for
  Gwatemala Espresso, Kenia Filtr and Burundi Filtr: front name label and back info label
  (country, region, altitude, process, variety). Reference for the label style and the kind of
  product data Kraken should store.
- `banner-instagram-website.pdf`: horizontal logo banner with `@krak_coffee_roasters` and `krakshop.pl`.
  The high-res horizontal logo above was extracted from it.

The original `logo_FULL_black_kasa.bmp` was pixel-identical to `logo-stacked-black-wide.png`, so only the PNG is kept.
The `.webp` horizontal logo was a lower-resolution copy of the banner logo, so it is not stored separately.
