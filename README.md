# ChemEdit

**Bring chemistry to Obsidian.**

ChemEdit is a fully integrated chemical structure editor and viewer for Obsidian. Powered by **Ketcher** and **SmilesDrawer**, it lets you draw molecules and reactions, edit `.mol` files, preview ChemDraw (`.cdxml`) files, and work with SMILES directly inside your vault—without switching applications.

### Quick Demo
<video src="https://github.com/user-attachments/assets/e215352a-7717-4c9a-bf95-c134b9a81ecd" controls width="800"></video>

---

## ✨ Features

- **Native chemistry support** — Render and edit `.mol` and `.cdxml` files directly.
- **Visual editor** — Double-click any rendered structure to open it in Ketcher.
- **Automatic saving** — Save directly back to the original `.mol` or `.cdxml` file.
- **SMILES support** — Render, edit, and update SMILES code blocks.
- **Reaction editor** — Draw and edit complete chemical reactions.
- **Theme-aware rendering** — Structures automatically adapt to Obsidian's light and dark themes.
- **Offline mode** — Work entirely locally with no internet connection.

---

# 🚀 Usage

## Mol and ChemDraw files (`.mol`, `.cdxml`)

Place a chemistry file anywhere inside your vault and embed it in a note.

### MOL file

````markdown
```mol
[[aspirin.mol]]
```
`````

### ChemDraw file

````markdown
```mol
[[aspirin.cdxml]]
```
````

ChemEdit replaces the standard file preview with a rendered SVG image.

Double-click the rendered structure to open it in the visual editor. Press **Save** to overwrite the original file and immediately refresh the preview.

### Demo

<video src="https://github.com/user-attachments/assets/d7ce9f1f-9e65-4383-8ce9-01281ace382d" controls width="800"></video>

> **Note**
>
> ChemEdit uses Ketcher's open-source conversion engine for `.cdxml` files. Most standard molecules and reactions are fully supported, but certain ChemDraw-specific formatting and proprietary objects may not render identically.

---

## SMILES

Write SMILES directly inside a Markdown code block.

````markdown
```smiles
CC(=O)OC1=CC=CC=C1C(=O)O
```
````

ChemEdit automatically renders the structure.

Double-click the structure to edit it visually. Saving updates the original SMILES code block automatically.

---

## Draw a new molecule

Click the **hexagon ribbon icon**, or run the command:

> **ChemEdit: Draw new SMILES molecule**

Draw your molecule in Ketcher and press **Save**. The generated SMILES will be inserted at the current cursor position.

---

# ⚡ Offline Mode

By default, ChemEdit uses **Online Proxy Mode**, loading Ketcher from EPAM's servers. This requires an internet connection and may be affected by API availability or rate limits.

Installing Ketcher locally enables **Offline Mode**, which provides:

* Faster loading
* Local rendering
* No internet connection required
* Improved privacy
* No API limits

## Enable Offline Mode

1. Download the latest **ketcher-standalone.zip** from the official Ketcher releases.
2. Open your vault:

```
.obsidian/plugins/chemedit/
```

3. Create a folder named:

```
ketcher
```

4. Extract the archive into that folder so the following file exists:

```
.obsidian/plugins/chemedit/ketcher/index.html
```

5. Restart Obsidian.
6. Open **Settings → ChemEdit**.

If everything is installed correctly, you'll see:

✅ **Offline Mode Active**

---

# 📥 Installation

## Community Plugins (Recommended)

1. Open **Settings → Community Plugins**.
2. Click **Browse**.
3. Search for **ChemEdit**.
4. Click **Install**.
5. Click **Enable**.

---

## Manual Installation

1. Download **main.js**, **manifest.json**, and **styles.css** (if available) from the latest GitHub Release.
2. Copy them into:

```
.obsidian/plugins/chemedit/
```

3. Reload Obsidian.
4. Enable **ChemEdit** under **Community Plugins**.

---

# 🐞 Bug Reports

If you encounter a bug or would like to request a feature, please open an issue on GitHub.

[https://github.com/ruzx/obsidian-chemedit/issues](https://github.com/ruzx/obsidian-chemedit/issues)

---

# 🙏 Acknowledgements

* **Ketcher** — [https://github.com/epam/ketcher](https://github.com/epam/ketcher)
* **SmilesDrawer** — [https://github.com/reymond-group/SmilesDrawer](https://github.com/reymond-group/SmilesDrawer)



| Feature | Supported |
|---------|:---------:|
| SMILES | ✅ |
| MOL | ✅ |
| CDXML | ✅ (most files) |
| Reactions | ✅ |
| Offline mode | ✅ |
| Light/Dark themes | ✅ |
| Edit by double-click | ✅ |

![GitHub release](https://img.shields.io/github/v/release/ruzx/obsidian-chemedit)
![Downloads](https://img.shields.io/github/downloads/ruzx/obsidian-chemedit/total)
![License](https://img.shields.io/github/license/ruzx/obsidian-chemedit)
![Obsidian](https://img.shields.io/badge/Obsidian-Plugin-7C3AED)

