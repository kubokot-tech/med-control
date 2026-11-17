# Знак МедКонтроля

Каменный акведук: дорога через долину, сложенная камень за камнем, настил поднимается слева направо.

| Файл | Где используется |
|---|---|
| `MedControl-symbol.svg` | сам знак; копии: `frontend/public/icons/mark.svg`, `desktop/splash/mark.svg` |
| `MedControl-stacked-ru.svg`, `-en.svg` | надпись под знаком, основной логотип; копии: `frontend/public/icons/logo-ru.svg`, `logo-en.svg` |
| `MedControl-horizontal-ru.svg`, `-en.svg` | надпись сбоку, для узких мест; в приложении пока не используются |
| `MedControl-app-icon.svg` | значок: светлые камни на плитке `#1f5fa6` |

Надпись набрана шрифтом Commissioner (SIL OFL 1.1) и переведена в кривые: сам шрифт в проект не входит.

Цвет плитки совпадает с акцентом интерфейса `--accent`.

Значки собраны из `MedControl-app-icon.svg`:

- `frontend/public/icons/icon.svg` и `icon-*.png`: тот же значок без скругления на весь квадрат, телефоны скругляют сами. Рисунок шире плитки: настил уходит за оба края.
- `frontend/public/icons/favicon.svg` и `favicon-32.png`: синяя плитка, рисунок целиком и крупнее.
- `desktop/src-tauri/icons/`: плитка 824 px по сетке macOS на прозрачном холсте 1024 px, дальше `npx tauri icon`.
