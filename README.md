# ChemEdit

**Bring chemistry to Obsidian.** 

ChemEdit is a fully-integrated chemical structure editor and viewer. Powered by **Ketcher** and **SmilesDrawer**, it allows you to natively draw reactions, edit `.mol` files, and preview ChemDraw (`.cdxml`) files directly inside your vault without ever switching apps.

### Quick Demo
<video src="https://github.com/user-attachments/assets/e215352a-7717-4c9a-bf95-c134b9a81ecd" controls width="800"></video>

## ✨ Features

- **Native File Support:** Render and edit `.cdxml` and `.mol` files directly.
- **Double-Click to Edit:** Click any rendered molecule to open the visual drawing interface.
- **Auto-Save:** Hit "Save" in the editor to instantly overwrite the `.mol`/`.cdxml` file on your hard drive and update the preview.
- **Smart Themes:** Structures automatically adapt to your Obsidian Light/Dark mode.
- **Reactions:** Full support for drawing and rendering complex chemical reactions.

---

## 🚀 How to Use

### 1. ChemDraw & Mol files (.cdxml, .mol)
Drop a chemistry file into your vault and embed it in your note:
```markdown
![[reaction.cdxml]]
![[aspirine.mol]]
```
ChemEdit replaces the generic file box with a crisp SVG rendering. **Double-click the image** to open Ketcher, edit the molecule, and save!

> ⚠️ **Disclaimer on `.cdxml` files:** ChemEdit uses Ketcher's open-source conversion engine. While most standard structures and reactions work perfectly, highly complex formatting or proprietary ChemDraw-specific objects may not be 100% supported.

### 2. SMILES Strings
Write SMILES strings directly in your markdown using code blocks:
````markdown
```smiles
CC(=O)OC1=CC=CC=C1C(=O)O
```
````
*Double-click the structure to edit it visually. Saving will automatically update the text in your code block.*

### 3. Draw from Scratch
Click the **Hexagon Icon** in your left-hand ribbon (or use the Command Palette: *Draw new SMILES molecule*) to open a blank canvas. Draw your structure, hit Save, and it will be inserted exactly where you are typing.

---

## ⚡ Online vs. Offline Mode

By default, ChemEdit runs in **Online Proxy Mode**, streaming the editor from EPAM's servers. Rendering previews requires an internet connection and may be subject to API rate-limiting.

For the ultimate experience, enable **Offline Mode**. Previews generate instantly, files are processed securely on your local machine, and everything works without Wi-Fi!

### How to enable Offline Mode:
1. Download the latest `ketcher-standalone.zip` from the [Official Ketcher Releases](https://github.com/epam/ketcher/releases/latest).
2. Go to your Obsidian vault's plugin folder: `.obsidian/plugins/chemedit/`
3. Create a folder named `ketcher`.
4. Extract the `.zip` contents into that folder. It should look like this:
   `.../.obsidian/plugins/chemedit/ketcher/index.html`
5. Restart Obsidian. 
6. Go to **Settings > ChemEdit**. You should see a green ✅ **Offline Mode Active** status!

---

## 📥 Installation

**From Obsidian Community Plugins (Recommended)**
1. Open **Settings → Community plugins**.
2. Click **Browse** and search for **ChemEdit**.
3. Click **Install** and then **Enable**.

**Manual Installation**
1. Download `main.js` and `manifest.json` from the [Releases page](https://github.com/ruzx/obsidian-chemedit/releases).
2. Place them in your vault at `.obsidian/plugins/chemedit/`.
3. Reload plugins and enable ChemEdit.

## 🐛 Feedback & Bugs
Found a bug or have a feature request? Please [open an issue on GitHub](https://github.com/ruzx/obsidian-chemedit/issues). 

## 🏆 Acknowledgements
- [Ketcher](https://github.com/epam/ketcher) by EPAM Systems
- [SmilesDrawer](https://github.com/reymond-group/smilesDrawer) by the Reymond Group